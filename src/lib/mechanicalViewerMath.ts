import type { Point3 } from './mechanical3dTypes';

export function fitSphereDistance(radius: number, aspect: number, verticalFovDegrees = 36): number {
  const vertical = verticalFovDegrees * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(.1, aspect));
  return radius / Math.sin(Math.min(vertical, horizontal)) * 1.14;
}

/** Uniform travel along linear dimensions and polyline sweeps, including two-point arrows. */
export function resampleGuidePath(points: readonly Point3[], count = 161): Point3[] {
  if (!points.length) return [];
  if (points.length === 1) return [points[0]];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(...points[i].map((value, axis) => value - points[i - 1][axis])));
  const total = lengths[lengths.length - 1];
  if (!total) return [points[0], points[points.length - 1]];
  let segment = 1;
  return Array.from({ length: count }, (_, i): Point3 => {
    const distance = total * i / (count - 1);
    while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
    const t = (distance - lengths[segment - 1]) / Math.max(Number.EPSILON, lengths[segment] - lengths[segment - 1]);
    const start = points[segment - 1], end = points[segment];
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t];
  });
}

export function guideProgress(elapsed: number, reducedMotion: boolean) {
  const phase = reducedMotion ? 1 : Math.max(0, elapsed % 5.8) / 3.8;
  const portion = Math.min(1, phase);
  return { portion, eased: portion * portion * (3 - 2 * portion) };
}

/** Keep feature callouts apart, within the visible canvas, without changing their anchors. */
export function placeCallouts(points: readonly { x: number; y: number }[], width: number, height: number) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(Math.max(low, high), value));
  const placed: { x: number; y: number }[] = [];
  for (const point of points) {
    const candidate = { x: clamp(point.x + 20, 18, width - 18), y: clamp(point.y - 18, 48, height - 20) };
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!placed.some(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) < 27)) break;
      candidate.y = clamp(point.y - 18 + (attempt % 2 ? 1 : -1) * (Math.floor(attempt / 2) + 1) * 29, 48, height - 20);
      if (attempt > 10) candidate.x = clamp(candidate.x + 29, 18, width - 18);
    }
    placed.push(candidate);
  }
  return placed;
}
