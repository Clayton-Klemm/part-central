import { afterEach, describe, expect, it, vi } from 'vitest';
import demo from '../../data/demo.json';
import type { Part, Run } from '../types';
import { latestMeasurements, measurementStatus, parseMeasurement } from './inspection';
import { shiftName } from './workflow';

const flange = demo.parts.find(part => part.number === 'AF-5400') as Part;
const runout = flange.features.find(feature => feature.number === 7)!;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('shop-floor decimal entry', () => {
  it('treats leading-dot input as the same saved value and respects the exact runout maximum', () => {
    expect(runout.label).toBe('Flange face runout');
    expect(runout.nominal).toBe(.04);
    expect(runout.limitType).toBe('maximum');
    const saved: Run = {
      id: 'saved-run', partRevisionId: flange.revision.id, operationId: flange.operation.id,
      jobId: 'job', jobNumber: 'JOB-DECIMAL-ENTRY', partNumber: flange.number, revisionCode: flange.revision.code,
      inspector: 'Employee 1234', employeeNumber: '1234', lotNumber: '', sampleNumber: '01',
      status: 'draft', createdAt: '2026-10-26T12:00:00Z',
      measurements: [{ id: 'recorded', sequence: 7, featureId: runout.id, value: .04,
        status: 'pass', employeeNumber: '1234', shift: '1', recordedAt: '2026-10-26T12:01:00Z' }],
    };
    for (const text of ['.04', '0.04', '0.040000', ' .040000 ']) {
      const parsed = parseMeasurement(text);
      expect(parsed).toBe(latestMeasurements(saved)[runout.id].value);
      expect(measurementStatus(runout, parsed!)).toBe('pass');
    }
    expect(measurementStatus(runout, parseMeasurement('.040001')!)).toBe('fail');
    expect(saved.measurements).toHaveLength(1);
  });

  it('accepts complete leading-dot decimals without weakening precision, sign, or syntax validation', () => {
    expect(parseMeasurement('.000001')).toBe(.000001);
    expect(parseMeasurement('-.04')).toBe(-.04);
    expect(measurementStatus(runout, parseMeasurement('-.04')!)).toBe('fail');
    const signedCoordinate = { ...runout, type: 'dimensional', limitType: 'bilateral' as const,
      nominal: -.04, toleranceMinus: .001, tolerancePlus: .001 };
    expect(measurementStatus(signedCoordinate, parseMeasurement('-.04')!)).toBe('pass');
    for (const text of ['.', '-.', '.0000001', '0.0400000', '.04e0', '.04mm', '0,04', '+.04', '1.', '--.04', '1000000']) {
      expect(parseMeasurement(text), text).toBeNull();
    }
  });

  it('saves .04 as numeric 0.04 and completes on weekend shift 71 without relabeling earlier shift 3 events', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api'); vi.resetModules();
    const createdAt = '2026-10-26T12:00:00Z';
    const original: Run = {
      id: 'weekend-run', partRevisionId: flange.revision.id, operationId: flange.operation.id,
      jobId: 'job', jobNumber: 'JOB-WEEKEND-DECIMAL', partNumber: flange.number, revisionCode: flange.revision.code,
      inspector: 'Employee 1234', employeeNumber: '1234', lotNumber: '', sampleNumber: '01',
      status: 'draft', createdAt,
      measurements: flange.features.map((feature, index) => ({ id: `earlier-${index}`, sequence: index + 1,
        featureId: feature.id, value: feature.id === runout.id ? .041 : feature.nominal,
        status: feature.id === runout.id ? 'fail' as const : 'pass' as const,
        employeeNumber: '1234', shift: '3' as const, recordedAt: createdAt })),
    };
    const corrected = { id: 'corrected', sequence: 8, featureId: runout.id, value: .04,
      status: 'pass' as const, employeeNumber: '5678', shift: '71' as const,
      recordedAt: '2026-10-26T12:05:00Z' };
    const completed: Run = { ...original, measurements: [...original.measurements, corrected], status: 'completed',
      completedByEmployeeNumber: '5678', completedShift: '71', completedAt: '2026-10-26T12:06:00Z', overallStatus: 'pass' };
    const fetchServer = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => corrected })
      .mockResolvedValueOnce({ ok: true, json: async () => completed });
    vi.stubGlobal('fetch', fetchServer);
    const { saveMeasurement, completeRun } = await import('./data');
    const parsed = parseMeasurement('.04');
    expect(parsed).toBe(.04);
    if (parsed === null) throw new Error('A complete leading-dot reading must parse before saving');
    const saved = await saveMeasurement(flange, original, runout.id, parsed, '71');
    expect(JSON.parse(fetchServer.mock.calls[0][1].body)).toEqual({
      featureId: runout.id, value: .04, shift: '71', expectedSequence: 7,
    });
    expect(saved.lastRecordedShift).toBe('71');
    expect(saved.lastRecordedByEmployeeNumber).toBe('5678');
    expect(saved.measurements.slice(0, 7)).toEqual(original.measurements);
    expect(original.measurements).toHaveLength(7);
    expect(latestMeasurements(saved)[runout.id]).toMatchObject({ value: .04, status: 'pass', shift: '71' });
    const finished = await completeRun(flange, saved, '71');
    expect(JSON.parse(fetchServer.mock.calls[1][1].body)).toEqual({ shift: '71', expectedSequence: 8 });
    expect(finished.completedShift).toBe('71');
    expect(finished.measurements[0].shift).toBe('3');
    expect(shiftName('71')).toBe('Weekend shift 71');
    expect(shiftName('3')).toBe('3rd shift (legacy)');
  });
});
