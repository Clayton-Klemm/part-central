import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Shift } from '../types';
import { signIn, signOut, getPart, startRun, saveMeasurement, loadRun, completeRun, listRuns } from './data';
import { reportCsv } from './inspection';

beforeEach(() => {
  for (const name of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  }
});
afterEach(() => vi.unstubAllGlobals());

it('retains each employee and shift when a job is resumed and corrected on the next shift', async () => {
  await signIn('1234');
  const part = await getPart('DF-5200');
  let run = await startRun(part, { jobNumber: 'job-handoff', inspector: 'Employee 1234', sampleNumber: '01', lotNumber: '' });
  const f = part.features[0];
  await expect(saveMeasurement(part, run, f.id, f.nominal, '' as Shift)).rejects.toThrow('Choose your shift');
  run = await saveMeasurement(part, run, f.id, f.nominal + 1, '1');
  await signOut(); await signIn('5678');
  run = await loadRun(run.id);
  run = await saveMeasurement(part, run, f.id, f.nominal, '2');
  for (const feature of part.features.slice(1)) run = await saveMeasurement(part, run, feature.id, feature.nominal, '2');
  run = await completeRun(part, run, '2');
  expect(run.employeeNumber).toBe('1234');
  expect(run.measurements[0]).toMatchObject({ employeeNumber: '1234', shift: '1', status: 'fail' });
  expect(run.measurements[1]).toMatchObject({ employeeNumber: '5678', shift: '2', status: 'pass' });
  expect(run.completedByEmployeeNumber).toBe('5678');
  expect(run.completedShift).toBe('2');
  await startRun(part, { jobNumber: 'JOB-HANDOFF-OTHER', inspector: 'Employee 5678', sampleNumber: '01', lotNumber: '' });
  const siblings = await listRuns('', 0, ' job-handoff ');
  expect(siblings.map(s => s.id)).toEqual([run.id]);
  expect('measurements' in siblings[0]).toBe(false);
  const csv = reportCsv(part.number, part.revision.code, [f], run);
  expect(csv).toContain('"Recorded shift"');
  expect(csv).toContain('"5678","2"');
});
