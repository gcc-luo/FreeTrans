export function getResponsiveZoomScale(
  width: number,
  translatorPanelOpen: boolean,
): number {
  return translatorPanelOpen ? Math.max(0.2, Math.min(1, width / 1400)) : 1;
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
