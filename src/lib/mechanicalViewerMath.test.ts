import { describe, expect, it } from 'vitest';
import { fitSphereDistance, guideProgress, placeCallouts, resampleGuidePath } from './mechanicalViewerMath';

describe('interactive model presentation', () => {
  it('draws two-point dimensions progressively and follows sweep corners without jumping to the endpoint', () => {
    const line = resampleGuidePath([[0, 0, 0], [4, 0, 0]], 5);
    expect(line).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]);
    const corner = resampleGuidePath([[0, 0, 0], [1, 0, 0], [1, 2, 0]], 4);
    expect(corner).toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0]]);
  });
  it('fits the entire model in narrow viewports and retains zoom margin', () => {
    const radius = 3;
    const portrait = fitSphereDistance(radius, .6);
    const landscape = fitSphereDistance(radius, 1.8);
    expect(portrait).toBeGreaterThan(landscape);
    const horizontalFov = Math.atan(Math.tan(18 * Math.PI / 180) * .6);
    expect(portrait * Math.sin(horizontalFov)).toBeGreaterThan(radius);
  });
  it('holds a completed dimension before replay and shows the complete guide for reduced motion', () => {
    expect(guideProgress(0, false).portion).toBe(0);
    expect(guideProgress(4.5, false).portion).toBe(1);
    expect(guideProgress(6, false).portion).toBeLessThan(.1);
    expect(guideProgress(0, true)).toEqual({ portion: 1, eased: 1 });
    for (const elapsed of [-1, 0, 1, 3.8, 5.79, 999999]) expect(guideProgress(elapsed, false).eased).toBeGreaterThanOrEqual(0);
  });
  it('separates coincident selectable callouts and keeps them inside a narrow canvas', () => {
    const points = placeCallouts(Array.from({ length: 9 }, () => ({ x: 150, y: 150 })), 300, 330);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(18); expect(point.x).toBeLessThanOrEqual(282);
      expect(point.y).toBeGreaterThanOrEqual(48); expect(point.y).toBeLessThanOrEqual(310);
    }
    expect(new Set(points.map(p => `${p.x},${p.y}`)).size).toBe(9);
  });
});
