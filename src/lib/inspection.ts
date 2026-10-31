import type { Feature, Measurement, Run } from '../types';

const SCALE = 1_000_000;
export function measurementStatus(feature: Feature, value: number): 'pass' | 'fail' {
  if (!Number.isFinite(value)) return 'fail';
  if (feature.type === 'geometric' && value < 0) return 'fail';
  const actual = Math.round(value * SCALE);
  if (feature.limitType === 'minimum') return actual >= Math.round(feature.nominal * SCALE) ? 'pass' : 'fail';
  if (feature.limitType === 'maximum') return actual <= Math.round(feature.nominal * SCALE) ? 'pass' : 'fail';
  return actual >= Math.round((feature.nominal - feature.toleranceMinus) * SCALE)
    && actual <= Math.round((feature.nominal + feature.tolerancePlus) * SCALE) ? 'pass' : 'fail';
}
export function parseMeasurement(text: string): number | null {
  if (!/^-?(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) < 1_000_000 ? value : null;
}
export function latestMeasurements(run: Run | null): Record<string, Measurement> {
  return Object.fromEntries((run?.measurements ?? []).map(m => [m.featureId, m]));
}
export function inspectionSequence(run: Run): number {
  return run.measurements.reduce((sequence, measurement, index) => Math.max(sequence, measurement.sequence ?? index + 1), 0);
}
export function formatDimension(value: number, unit = 'mm'): string {
  return value.toFixed(unit === 'deg' ? 2 : 3);
}
export function toleranceText(feature: Feature): string {
  if (feature.limitType === 'minimum') return 'MINIMUM';
  if (feature.limitType === 'maximum') return 'MAXIMUM';
  const { toleranceMinus: minus, tolerancePlus: plus, unit } = feature;
  if (minus === plus) return `± ${formatDimension(plus, unit)}`;
  return `+${formatDimension(plus, unit)} / −${formatDimension(minus, unit)}`;
}
export function reportCsv(partNumber: string, revision: string, features: Feature[], run: Run): string {
  const latest = latestMeasurements(run);
  const rows = [
    ['Job number', 'Part', 'Revision', 'Operation', 'Run ID', 'Sheet started by', 'Started by employee', 'Lot', 'Sample', 'Run status', 'Feature', 'Characteristic', 'Nominal', 'Lower limit', 'Upper limit', 'Unit', 'Measured', 'Result', 'Recorded by employee', 'Recorded at', 'Recorded shift', 'Completed by employee', 'Completed shift'],
    ...features.map(f => [run.jobNumber, partNumber, revision, run.operationId, run.id, run.inspector, run.employeeNumber || '', run.lotNumber, run.sampleNumber, run.status, f.sketchRef, f.label, f.nominal, f.limitType === 'maximum' ? (f.type === 'geometric' ? 0 : '') : f.nominal - (f.limitType === 'minimum' ? 0 : f.toleranceMinus), f.limitType === 'minimum' ? '' : f.nominal + (f.limitType === 'maximum' ? 0 : f.tolerancePlus), f.unit, latest[f.id]?.value ?? '', latest[f.id]?.status ?? 'not measured', latest[f.id]?.employeeNumber ?? '', latest[f.id]?.recordedAt ?? '', latest[f.id]?.shift ?? '', run.completedByEmployeeNumber ?? '', run.completedShift ?? '']),
  ];
  return rows.map(row => row.map(cell => {
    let value = String(cell);
    if (/^[=+@\-\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}
