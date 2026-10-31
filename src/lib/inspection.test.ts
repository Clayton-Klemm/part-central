import { describe, expect, it } from 'vitest';
import data from '../../data/demo.json';
import { latestMeasurements, measurementStatus, parseMeasurement, reportCsv } from './inspection';
import type { Run, Part } from '../types';

const parts = data.parts as Part[];

describe('inspection limits', () => {
  it('rejects negative geometric magnitudes without rejecting valid signed dimensions', () => {
    const base = parts[0].features[0];
    const geometric = { ...base, type: 'geometric', nominal: .03, toleranceMinus: 0, tolerancePlus: 0, limitType: 'maximum' as const };
    expect(measurementStatus(geometric, -.001)).toBe('fail');
    expect(measurementStatus(geometric, 0)).toBe('pass');
    expect(measurementStatus(geometric, .03)).toBe('pass');
    expect(measurementStatus({ ...base, nominal: -2, toleranceMinus: .1, tolerancePlus: .1 }, -2)).toBe('pass');
  });
  it('evaluates minimum thread depth and maximum geometric limits without an invented opposite bound', () => {
    const base = parts[0].features[0];
    const minimum = { ...base, nominal: 18, toleranceMinus: 0, tolerancePlus: 0, limitType: 'minimum' as const };
    expect(measurementStatus(minimum, 18)).toBe('pass');
    expect(measurementStatus(minimum, 18.001)).toBe('pass');
    expect(measurementStatus(minimum, 17.999)).toBe('fail');
    const maximum = { ...base, nominal: .05, toleranceMinus: 0, tolerancePlus: 0, limitType: 'maximum' as const };
    expect(measurementStatus(maximum, .05)).toBe('pass');
    expect(measurementStatus(maximum, .049)).toBe('pass');
    expect(measurementStatus(maximum, .051)).toBe('fail');
  });
  it('includes exact lower and upper limits without binary float drift', () => {
    const f = parts[0].features[0];
    expect(measurementStatus(f, 12.475)).toBe('pass');
    expect(measurementStatus(f, 12.525)).toBe('pass');
    expect(measurementStatus(f, 12.525001)).toBe('fail');
    expect(measurementStatus(f, 12.474999)).toBe('fail');
  });
  it('handles unilateral bore and runout requirements', () => {
    const [bore, runout] = parts[0].features.slice(5, 7);
    expect(measurementStatus(bore, 25)).toBe('pass');
    expect(measurementStatus(bore, 24.999)).toBe('fail');
    expect(measurementStatus(runout, .03)).toBe('pass');
    expect(measurementStatus(runout, -.001)).toBe('fail');
    expect(measurementStatus(runout, Infinity)).toBe('fail');
  });
  it('rejects incomplete numbers, non-numeric values, and unsupported precision', () => {
    for (const text of ['', ' ', '1x', 'NaN', 'Infinity', '1e3', '1.0000001', '1000000']) expect(parseMeasurement(text)).toBeNull();
    expect(parseMeasurement('12.500001')).toBe(12.500001);
  });
  it('exports current readings while preserving append-only history and escapes spreadsheet formulas', () => {
    const f = parts[0].features[0];
    const run: Run = { id: 'run', jobId: 'job', jobNumber: 'JOB-1', partNumber: 'DG-1042', revisionCode: 'C', partRevisionId: 'rev', operationId: 'op', inspector: '=HYPERLINK("bad")', lotNumber: 'L', sampleNumber: '1', status: 'draft', createdAt: '', measurements: [
      { id: '1', featureId: f.id, value: 12.6, status: 'fail', recordedAt: 'first' },
      { id: '2', featureId: f.id, value: 12.5, status: 'pass', recordedAt: 'second' },
    ] };
    expect(latestMeasurements(run)[f.id].id).toBe('2');
    expect(run.measurements).toHaveLength(2);
    const csv = reportCsv('DG-1042', 'C', [f], run);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"12.5","pass","","second"');
  });
});
