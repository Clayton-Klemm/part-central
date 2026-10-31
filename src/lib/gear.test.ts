import { describe, expect, it } from 'vitest';
import demo from '../../data/demo.json';
import { animationSample, featureGuide } from './gear';

describe('Animation trace safety', () => {
  it.each([-0.01, 0, 0.5, 1, 1.65, Number.NaN, Number.POSITIVE_INFINITY])('samples a real point for progress %s', progress => {
    const points = featureGuide('dog-height').points;
    const sample = animationSample(progress, points.length);
    expect(points[sample.pointIndex]).toBeDefined();
    expect(sample.drawCount).toBeGreaterThanOrEqual(0);
    expect(sample.drawCount).toBeLessThanOrEqual(points.length);
  });
  it('does not request a point when the path is empty', () => {
    expect(animationSample(0, 0)).toMatchObject({ pointIndex: -1, drawCount: 0 });
  });
});

describe('Illustrated dimensions agree with the inspection sheet', () => {
  const features = demo.parts[0].features;

  it.each(['dog-height', 'ramp-height', 'overall-thickness'])('%s starts at underside datum A', key => {
    const guide = featureGuide(key);
    const feature = features.find(item => item.animationKey === key)!;
    expect(guide.points[0].y).toBe(0);
    const top = guide.points[guide.points.length - 1].y;
    expect(top * 12).toBeCloseTo(feature.nominal, 3);
  });

  it('shows the bore diameter across the center, rather than a radius', () => {
    const guide = featureGuide('bore-diameter');
    const first = guide.points[0], last = guide.points[guide.points.length - 1];
    expect(first.distanceTo(last) * 12).toBeCloseTo(features.find(item => item.animationKey === 'bore-diameter')!.nominal, 3);
    expect(first.clone().add(last).setY(0).length()).toBeLessThan(0.0001);
  });

  it('keeps the top-width measurement on the flat tangential land', () => {
    const guide = featureGuide('dog-width');
    const first = guide.points[0], last = guide.points[guide.points.length - 1];
    const feature = features.find(item => item.animationKey === 'dog-width')!;
    expect(Math.abs(first.distanceTo(last) * 12 - feature.nominal)).toBeLessThan(feature.tolerancePlus);
    expect(first.y).toBe(last.y);
    expect(Math.hypot(first.x, first.z)).toBeCloseTo(Math.hypot(last.x, last.z), 6);
  });

  it('draws the pitch circle at the nominal pitch diameter', () => {
    const guide = featureGuide('pitch-diameter');
    const first = guide.points[0];
    expect(Math.hypot(first.x, first.z) * 24).toBeCloseTo(features.find(item => item.animationKey === 'pitch-diameter')!.nominal, 3);
  });

  it('illustrates the ramp angle within the inspection tolerance', () => {
    const guide = featureGuide('ramp-angle');
    const [origin, flat] = guide.extensions[0];
    const slope = guide.extensions[1][1];
    const angle = Math.atan2(slope.y - origin.y, flat.distanceTo(origin)) * 180 / Math.PI;
    const feature = features.find(item => item.animationKey === 'ramp-angle')!;
    expect(Math.abs(angle - feature.nominal)).toBeLessThan(feature.tolerancePlus);
  });
});
