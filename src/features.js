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
  const h = hash(k * 1.37 + 19.7);
  if (h < 0.17) return 'tunnel';
  if (h < 0.33) return 'bridge';
  if (h < 0.47) return 'ramp';
  return 'open';
}

// Absolute z of each ramp lip (launch edge, the -z side of the strip).
// Ramps sit at local offsets -25 and +20 and are 10 m long.
export function rampLips(k) {
  const c = k * SEG_LEN;
  return [c - 30, c + 15];
}

export function rampSurfaceLift(z) {
  const k = Math.round(z / SEG_LEN);
  if (modeForSegment(k) !== 'ramp') return 0;
  const localZ = z - k * SEG_LEN;
  for (const center of [-25, 20]) {
    const u = (center + 5 - localZ) / 10;
    if (u >= 0 && u <= 1) {
      const shaped = Math.pow(Math.min(u / 0.86, 1), 1.28);
      return 1.1 * shaped;
    }
  }
  return 0;
}
