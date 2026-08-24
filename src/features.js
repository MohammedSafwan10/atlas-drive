import { SEG_LEN } from './path.js';

// Deterministic road features per 120 m segment. Because the result only
// depends on the segment index, recycled segments always rebuild with the
// same feature — tunnels stay tunnels, ramps stay ramps.

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// 'open' | 'tunnel' | 'bridge' | 'ramp'
export function modeForSegment(k) {
  if (k > -3) return 'open'; // keep the spawn area clear
  // Reserve a scenic, obstruction-free finish approach for the race gantry,
  // replay cameras and podium ceremony.
  if (Math.abs(k * SEG_LEN + 6000) < 300) return 'open';
  const h = hash(k * 1.37 + 19.7);
  if (h < 0.17) return 'tunnel';
  if (h < 0.33) return 'bridge';
  if (h < 0.47) return 'ramp';
  return 'open';
}

// Absolute z of single centered ramp lip (launch edge at -z side).
// Single 14 m ramp centered at local offset 0 (from localZ +7 down to -7).
export function rampLips(k) {
  const c = k * SEG_LEN;
  return [c - 7];
}

export function rampSurfaceLift(z) {
  const k = Math.round(z / SEG_LEN);
  if (modeForSegment(k) !== 'ramp') return 0;
  const localZ = z - k * SEG_LEN;
  const u = (7 - localZ) / 14;
  if (u >= 0 && u <= 1) {
    const shaped = Math.pow(Math.min(u / 0.92, 1), 1.32);
    return 1.35 * shaped;
  }
  return 0;
}
