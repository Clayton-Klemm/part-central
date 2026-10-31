import demo from '../../data/demo.json';
import type { Part, Run, RunFields, RunSummary, Measurement, ReferenceBundle, Employee, Shift } from '../types';
import { inspectionSequence, latestMeasurements, measurementStatus } from './inspection';

export const apiMode = import.meta.env.VITE_DATA_MODE === 'api';
const STORAGE_KEY = `part-central:${apiMode ? 'api' : 'demo'}:runs:v1`;
const demoParts = demo.parts as Part[];
const demoRevisions = [...demoParts, ...demo.revisionExamples as Part[]];
export function storedRuns(): Run[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((r): r is Run => !!r && typeof r.id === 'string' && Array.isArray(r.measurements) && ['draft', 'completed'].includes(r.status)) : [];
  } catch { return []; }
}
function persist(run: Run) {
  // Shared-server mode never serializes the whole archive on the workstation.
  if (apiMode) return;
  try {
    const runs = storedRuns().filter(r => r.id !== run.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([run, ...runs]));
  } catch {
    throw new Error('Browser storage is unavailable or full. Allow site storage to save this demo inspection.');
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('part-central:session-expired'));
    let message = `Request failed (${response.status})`;
    try { const error = await response.json(); if (typeof error.detail === 'string') message = error.detail; } catch { /* Keep HTTP error. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export async function listParts(query = ''): Promise<Part[]> {
  return apiMode ? request<Part[]>(`/parts?limit=50&q=${encodeURIComponent(query)}`) : structuredClone(demoParts.filter(p => `${p.number} ${p.name} ${p.material}`.toLowerCase().includes(query.toLowerCase())));
}
export async function getPart(number: string, revisionId?: string): Promise<Part> {
  if (apiMode) return request<Part>(`/parts/${encodeURIComponent(number)}${revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : ''}`);
  const part = (revisionId ? demoRevisions : demoParts).find(p => p.number === number && (!revisionId || p.revision.id === revisionId));
  if (!part) throw new Error('Part not found');
  return structuredClone(part);
}
export async function startRun(part: Part, fields: RunFields): Promise<Run> {
  if (!fields.jobNumber.trim() || !fields.inspector.trim() || !fields.sampleNumber.trim()) throw new Error('Enter a job number, inspector, and sample before starting the inspection.');
  const body = { partRevisionId: part.revision.id, operationId: part.operation.id, ...fields };
  const run: Run = apiMode ? await request<Run>('/runs', body) : { ...body, jobNumber: fields.jobNumber.trim().toUpperCase(), jobId: `demo-job:${fields.jobNumber.trim().toUpperCase()}`, partNumber: part.number, revisionCode: part.revision.code, references: structuredClone(part.references || null), id: crypto.randomUUID(), status: 'draft', createdAt: new Date().toISOString(), measurements: [] };
  if (!apiMode) run.employeeNumber = (await getSession())?.employeeNumber;
  persist(run);
  return run;
}
export async function saveMeasurement(part: Part, run: Run, featureId: string, value: number, shift: Shift): Promise<Run> {
  if (!['1', '2', '71'].includes(shift)) throw new Error('Choose your shift before saving readings.');
  if (run.status === 'completed') throw new Error('Completed inspection runs are read-only. Start a new sample.');
  const feature = part.features.find(f => f.id === featureId);
  if (!feature || run.partRevisionId !== part.revision.id || run.operationId !== part.operation.id) throw new Error('This characteristic does not belong to the pinned inspection revision.');
  const measurement: Measurement = apiMode
    ? await request<Measurement>(`/runs/${run.id}/measurements`, { featureId, value, shift, expectedSequence: inspectionSequence(run) })
    : { id: crypto.randomUUID(), sequence: inspectionSequence(run) + 1, featureId, value, shift, employeeNumber: (await getSession())?.employeeNumber, status: measurementStatus(feature, value), recordedAt: new Date().toISOString() };
  const updated = { ...run, lastActivityAt: measurement.recordedAt, lastRecordedByEmployeeNumber: measurement.employeeNumber, lastRecordedShift: measurement.shift, measurements: [...run.measurements, measurement] };
  persist(updated);
  return updated;
}
export async function completeRun(part: Part, run: Run, shift: Shift): Promise<Run> {
  if (!['1', '2', '71'].includes(shift)) throw new Error('Choose your shift before completing the inspection.');
  const latest = latestMeasurements(run);
  if (!part.features.every(f => latest[f.id])) throw new Error('Record every characteristic before completing the inspection.');
  const completed: Run = apiMode ? await request<Run>(`/runs/${run.id}/complete`, { shift, expectedSequence: inspectionSequence(run) }) : {
    ...run, status: 'completed', completedAt: new Date().toISOString(), completedByEmployeeNumber: (await getSession())?.employeeNumber, completedShift: shift, overallStatus: part.features.some(f => latest[f.id].status === 'fail') ? 'fail' : 'pass',
  };
  persist(completed);
  return completed;
}
export async function loadRun(id: string): Promise<Run> {
  if (apiMode) { const run = await request<Run>(`/runs/${id}`); persist(run); return run; }
  const run = storedRuns().find(r => r.id === id);
  if (!run) throw new Error('Inspection run not found.');
  return run;
}
export async function listRuns(query = '', offset = 0, jobNumber?: string): Promise<RunSummary[]> {
  if (apiMode) return request<RunSummary[]>(`/runs?summary=true&limit=50&offset=${offset}&search=${encodeURIComponent(query)}${jobNumber ? `&jobNumber=${encodeURIComponent(jobNumber.trim().toUpperCase())}` : ''}`);
  return storedRuns().filter(r => (!jobNumber || r.jobNumber === jobNumber.trim().toUpperCase()) && `${r.jobNumber || r.lotNumber} ${r.partNumber || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + 50).map(({ measurements, ...r }) => ({ ...r, jobNumber: r.jobNumber || `LEGACY-${r.lotNumber}`, measurementCount: Object.keys(latestMeasurements({ ...r, measurements })).length }));
}

export async function adminRequest<T>(token: string, path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  if (!response.ok) { let detail = `Request failed (${response.status})`; try { const e = await response.json(); if (typeof e.detail === 'string') detail = e.detail; } catch { /* Retain status. */ } throw new Error(detail); }
  return response.json() as Promise<T>;
}
export async function uploadReference(token: string, operationId: string, kind: 'sketch' | 'diagram', file: File) {
  const response = await fetch(`/api/admin/operations/${encodeURIComponent(operationId)}/assets?kind=${kind}&filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { ...(token && { Authorization: `Bearer ${token}` }), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!response.ok) { let detail = `Upload failed (${response.status})`; try { const e = await response.json(); if (typeof e.detail === 'string') detail = e.detail; } catch { /* Retain status. */ } throw new Error(detail); }
  return response.json() as Promise<NonNullable<ReferenceBundle['sketch']>>;
}

export async function getSession(): Promise<Employee | null> {
  if (!apiMode) {
    try { const employee = JSON.parse(sessionStorage.getItem('part-central:employee') || 'null') as Employee | null; return employee?.role === 'operator' && /^\d{4}$/.test(employee.employeeNumber) && employee.employeeNumber !== '0000' ? employee : null; } catch { return null; }
  }
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('The local server could not verify your employee session.');
  return response.json() as Promise<Employee>;
}
export async function signIn(employeeNumber: string, adminKey = ''): Promise<Employee> {
  if (!/^\d{4}$/.test(employeeNumber)) throw new Error('Enter your four-digit employee number.');
  if (!apiMode) {
    if (employeeNumber === '0000') throw new Error('Administrator editing is available in the local Docker server version.');
    const employee: Employee = { employeeNumber, displayName: `Employee ${employeeNumber}`, role: 'operator' };
    sessionStorage.setItem('part-central:employee', JSON.stringify(employee));
    return employee;
  }
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeNumber, ...(employeeNumber === '0000' && { adminKey }) }) });
  if (!response.ok) { let detail = 'Unable to sign in.'; try { const error = await response.json(); if (typeof error.detail === 'string') detail = error.detail; } catch { /* Retain message. */ } throw new Error(detail); }
  return response.json() as Promise<Employee>;
}
export async function signOut(): Promise<void> {
  if (!apiMode) { sessionStorage.removeItem('part-central:employee'); return; }
  const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok && response.status !== 401) throw new Error('Unable to sign out. Try again.');
}
