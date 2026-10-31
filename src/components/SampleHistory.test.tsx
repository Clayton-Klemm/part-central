import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SampleHistory from './SampleHistory';
import type { Run } from '../types';

function sample(overrides: Partial<Run> = {}): Run {
  return {
    id: 'sheet-01', partRevisionId: 'revision-a', operationId: 'operation-10',
    jobId: 'job-1', jobNumber: 'JOB-HISTORY', partNumber: 'AF-5400', revisionCode: 'A',
    inspector: 'Employee 1111', employeeNumber: '1111', lotNumber: 'LOT-1',
    sampleNumber: '01', status: 'draft', createdAt: '2026-10-24T08:00:00Z',
    lastActivityAt: '2026-10-25T12:15:00Z', lastRecordedByEmployeeNumber: '2222',
    lastRecordedShift: '71', measurements: [
      { id: 'reading-1', featureId: 'runout', value: .03, status: 'pass', employeeNumber: '1111', shift: '1', recordedAt: '2026-10-24T09:00:00Z' },
      { id: 'reading-2', featureId: 'runout', value: .04, status: 'pass', employeeNumber: '2222', shift: '71', recordedAt: '2026-10-25T12:15:00Z' },
    ],
    ...overrides,
  };
}

function render(current: Run) {
  return renderToStaticMarkup(<SampleHistory jobNumber="JOB-HISTORY" current={current} disabled={false} onOpen={() => {}}/>);
}

describe('sample history provenance', () => {
  it('distinguishes the last reading author from the completion signer', () => {
    const html = render(sample({ status: 'completed', completedByEmployeeNumber: '3333', completedShift: '2', completedAt: '2026-10-26T14:00:00Z', lastActivityAt: '2026-10-26T14:00:00Z', overallStatus: 'pass' }));
    expect(html).toContain('Last reading by');
    expect(html).toContain('Employee 2222');
    expect(html).toContain('Weekend shift 71');
    expect(html).toContain('Signed by Employee 3333');
    expect(html).toContain('2nd shift');
    expect(html).toContain('Last activity');
    expect(html).not.toContain('Last reading time');
    expect(html).toContain('All readings pass');
  });

  it('counts characteristics rather than correction events on saved drafts', () => {
    const html = render(sample());
    expect(html).toContain('Saved · In progress');
    expect(html).toContain('1 characteristic recorded');
    expect(html).not.toContain('2 characteristics recorded');
    expect(html).toContain('individual recording times');
    expect(html).toContain('correction history');
  });

  it('keeps unknown historical authors unknown and labels retained shift 3', () => {
    const html = render(sample({ lastRecordedByEmployeeNumber: null, lastRecordedShift: '3' }));
    expect(html).toContain('Employee unrecorded');
    expect(html).toContain('3rd shift (legacy)');
    expect(html).not.toContain('Employee 1111');
  });

  it('does not attribute a reading or shift to an empty sheet', () => {
    const html = render(sample({ measurements: [], lastRecordedByEmployeeNumber: null, lastRecordedShift: null, lastActivityAt: undefined }));
    expect(html).toContain('No readings yet');
    expect(html).toContain('Started by Employee 1111');
    expect(html).toContain('0 characteristics recorded');
    expect(html).not.toContain('Weekend shift 71');
    expect(html).not.toContain('Signed by');
  });
});
