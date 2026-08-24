const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(userAgent);
const touchCapable = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 1);
const compactViewport = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 900;

export const IS_MOBILE = isMobileUA || (touchCapable && compactViewport);

export const GRAPHICS = Object.freeze({
  // Modern phones have far denser displays than their CSS viewport. Rendering
  // at DPR 1 looked visibly upscaled on-device, so mobile starts sharper while
  // retaining a conservative dynamic fallback for demanding scenes.
  // Fixed on mobile: reallocating the drawing buffer during a drive caused a
  // visible hitch. DPR 1.2 is the tested balance for the target handset.
  // On desktop / Retina screens, DPR 1.5 preserves full subpixel clarity while
  // reducing GPU fill-rate by 44% compared to DPR 2.0.
  maxPixelRatio: IS_MOBILE ? 1.2 : 1.5,
  minPixelRatio: IS_MOBILE ? 1.2 : 1,
  shadowMapSize: IS_MOBILE ? 0 : 1024,
  anisotropy: IS_MOBILE ? 4 : 8,
  terrainSegments: IS_MOBILE ? 80 : 160,
  skyWidthSegments: IS_MOBILE ? 24 : 48,
  skyHeightSegments: IS_MOBILE ? 12 : 24,
  sceneryScale: IS_MOBILE ? 0.42 : 1,
  trafficCount: IS_MOBILE ? 4 : 12,
  particleCount: IS_MOBILE ? 120 : 400,
});

export function scaledCount(desktopCount, minimum = 1) {
  return Math.max(minimum, Math.round(desktopCount * GRAPHICS.sceneryScale));
}
