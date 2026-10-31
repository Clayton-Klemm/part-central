export interface Feature {
  id: string;
  number: number;
  label: string;
  type: string;
  nominal: number;
  toleranceMinus: number;
  tolerancePlus: number;
  limitType?: 'bilateral' | 'minimum' | 'maximum';
  unit: string;
  method: string;
  datum: string;
  instruction: string;
  sketchRef: string;
  animationKey: string | null;
  zone: string;
  critical: boolean;
}
export interface Part {
  id: string;
  number: string;
  name: string;
  description: string;
  material: string;
  finish: string;
  revision: { id: string; code: string; status: string; releasedAt: string | null; isActive?: boolean; geometryFamily?: string | null; changeNote?: string };
  operation: { id: string; code: string; name: string; setup: string; sketchId: string | null };
  references?: ReferenceBundle | null;
  features: Feature[];
}
export type Shift = '1' | '2' | '71';
export type RecordedShift = Shift | '3';
export interface Measurement {
  id: string;
  sequence?: number;
  employeeNumber?: string | null;
  shift?: RecordedShift | null;
  featureId: string;
  value: number;
  status: 'pass' | 'fail';
  recordedAt: string;
  notes?: string;
}
export interface Run {
  id: string;
  partRevisionId: string;
  operationId: string;
  jobId: string;
  jobNumber: string;
  partNumber: string;
  revisionCode: string;
  references?: ReferenceBundle | null;
  inspector: string;
  employeeNumber?: string | null;
  lotNumber: string;
  sampleNumber: string;
  status: 'draft' | 'completed';
  createdAt: string;
  completedAt?: string | null;
  completedByEmployeeNumber?: string | null;
  completedShift?: RecordedShift | null;
  lastActivityAt?: string | null;
  lastRecordedByEmployeeNumber?: string | null;
  lastRecordedShift?: RecordedShift | null;
  measurements: Measurement[];
  overallStatus?: 'pass' | 'fail';
}
export type RunFields = Pick<Run, 'jobNumber' | 'inspector' | 'lotNumber' | 'sampleNumber'>;
export type RunSummary = Omit<Run, 'measurements'> & { measurementCount?: number };
export interface ReferenceAsset {
  id: string;
  name: string;
  mediaType: string;
  url: string | null;
  sha256: string | null;
}
export interface ReferenceBundle {
  id: string | null;
  version: number;
  sketch: ReferenceAsset | null;
  diagram: ReferenceAsset | null;
  modelAvailable: boolean;
  notes: string;
  geometryFamily?: string | null;
}
export interface Employee {
  employeeNumber: string;
  displayName: string;
  role: 'operator' | 'admin';
}
