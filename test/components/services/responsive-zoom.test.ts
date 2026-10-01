import {
  getResponsiveZoomScale,
  resolveBaseZoomFactor,
} from '../../../src/components/services/content/responsive-zoom';

describe('service responsive zoom', () => {
  it('keeps the service at normal size when the translator is closed', () => {
    expect(getResponsiveZoomScale(430, false)).toBe(1);
  });

  it('fits a full-width conversation at the narrow layout shown with the translator open', () => {
    expect(getResponsiveZoomScale(430, true)).toBeCloseTo(430 / 1400);
  });

  it('scales down wide content before it reaches the panel', () => {
    expect(getResponsiveZoomScale(920, true)).toBeCloseTo(920 / 1400);
  });

  it('does not enlarge the service when enough space is available', () => {
    expect(getResponsiveZoomScale(1500, true)).toBe(1);
  });

  it('does not treat a delayed automatic zoom result as manual zoom', () => {
    expect(resolveBaseZoomFactor(0.8, 1, 0.8, [0.8, 0.7])).toBe(1);
    expect(resolveBaseZoomFactor(0.7, 1, 0.7, [0.8, 0.7])).toBe(1);
  });

  it('preserves a genuine manual zoom change', () => {
    expect(resolveBaseZoomFactor(0.6, 1, 0.7, [0.8, 0.7])).toBeCloseTo(
      0.6 / 0.7,
    );
  });
});
