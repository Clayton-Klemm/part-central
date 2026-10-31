import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeRun, getPart, listRuns, saveMeasurement, startRun } from './data';
import { hasAnimation } from '../components/ReferenceGuide';
import { reportCsv } from './inspection';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});

describe('gradual adoption workflow', () => {
  it('starts and completes a job sheet with no sketch, diagram, or animation', async () => {
    const part = await getPart('RD-4200');
    // Optional visuals are a capability, independent of how complete the demo catalog is.
    part.operation.sketchId = null;
    part.references = { id: null, version: 0, sketch: null, diagram: null, modelAvailable: false, geometryFamily: 'ring', notes: '' };
    expect(part.operation.sketchId).toBeNull();
    expect(part.features.every(f => !hasAnimation(f, part.references))).toBe(true);
    let run = await startRun(part, { jobNumber: ' job-10482 ', inspector: 'Operator', lotNumber: '', sampleNumber: 'A1' });
    expect(run.jobNumber).toBe('JOB-10482');
    for (const feature of part.features) run = await saveMeasurement(part, run, feature.id, feature.nominal, '1');
    run = await completeRun(part, run, '1');
    expect(run.status).toBe('completed');
    expect(run.overallStatus).toBe('pass');
    expect(run.references?.sketch).toBeNull();
    await expect(saveMeasurement(part, run, part.features[0].id, 50, '1')).rejects.toThrow('read-only');
  });
  it('requires a job number and searches saved sheets by normalized job number', async () => {
    const part = await getPart('RD-4200');
    await expect(startRun(part, { jobNumber: ' ', inspector: 'Operator', lotNumber: '', sampleNumber: '01' })).rejects.toThrow('job number');
    const first = await startRun(part, { jobNumber: 'job-100', inspector: 'Operator', lotNumber: 'LOT-A', sampleNumber: '01' });
    await startRun(part, { jobNumber: 'job-200', inspector: 'Operator', lotNumber: 'LOT-A', sampleNumber: '01' });
    const found = await listRuns('job-100');
    expect(found.map(r => r.id)).toEqual([first.id]);
    expect('measurements' in found[0]).toBe(false);
    const csv = reportCsv(part.number, part.revision.code, part.features, first);
    expect(csv).toContain('"Job number"');
    expect(csv).toContain('"JOB-100"');
  });
  it('pins a reference edition when the sheet starts', async () => {
    const part = await getPart('DG-1042');
    const run = await startRun(part, { jobNumber: 'job-original', inspector: 'Operator', lotNumber: '', sampleNumber: '01' });
    expect(run.references?.sketch?.id).toBe(part.operation.sketchId);
    part.references!.version = 4;
    part.references!.sketch = null;
    part.references!.modelAvailable = false;
    expect(run.references?.version).toBe(0);
    expect(run.references?.sketch).not.toBeNull();
    expect(hasAnimation(part.features[0], part.references)).toBe(false);
    expect(hasAnimation(part.features[0], run.references)).toBe(true);
    expect(hasAnimation({ ...part.features[0], animationKey: 'future-part-type' }, run.references)).toBe(false);
  });
});
