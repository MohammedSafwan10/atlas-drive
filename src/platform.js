const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
// A touchscreen or small browser window does not make a laptop a phone.
export const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(userAgent);
export const QUALITY_PRESETS = {
  low: { maxPixelRatio: 0.85, shadowMapSize: 0, anisotropy: 2, terrainSegments: 80, sceneryScale: 0.35, particleCount: 120, rainCount: 280 },
  medium: { maxPixelRatio: 1, shadowMapSize: 1024, anisotropy: 4, terrainSegments: 120, sceneryScale: 0.65, particleCount: 240, rainCount: 580 },
  high: { maxPixelRatio: 1.5, shadowMapSize: 2048, anisotropy: 8, terrainSegments: 160, sceneryScale: 1, particleCount: 400, rainCount: 1040 },
};
let saved = 'auto';
try { saved = localStorage.getItem('atlas-drive-quality') || 'auto'; } catch { /* optional */ }
export const QUALITY = ['auto', ...Object.keys(QUALITY_PRESETS)].includes(saved) ? saved : 'auto';
const limited = typeof navigator !== 'undefined' && ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4);
export const GRAPHICS = Object.freeze({
  ...QUALITY_PRESETS[QUALITY === 'auto' ? (limited ? 'low' : 'medium') : QUALITY],
  minPixelRatio: 0.65, skyWidthSegments: 32, skyHeightSegments: 16, trafficCount: 5,
});
export function scaledCount(count, minimum = 1) { return Math.max(minimum, Math.round(count * GRAPHICS.sceneryScale)); }
