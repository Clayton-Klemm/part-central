import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Clock3, FolderOpen, History, Plus, RefreshCw } from 'lucide-react';
import type { Run, RunSummary } from '../types';
import { listRuns } from '../lib/data';
import { inspectionHistoryRows, reconcileInspectionSummary, shiftName } from '../lib/workflow';

export default function JobInspections({ jobNumber, current, disabled, onOpen, onNew, onHistory }: { jobNumber: string; current: Run | null; disabled: boolean; onOpen: (run: RunSummary) => void; onNew: () => void; onHistory: () => void }) {
  const [sheets, setSheets] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const currentId = current?.id;
  useEffect(() => {
    if (!current || current.jobNumber !== jobNumber) return;
    setSheets(prior => prior.some(s => s.id === current.id) ? prior.map(s => s.id === current.id ? current : s) : [current, ...prior]);
  }, [current, jobNumber]);
  useEffect(() => {
    if (!jobNumber) return;
    generation.current += 1;
    let alive = true; pending.current = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      const atRequest = currentRef.current;
      listRuns('', 0, jobNumber).then(found => { if (alive) { setSheets(found.map(sheet => reconcileInspectionSummary(sheet, atRequest, currentRef.current))); setOffset(0); setHasMore(found.length === 50); } }).catch(e => { if (alive) setError((e as Error).message); }).finally(() => { if (alive) { pending.current = false; setLoading(false); } });
    }, 220);
    return () => { alive = false; clearTimeout(timer); generation.current += 1; };
  }, [jobNumber, currentId, refresh]);
  const more = async () => {
    if (pending.current || disabled || !hasMore) return;
    const requestGeneration = generation.current;
    const atRequest = currentRef.current;
    const nextOffset = offset + 50;
    pending.current = true; setLoading(true);
    try { const found = await listRuns('', nextOffset, jobNumber); if (requestGeneration === generation.current) { setSheets(prior => { const additions = new Map(found.map(sheet => [sheet.id, reconcileInspectionSummary(sheet, atRequest, currentRef.current)])); return [...prior.map(sheet => { const next = additions.get(sheet.id); additions.delete(sheet.id); return next || sheet; }), ...additions.values()]; }); setOffset(nextOffset); setHasMore(found.length === 50); } }
    catch (e) { if (requestGeneration === generation.current) setError((e as Error).message); }
    finally { if (requestGeneration === generation.current) { pending.current = false; setLoading(false); } }
  };
  if (!jobNumber) return null;
  const displayed = inspectionHistoryRows(sheets, current, jobNumber);
  return <section className="job-inspections" aria-label={`Inspections for job ${jobNumber}`}><div className="job-inspections-heading"><div><FolderOpen size={17}/><strong>{jobNumber}</strong><span>SAMPLE INSPECTIONS</span></div><div className="job-history-actions"><button onClick={onHistory}><History size={13}/>Sample history</button><button aria-label="Refresh job inspections" title="Refresh inspections" disabled={disabled || loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} className={loading ? 'spinning' : ''}/></button></div></div>{error && <div className="job-inline-error" role="alert"><CircleAlert size={14}/>{error}</div>}<div className="inspection-history-tabs" role="tablist" aria-label="Inspections on this job">{displayed.map(sheet => <button role="tab" key={sheet.id} aria-selected={current?.id === sheet.id} className={`inspection-history-tab ${current?.id === sheet.id ? 'selected' : ''}`} disabled={disabled} onClick={() => onOpen(sheet)}><span>{sheet.status === 'completed' ? <Check size={13}/> : <Clock3 size={13}/>}Sample {sheet.sampleNumber}<b>REV {sheet.revisionCode}</b></span><strong>{sheet.status === 'completed' ? (sheet.completedByEmployeeNumber ? `Completed by ${sheet.completedByEmployeeNumber}` : sheet.inspector) : (sheet.lastRecordedByEmployeeNumber || sheet.employeeNumber ? `Employee ${sheet.lastRecordedByEmployeeNumber || sheet.employeeNumber}` : sheet.inspector)}</strong><small>{shiftName(sheet.status === 'completed' ? sheet.completedShift : sheet.lastRecordedShift)} · {new Date(sheet.lastActivityAt || sheet.completedAt || sheet.createdAt).toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</small><em>{sheet.status === 'completed' ? 'Completed · locked' : ('measurements' in sheet ? sheet.measurements.length > 0 : (sheet.measurementCount ?? 0) > 0) ? 'Saved · In progress' : 'No readings yet'}</em></button>)}{!displayed.length && <div className="no-job-sheets">{loading ? 'Loading inspections…' : 'This will be the first inspection on this job.'}</div>}<button role="tab" aria-selected={!current} className={`new-history-tab ${!current ? 'selected' : ''}`} disabled={disabled || !current || current.measurements.length === 0} onClick={onNew}><Plus size={20}/><span>New sample inspection</span></button>{hasMore && <button className="older-history" disabled={loading || disabled} onClick={() => void more()}>Earlier inspections</button>}</div></section>;
}
