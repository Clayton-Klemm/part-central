import type { Run, RunSummary, RecordedShift } from '../types';

export function shiftName(shift?: RecordedShift | null): string {
  return shift === '1' ? '1st shift' : shift === '2' ? '2nd shift' : shift === '71' ? 'Weekend shift 71' : shift === '3' ? '3rd shift (legacy)' : 'Shift unrecorded';
}
export function activityTime(run: RunSummary): number {
  return Date.parse(run.lastActivityAt || run.completedAt || run.createdAt) || 0;
}

// Trust the response unless the local sheet changed while the request was in
// flight. Object identity is the request fence; wall-clock order is irrelevant.
export function reconcileInspectionSummary(server: RunSummary, atRequest: Run | null, current: Run | null): RunSummary {
  return current && current.id === server.id && current !== atRequest ? current : server;
}

export function inspectionHistoryRows(sheets: RunSummary[], current: Run | null, jobNumber: string): (RunSummary | Run)[] {
  const displayed: (RunSummary | Run)[] = sheets.filter(sheet => sheet.jobNumber === jobNumber);
  if (current?.jobNumber === jobNumber && !displayed.some(sheet => sheet.id === current.id)) displayed.unshift(current);
  return displayed;
}
export function groupJobActivity(sheets: RunSummary[]) {
  const grouped = new Map<string, RunSummary[]>();
  for (const sheet of sheets) {
    const job = sheet.jobNumber;
    grouped.set(job, [...(grouped.get(job) || []), sheet]);
  }
  return [...grouped.entries()].map(([number, inspections]) => {
    const ordered = inspections.sort((a, b) => activityTime(b) - activityTime(a));
    return { number, latest: ordered[0], resume: ordered.find(s => s.status === 'draft') || ordered[0], inspections: ordered };
  }).sort((a, b) => activityTime(b.latest) - activityTime(a.latest));
}
export function nextSampleIdentifier(sample: string): string {
  return /^\d{1,10}$/.test(sample) ? String(Number(sample) + 1).padStart(sample.length, '0') : `${sample.slice(0, 34)}-next`;
}

// Suggestions use the supplied history only. The sheet UUID remains its identity;
// another workstation may choose the same editable sample label.
export function suggestNextSampleIdentifier(current: string, sheets: Pick<RunSummary, 'sampleNumber'>[]): string {
  const seed = current.trim() || 'sample';
  const labels = new Set(sheets.map(sheet => sheet.sampleNumber));
  const numeric = /^\d{1,40}$/;
  if (numeric.test(seed)) {
    let highest = BigInt(seed);
    for (const label of labels) {
      if (numeric.test(label)) {
        const value = BigInt(label);
        if (value > highest) highest = value;
      }
    }
    const next = String(highest + 1n);
    if (next.length <= 40) return next.padStart(seed.length, '0');
  }
  for (let ordinal = 1; ; ordinal += 1) {
    const suffix = ordinal === 1 ? '-next' : `-next-${ordinal}`;
    const suggestion = `${seed.slice(0, 40 - suffix.length)}${suffix}`;
    if (!labels.has(suggestion)) return suggestion;
  }
}
