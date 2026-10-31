import { describe, expect, it } from 'vitest';
import { groupJobActivity, inspectionHistoryRows, nextSampleIdentifier, reconcileInspectionSummary, shiftName, suggestNextSampleIdentifier } from './workflow';
import type { Run, RunSummary } from '../types';

const sheet = (id: string, jobNumber: string, createdAt: string, extra: Partial<RunSummary> = {}): RunSummary => ({ id, jobNumber, createdAt, jobId: jobNumber, partNumber: 'DF-5200', partRevisionId: 'revA', revisionCode: 'A', operationId: 'op', inspector: 'Employee 1234', employeeNumber: '1234', lotNumber: '', sampleNumber: id, status: 'completed', ...extra });
describe('multi-shift job navigation', () => {
  it('groups exact jobs across days and revisions and resumes an open inspection before a completed one', () => {
    const jobs = groupJobActivity([
      sheet('01', 'JOB-1', '2026-10-20T08:00:00Z', { status: 'draft', lastActivityAt: '2026-10-25T16:00:00Z', lastRecordedByEmployeeNumber: '5678', lastRecordedShift: '2' }),
      sheet('02', 'JOB-1', '2026-10-25T09:00:00Z', { revisionCode: 'B', completedAt: '2026-10-26T09:00:00Z' }),
      sheet('03', 'JOB-10', '2026-10-23T08:00:00Z'),
    ]);
    expect(jobs.map(j => j.number)).toEqual(['JOB-1', 'JOB-10']);
    expect(jobs[0].inspections).toHaveLength(2);
    expect(jobs[0].resume.id).toBe('01');
    expect(jobs[0].latest.id).toBe('02');
    expect(jobs[0].resume.lastRecordedByEmployeeNumber).toBe('5678');
    expect(jobs[0].resume.employeeNumber).toBe('1234');
  });
  it('labels legacy shifts honestly and preserves sample padding and alphanumeric identifiers', () => {
    expect(shiftName(null)).toBe('Shift unrecorded');
    expect(shiftName('2')).toBe('2nd shift');
    expect(nextSampleIdentifier('009')).toBe('010');
    expect(nextSampleIdentifier('A1')).toBe('A1-next');
    expect(nextSampleIdentifier('B'.repeat(40)).length).toBeLessThanOrEqual(40);
  });
});

describe('editable next-sample suggestions', () => {
  const labels = (...sampleNumbers: string[]) => sampleNumbers.map(sampleNumber => ({ sampleNumber }));

  it('suggests after the highest known numeric label when an older sheet is open', () => {
    expect(suggestNextSampleIdentifier('01', labels('01', '02', '03', 'A1'))).toBe('04');
    expect(suggestNextSampleIdentifier('009', labels('010', '7'))).toBe('011');
  });

  it('increments decimal labels exactly across ten digits and beyond safe Number integers', () => {
    expect(suggestNextSampleIdentifier('9999999999', labels('10000000000'))).toBe('10000000001');
    expect(suggestNextSampleIdentifier('0000000001', labels('9007199254740993'))).toBe('9007199254740994');
    expect(suggestNextSampleIdentifier('0001', labels('1e3', 'A9999'))).toBe('0002');
  });

  it('avoids supplied alphanumeric suggestions without changing existing labels', () => {
    const history = labels('A1', 'A1-next', 'A1-next-2');
    expect(suggestNextSampleIdentifier('A1', history)).toBe('A1-next-3');
    expect(history.map(sheet => sheet.sampleNumber)).toEqual(['A1', 'A1-next', 'A1-next-2']);
    expect(suggestNextSampleIdentifier('A1', [])).toBe('A1-next');
  });

  it('keeps long-label collision suggestions and numeric overflow within forty characters', () => {
    const long = 'B'.repeat(40);
    const suggestion = suggestNextSampleIdentifier(long, labels(`${'B'.repeat(35)}-next`, `${'B'.repeat(33)}-next-2`));
    expect(suggestion).toBe(`${'B'.repeat(33)}-next-3`);
    expect(suggestion.length).toBe(40);
    const largest = '9'.repeat(40);
    expect(suggestNextSampleIdentifier(largest, labels(largest))).toBe(`${'9'.repeat(35)}-next`);
  });
});

describe('sample history freshness across workstations', () => {
  const reading = (id: string, featureId = 'height') => ({ id, featureId, value: 12.5, status: 'pass' as const, recordedAt: '2026-10-26T12:00:00.123000Z' });
  const summary = (extra: Partial<RunSummary> = {}): RunSummary => ({ ...sheet('01', 'JOB-1', '2026-10-26T11:00:00Z', { status: 'draft' }), measurementCount: 1, lastActivityAt: '2026-10-26T12:00:00.123000Z', ...extra });
  const local = (extra: Partial<Run> = {}): Run => ({ ...summary(), measurements: [reading('first')], ...extra });

  it('trusts a refreshed peer correction even when the server clock moved backward', () => {
    const known = local({ lastRecordedByEmployeeNumber: '1234', lastRecordedShift: '1' });
    const server = summary({ lastActivityAt: '2026-10-26T11:59:59Z', lastRecordedByEmployeeNumber: '5678', lastRecordedShift: '71' });
    const resolved = reconcileInspectionSummary(server, known, known);
    expect(resolved).toBe(server);
    expect(inspectionHistoryRows([resolved], known, 'JOB-1')).toEqual([server]);
  });

  it('keeps a local correction when an earlier in-flight history response returns', () => {
    const atRequest = local();
    const stale = summary();
    const saved = local({ lastActivityAt: '2026-10-26T11:59:59Z', measurements: [reading('first'), reading('correction')], lastRecordedByEmployeeNumber: '5678' });
    expect(reconcileInspectionSummary(stale, atRequest, saved)).toBe(saved);
  });

  it('makes the next refresh authoritative after a protected in-flight local save', () => {
    const atFirstRequest = local();
    const saved = local({ measurements: [reading('first'), reading('correction')] });
    expect(reconcileInspectionSummary(summary(), atFirstRequest, saved)).toBe(saved);
    const peer = summary({ lastActivityAt: '2026-10-26T11:59:58Z', lastRecordedByEmployeeNumber: '9012', lastRecordedShift: '71' });
    expect(reconcileInspectionSummary(peer, saved, saved)).toBe(peer);
  });

  it('preserves a local completion that happened while a draft summary was in flight', () => {
    const atRequest = local();
    const signoff = { status: 'completed' as const, completedAt: '2026-10-26T12:00:00Z', completedByEmployeeNumber: '5678', completedShift: '71' as const };
    const localCompleted = local(signoff);
    expect(reconcileInspectionSummary(summary(), atRequest, localCompleted)).toBe(localCompleted);
    const remoteCompleted = summary({ ...signoff, completedByEmployeeNumber: '9012' });
    expect(reconcileInspectionSummary(remoteCompleted, atRequest, atRequest)).toBe(remoteCompleted);
  });

  it('keeps server-only identities separate and falls back to the current sheet only when absent', () => {
    const server = summary();
    const other = local({ id: 'different-sheet' });
    expect(reconcileInspectionSummary(server, null, null)).toBe(server);
    expect(reconcileInspectionSummary(server, local(), other)).toBe(server);
    expect(inspectionHistoryRows([server], other, 'JOB-1')).toEqual([other, server]);
    expect(inspectionHistoryRows([], other, 'OTHER-JOB')).toEqual([]);
    expect(inspectionHistoryRows([server], local(), 'JOB-1')).toEqual([server]);
  });
});
