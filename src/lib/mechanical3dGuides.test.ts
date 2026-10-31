import { describe, expect, it } from 'vitest';
import demo from '../../data/demo.json';
import additional from '../../data/additional_visual_examples.json';
import type { Feature, Part } from '../types';
import { isMechanicalFamily, mechanicalGuide3D } from './mechanical3dGuides';
import type { MechanicalFamily, Point3 } from './mechanical3dTypes';

const active = [...demo.parts, ...additional.parts] as Part[];
const revisions = [...active, ...demo.revisionExamples as Part[]];
const part = (number: string) => active.find(p => p.number === number)!;
const find = (number: string, key: string, label = '') => part(number).features.find(f => f.animationKey === key && (!label || f.label.includes(label)))!;
const guide = (number: string, key: string, label = '') => mechanicalGuide3D(part(number).revision.geometryFamily as MechanicalFamily, find(number, key, label));
const vectorLength = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('procedural 3D measurement registration', () => {
  it('registers every active non-gear characteristic and historical guided revision with finite, nondegenerate model-space anchors', () => {
    let covered = 0;
    const families = new Set<string>();
    for (const p of revisions) {
      const family = p.revision.geometryFamily;
      if (!family || !isMechanicalFamily(family)) continue;
      families.add(family);
      for (const feature of p.features) {
        if (!feature.animationKey) continue;
        const g = mechanicalGuide3D(family, feature);
        covered++;
        expect(g.description, `${p.number}: ${feature.label}`).not.toContain('Illustrative ');
        expect(g.regions.length).toBeGreaterThan(0);
        expect(g.path.length).toBeGreaterThanOrEqual(2);
        expect(g.path.some(point => vectorLength(point, g.path[0]) > .01)).toBe(true);
        const points = [...g.path, ...g.extensions.flat(), ...g.regions.map(region => region.center), g.focus, g.label, g.camera];
        for (const point of points) {
          expect(point).toHaveLength(3);
          for (const coordinate of point) {
            expect(Number.isFinite(coordinate)).toBe(true);
            expect(Math.abs(coordinate)).toBeLessThanOrEqual(12);
          }
        }
        for (const region of g.regions) {
          if (region.radius !== undefined) expect(region.radius).toBeGreaterThan(0);
          if (region.innerRadius !== undefined) expect(region.innerRadius).toBeLessThan(region.radius!);
          if (region.length !== undefined) expect(region.length).toBeGreaterThan(0);
          if (region.size) expect(region.size.every(n => n > 0)).toBe(true);
        }
      }
    }
    expect(families.size).toBe(7);
    expect(covered).toBeGreaterThanOrEqual(70);
  });
  it('keeps full-form thread, drilled floor and counterbore seat separate from the external dimension arrow', () => {
    for (const number of ['MF-6100', 'AF-5400', 'BC-5300', 'SS-5500', 'DF-5200', 'PH-7200']) {
      const g = guide(number, 'thread-depth');
      expect(g.section).toBe(true);
      expect(g.mode).toBe('thread');
      expect(g.gauge).toBeDefined();
      const gauge = g.gauge!;
      expect(vectorLength(gauge.entry, gauge.fullForm)).toBeGreaterThan(0);
      expect(vectorLength(gauge.entry, gauge.floor)).toBeGreaterThan(vectorLength(gauge.entry, gauge.fullForm));
      expect(g.path[0]).not.toEqual(gauge.entry);
      expect(g.extensions[0][0]).toEqual(gauge.entry);
      expect(g.extensions[1][0]).toEqual(gauge.fullForm);
      if (gauge.seat) expect(vectorLength(gauge.entry, gauge.seat)).toBeLessThan(vectorLength(gauge.entry, gauge.fullForm));
    }
    const drill = guide('MF-6100', 'drill-depth');
    const counterbore = guide('MF-6100', 'counterbore-depth');
    expect(drill.extensions[1][0]).toEqual([-1.15, .9, 0]);
    expect(counterbore.extensions[1][0]).toEqual([-1.15, 2.48, 0]);
    expect(guide('DF-5200', 'thread-depth').gauge?.axis).toBe('x');
    expect(guide('SS-5500', 'thread-depth').gauge?.axis).toBe('x');
  });
  it('uses distinct manifold port and mounting-hole axis locations despite a shared animation key', () => {
    const ports = guide('MF-6100', 'hole-spacing', 'Port');
    const mounting = guide('MF-6100', 'hole-spacing', 'Mounting');
    expect(ports.extensions.map(pair => pair[0])).toEqual([[-1.15, 2.85, 0], [1.15, 2.85, 0]]);
    expect(mounting.extensions.map(pair => pair[0])).toEqual([[-1.8, 2.85, 1.1], [1.8, 2.85, 1.1]]);
    expect(ports.focus).not.toEqual(mounting.focus);
  });
  it('locates shaft radial step and journal runout on their correct physical surfaces', () => {
    const step = guide('SS-5500', 'shoulder-height');
    expect(step.extensions.map(pair => pair[0])).toEqual([[1.31, 1.72, 0], [1.31, 2.05, 0]]);
    expect(vectorLength(step.extensions[0][0], step.extensions[1][0])).toBeCloseTo(.33);
    const runout = guide('SS-5500', 'face-runout');
    expect(runout.mode).toBe('sweep');
    expect(Math.min(...runout.path.map(p => p[0]))).toBeCloseTo(-2.15);
    expect(Math.max(...runout.path.map(p => p[0]))).toBeCloseTo(-.95);
    for (const p of runout.path) expect(Math.hypot(p[1] - 1, p[2])).toBeCloseTo(.865);
  });
  it('uses the carrier window ligament and cross-pin boss rather than confusing them with the bearing bore', () => {
    const wall = guide('DF-5200', 'wall-thickness');
    expect(wall.section).toBe(true);
    expect(wall.extensions[0][0][0]).toBe(.4);
    expect(Math.hypot(wall.extensions[0][0][1] - 1.8, wall.extensions[0][0][2])).toBeCloseTo(1.22);
    expect(Math.hypot(wall.extensions[1][0][1] - 1.8, wall.extensions[1][0][2])).toBeCloseTo(1.65);
    const crossPin = guide('DF-5200', 'bore-diameter');
    const bearing = guide('DF-5200', 'bearing-bore');
    expect(crossPin.regions[0].axis).toBe('z');
    expect(bearing.regions[0].axis).toBe('x');
    expect(crossPin.regions[0].radius).toBeCloseTo(.405);
    expect(bearing.regions[0].radius).toBeCloseTo(.705);
  });
  it('keeps cap assembly requirements explicit and places ring thickness on its two seating faces', () => {
    expect(guide('BC-5300', 'bearing-bore').description).toContain('matched component and approved torque');
    const thickness = guide('RD-4200', 'flange-thickness');
    expect(thickness.extensions.map(pair => pair[0])).toEqual([[-2.1, .05, 0], [-2.1, .7, 0]]);
    expect(guide('RD-4200', 'outside-diameter').path).not.toEqual(guide('RD-4200', 'bore-diameter').path);
  });
  it('does not derive acceptance dimensions from illustrative mesh coordinates or change the pinned feature', () => {
    const feature = structuredClone(find('MF-6100', 'thread-depth'));
    const before = structuredClone(feature);
    const current = mechanicalGuide3D('threaded-block', feature);
    const otherRevision: Feature = { ...feature, nominal: 20, toleranceMinus: .4, tolerancePlus: .8 };
    expect(mechanicalGuide3D('threaded-block', otherRevision).gauge).toEqual(current.gauge);
    expect(feature).toEqual(before);
    expect(isMechanicalFamily('unknown-machine')).toBe(false);
    expect(isMechanicalFamily('dog-clutch')).toBe(false);
  });
});
