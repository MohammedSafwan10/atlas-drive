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
  const targetLateral = steer * Math.min(car.speed * 0.32, 7.2) / (1 + car.speed / 110);
  const grip = (input.handbrake ? 2.2 : 8) * (1 - wet * 0.38);
  // In the air, preserve momentum. Steering cannot move a flying car sideways.
  if (grounded) {
    car.lateralVelocity = damp(car.lateralVelocity || 0, targetLateral, grip, dt);
    car.lateralVelocity += curvature * car.speed * car.speed * dt * (input.handbrake ? 0.9 : 0.24) * (1 + wet);
    if (input.handbrake) car.speed = Math.max(0, car.speed - 10 * dt);
  }
  car.x += (car.lateralVelocity || 0) * dt;
  if (Math.abs(car.x) > 5.15) {
    car.x = Math.sign(car.x) * 5.15;
    if (Math.sign(car.lateralVelocity) === Math.sign(car.x)) {
      car.speed *= 1 - Math.min(0.12, Math.abs(car.lateralVelocity) * 0.018);
      car.lateralVelocity *= -0.16;
    }
  }
  car.steerAngle = damp(car.steerAngle, steer * 4.5, 10, dt);
  car.bodyRoll = damp(car.bodyRoll || 0, -(car.lateralVelocity || 0) * 0.009, 7, dt);
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
