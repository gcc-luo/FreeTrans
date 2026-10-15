export const MIN_RESPONSIVE_ZOOM_SCALE = 0.85;

export function getResponsiveZoomScale(
  width: number,
  translatorPanelOpen: boolean,
): number {
  return translatorPanelOpen
    ? Math.max(MIN_RESPONSIVE_ZOOM_SCALE, Math.min(1, width / 1000))
    : 1;
}

export function resolveBaseZoomFactor(
  currentZoomFactor: number,
  baseZoomFactor: number,
  lastResponsiveScale: number,
  automaticZoomFactors: readonly number[],
): number {
  const isAutomaticZoom = automaticZoomFactors.some(
    factor => Math.abs(currentZoomFactor - factor) <= 0.01,
  );
  return isAutomaticZoom
    ? baseZoomFactor
    : currentZoomFactor / lastResponsiveScale;
}
