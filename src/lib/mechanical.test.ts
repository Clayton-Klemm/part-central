import { describe, expect, it } from 'vitest';
import data from '../../data/demo.json';
import type { Feature } from '../types';
import { MECHANICAL_ANIMATIONS, MECHANICAL_FAMILIES, mechanicalDimension, mechanicalRequirement, threadSection } from './mechanical';
import { hasAnimation } from '../components/ReferenceGuide';

describe('example library coverage', () => {
  it('keeps ten distinct active part numbers and provides varied mechanical families', () => {
    expect(data.parts).toHaveLength(10);
    expect(new Set(data.parts.map(p => p.number)).size).toBe(10);
    for (const family of ['differential-case', 'bearing-cap', 'flange', 'shaft', 'threaded-block', 'housing']) {
      const part = data.parts.find(p => p.revision.geometryFamily === family);
      expect(part).toBeDefined();
      expect(part!.features.length).toBeGreaterThanOrEqual(6);
      expect(part!.revision.isActive).toBe(true);
    }
  });
  it('keeps historical and draft manifold requirements separate from its active release', () => {
    const active = data.parts.find(p => p.number === 'MF-6100')!;
    const historical = data.revisionExamples.find(p => p.number === 'MF-6100' && p.revision.code === 'A')!;
    const draft = data.revisionExamples.find(p => p.revision.code === 'C')!;
    expect([historical.features[0].nominal, active.features[0].nominal, draft.features[0].nominal]).toEqual([16, 18, 20]);
    expect(historical.revision.isActive).toBe(false);
    expect(draft.revision.status).toBe('draft');
    expect(draft.revision.isActive).toBe(false);
    const ids = [...active.features, ...historical.features, ...draft.features].map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('supplies an operation sketch, companion diagram, and supported guide for every active example row', () => {
    for (const part of data.parts) {
      expect(part.operation.sketchId).toBeTruthy();
      expect(part.references.sketch?.id).toBe(part.operation.sketchId);
      expect(part.references.diagram?.url).toContain(`${part.number}-${part.revision.code}-diagram.svg`);
      expect(part.features.every(feature => hasAnimation(feature as Feature, part.references))).toBe(true);
    }
  });
  it('preserves the instructions-only historical ring instead of rewriting it', () => {
    const current = data.parts.find(p => p.number === 'RD-4200')!;
    const historical = data.revisionExamples.find(p => p.number === 'RD-4200' && p.revision.code === 'A')!;
    expect(current.revision.code).toBe('B');
    expect(historical.operation.sketchId).toBeNull();
    expect(historical.references.modelAvailable).toBe(false);
    expect(historical.features.every(feature => !feature.animationKey)).toBe(true);
    expect(current.features.map(feature => feature.nominal)).toEqual(historical.features.map(feature => feature.nominal));
    expect(current.features.every(feature => !historical.features.some(old => old.id === feature.id))).toBe(true);
  });
  it('distinguishes the manifold mounting holes from the port axes', () => {
    const ports = mechanicalDimension('hole-spacing', 'threaded-block', 'Port center distance');
    const mounting = mechanicalDimension('hole-spacing', 'threaded-block', 'Mounting-hole center distance');
    expect(ports.start).not.toEqual(mounting.start);
    expect(ports.end).not.toEqual(mounting.end);
    expect(mounting.caption).toContain('separate from the ports');
  });
  it('never falls back to a dog gear for an unrecognized geometry family', () => {
    const part = data.parts.find(part => part.number === 'DG-1042')!;
    expect(hasAnimation(part.features[0] as Feature, { ...part.references, geometryFamily: 'future-unknown-family' })).toBe(false);
  });
  it('does not assign an unrelated animation to an example characteristic', () => {
    const mechanical = data.parts.filter(p => (MECHANICAL_FAMILIES as readonly string[]).includes(p.revision.geometryFamily));
    for (const part of mechanical) for (const feature of part.features) {
      if (!feature.animationKey) continue;
      expect(MECHANICAL_ANIMATIONS).toContain(feature.animationKey);
      const guide = mechanicalDimension(feature.animationKey, part.revision.geometryFamily);
      expect([...guide.start, ...guide.end, ...guide.label].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('blind thread guidance', () => {
  const feature = data.parts.find(p => p.number === 'MF-6100')!.features[0] as Feature;
  it('shows the required full-form plane above the lead and drill floor', () => {
    const section = threadSection(feature);
    expect(section.fullThreadDepth).toBe(18);
    expect(section.surfaceY).toBeLessThan(section.threadEndY);
    expect(section.gageFullFormY).toBe(section.threadEndY);
    expect(section.gageTipY).toBeGreaterThan(section.gageFullFormY);
    expect(section.gageTipY).toBeLessThan(section.cylindricalEndY);
    expect(section.cylindricalEndY).toBeLessThan(section.floorY);
    expect((section.activeEndY - section.surfaceY) / section.scale).toBeCloseTo(18);
  });
  it('uses the drill floor only for the separate floor-depth characteristic', () => {
    const drilled = data.parts.find(p => p.number === 'MF-6100')!.features[1];
    const section = threadSection(drilled);
    expect(section.drillFloorDepth).toBe(24);
    expect(section.activeEndY).toBe(section.floorY);
    expect(section.activeEndY).toBeGreaterThan(section.threadEndY);
  });
  it('keeps counterbore contact on its flat seat instead of the threaded bore', () => {
    const counterbore = data.parts.find(p => p.number === 'MF-6100')!.features[2];
    const section = threadSection(counterbore);
    expect(section.activeEndY).toBe(section.counterboreY);
    expect(section.counterboreY).toBeLessThan(section.threadEndY);
    expect((section.activeEndY - section.surfaceY) / section.scale).toBeCloseTo(counterbore.nominal);
  });
  it('labels unilateral depth limits without inventing an upper tolerance', () => {
    expect(mechanicalRequirement(feature)).toBe('18.000 mm MIN');
    expect(mechanicalRequirement({ ...feature, nominal: .03, limitType: 'maximum' })).toBe('0.030 mm MAX');
    expect(feature.instruction).toContain('first-full-thread correction');
    expect(feature.instruction).toContain('random screw');
  });
});
