const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const compactViewport = Math.min(screen.width, screen.height) < 900;

export const IS_MOBILE = touchCapable && compactViewport;

export const GRAPHICS = Object.freeze({
  // Modern phones have far denser displays than their CSS viewport. Rendering
  // at DPR 1 looked visibly upscaled on-device, so mobile starts sharper while
  // retaining a conservative dynamic fallback for demanding scenes.
  // Fixed on mobile: reallocating the drawing buffer during a drive caused a
  // visible hitch. DPR 1.2 is the tested balance for the target handset.
  maxPixelRatio: IS_MOBILE ? 1.2 : 2,
  minPixelRatio: IS_MOBILE ? 1.2 : 1,
  shadowMapSize: IS_MOBILE ? 0 : 2048,
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
