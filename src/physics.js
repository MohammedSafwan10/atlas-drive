// Road-relative arcade handling, in metres and seconds. No rendering dependency.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export function integrateHandling(car, input, dt, curvature = 0, wetness = 0) {
  const wet = clamp(wetness, 0, 1);
  const grounded = !car.airborne;
  car.nitroActive = grounded && Boolean(input.nitro && input.throttle && !input.brake && car.nitroAmount > 0.02);
  car.nitroAmount = clamp(car.nitroAmount + dt * (car.nitroActive ? -0.28 : !input.nitro ? 0.06 : 0), 0, 1);
  const previousSpeed = car.speed;
  const terminal = car.nitroActive ? 88 : 72;
  // The limiter reduces engine force, never teleports velocity when boost ends.
  const engine = input.throttle && !input.brake && grounded
    ? (car.nitroActive ? 23 : 15) * clamp((terminal - car.speed) / 12, 0, 1) : 0;
  const drag = 0.45 + car.speed * car.speed * 0.0007;
  const braking = input.brake && grounded ? 28 * (1 - wet * 0.28) : 0;
  const shoulder = Math.abs(car.x) > 4.65;
  car.speed = Math.max(0, car.speed + (engine - drag - braking - (shoulder && grounded ? 5 : 0)) * dt);
  const steer = clamp(input.steer, -1, 1);
  const previousLateral = car.lateralVelocity || 0;
  const initiate = grounded && input.handbrake && car.speed > 12 && Math.abs(steer) > 0.15;
  const counter = steer * (car.driftYaw || 0) > 0.025;
  car.drift = damp(car.drift || 0, initiate ? 1 : 0, initiate ? 6 : counter ? 3.4 : 1.5, dt);
  const drift = car.drift;
  const targetLateral = steer * Math.min(car.speed * 0.32, 7.2) / (1 + car.speed / 110);
  const grip = (8 - drift * 6.3) * (1 - wet * 0.38);
  if (grounded) {
    car.lateralVelocity = damp(previousLateral, targetLateral, grip, dt);
    car.lateralVelocity += curvature * car.speed * car.speed * dt * (0.24 + drift * 0.55) * (1 + wet);
    if (initiate) car.lateralVelocity += steer * 3.5 * dt;
    car.speed = Math.max(0, car.speed - ((input.handbrake ? 5 : 0) + drift * Math.abs(car.lateralVelocity) * 0.35) * dt);
  }
  const headingTarget = -steer * (0.055 + drift * 0.42);
  car.driftYaw = damp(car.driftYaw || 0, grounded ? headingTarget : car.driftYaw || 0, 5, dt);
  car.slip = grounded ? clamp(Math.abs(car.driftYaw + Math.atan2(car.lateralVelocity || 0, Math.max(5, car.speed))) / 0.35, 0, 1) * clamp(car.speed / 18, 0, 1) : 0;
  car.isDrifting = grounded && car.speed > 12 && car.slip > 0.24;
  car.throttleLoad = damp(car.throttleLoad || 0, input.throttle && !input.brake ? 1 : 0, 8, dt);
  const gears = [0, 13, 25, 39, 54, 70];
  let gear = car.gear || 1;
  if (gear < 6 && car.speed > gears[gear] + 1.5) gear++;
  if (gear > 1 && car.speed < gears[gear - 1] - 2) gear--;
  car.gear = gear;
  const lo = gears[gear - 1], hi = gears[gear] || 91;
  car.rpm = damp(car.rpm || 0.18, clamp(0.22 + (car.speed - lo) / (hi - lo) * 0.7 + car.throttleLoad * 0.08, 0.16, 1), 14, dt);
  car.x += (car.lateralVelocity || 0) * dt;
  if (Math.abs(car.x) > 5.15) {
    car.x = Math.sign(car.x) * 5.15;
    if (Math.sign(car.lateralVelocity) === Math.sign(car.x)) {
      car.speed *= 1 - Math.min(0.12, Math.abs(car.lateralVelocity) * 0.018);
      car.lateralVelocity *= -0.16;
    }
  }
  car.steerAngle = damp(car.steerAngle, steer * 4.5, 10, dt);
  car.bodyRoll = damp(car.bodyRoll || 0, clamp(-(car.lateralVelocity - previousLateral) / dt * 0.0025, -0.055, 0.055), 7, dt);
  car.bodyPitch = damp(car.bodyPitch || 0, clamp((car.speed - previousSpeed) / dt * 0.0018, -0.055, 0.035), 8, dt);
}

// Bounded catch-up prevents a spiral after suspension, with identical fixed steps
// on 30/60/144Hz displays during normal play.
export class FixedStepper {
  constructor(step = 1 / 120) { this.step = step; this.accumulator = 0; }
  reset() { this.accumulator = 0; }
  advance(elapsed, update) {
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.25);
    while (this.accumulator + 1e-10 >= this.step) {
      update(this.step);
      this.accumulator -= this.step;
    }
  }
}
