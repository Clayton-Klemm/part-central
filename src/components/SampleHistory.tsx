import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Clock3, FileCheck2, History, RefreshCw } from 'lucide-react';
import type { Run, RunSummary } from '../types';
import { listRuns } from '../lib/data';
import { inspectionHistoryRows, reconcileInspectionSummary, shiftName } from '../lib/workflow';
import './sample-history.css';

type Props = {
  jobNumber: string;
  current: Run | null;
  disabled: boolean;
  onOpen: (sheet: RunSummary) => void;
};

function dateTime(value?: string | null) {
  if (!value) return 'Time unrecorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unrecorded' : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function readingCount(sheet: RunSummary | Run) {
  return 'measurements' in sheet ? new Set(sheet.measurements.map(reading => reading.featureId)).size : sheet.measurementCount;
}

export default function SampleHistory({ jobNumber, current, disabled, onOpen }: Props) {
  const [sheets, setSheets] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
    setSheets(prior => prior.some(sheet => sheet.id === current.id) ? prior.map(sheet => sheet.id === current.id ? current : sheet) : [current, ...prior]);
  }, [current, jobNumber]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    pending.current = true;
    setLoading(true); setError(''); setSheets([]); setOffset(0); setHasMore(false);
    if (!jobNumber) {
      pending.current = false; setLoading(false);
      return;
    }
    const atRequest = currentRef.current;
    listRuns('', 0, jobNumber).then(found => {
      if (requestGeneration !== generation.current) return;
      setSheets(found.map(sheet => reconcileInspectionSummary(sheet, atRequest, currentRef.current))); setHasMore(found.length === 50);
    }).catch(e => {
      if (requestGeneration === generation.current) setError((e as Error).message);
    }).finally(() => {
      if (requestGeneration === generation.current) { pending.current = false; setLoading(false); }
    });
    return () => { generation.current += 1; };
  }, [jobNumber, currentId, refresh]);

  const more = async () => {
    if (pending.current || disabled || !hasMore) return;
    const requestGeneration = generation.current;
    const atRequest = currentRef.current;
    pending.current = true; setLoading(true); setError('');
    const nextOffset = offset + 50;
    try {
      const found = await listRuns('', nextOffset, jobNumber);
      if (requestGeneration !== generation.current) return;
      setSheets(prior => {
        const additions = new Map(found.map(sheet => [sheet.id, reconcileInspectionSummary(sheet, atRequest, currentRef.current)]));
        return [...prior.map(sheet => {
          const next = additions.get(sheet.id);
          additions.delete(sheet.id);
          return next || sheet;
        }), ...additions.values()];
      });
      setOffset(nextOffset); setHasMore(found.length === 50);
    } catch (e) {
      if (requestGeneration === generation.current) setError((e as Error).message);
    } finally {
      if (requestGeneration === generation.current) { pending.current = false; setLoading(false); }
    }
  };

  const displayed = inspectionHistoryRows(sheets, current, jobNumber);

  return <section className="sample-history" aria-label={`Sample history for job ${jobNumber}`}>
    <div className="sample-history-intro">
      <div className="sample-history-title"><span className="sample-history-icon"><History size={21}/></span><div><span className="eyebrow">ONE JOB. EVERY SAMPLE.</span><h2>Sample history</h2></div></div>
      <button className="sample-history-refresh" disabled={disabled || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} className={loading ? 'spinning' : ''}/>Refresh history</button>
    </div>
    <p className="sample-history-description">Every saved sample stays with <strong>{jobNumber}</strong>. Open a sample to see its measurements, individual recording times, and correction history.</p>
    <div className="sample-history-note"><FileCheck2 size={15}/><span><strong>Saved samples can be continued.</strong> Complete an inspection to lock its readings and signoff.</span></div>
    {error && <div className="sample-history-error" role="alert"><CircleAlert size={16}/><span>{error}</span></div>}
    {!displayed.length ? <div className="sample-history-empty" role="status"><History size={31}/><h3>{loading ? 'Finding this job’s samples…' : error ? 'History could not be loaded.' : 'This job’s history starts here.'}</h3><p>{loading ? 'Reading saved sample summaries.' : error ? 'Refresh history to try again.' : 'Save readings on an inspection sheet to build the job record.'}</p></div> : <div className="sample-history-table-wrap" aria-busy={loading}>
      <table className="sample-history-table"><thead><tr><th scope="col">Sample / revision</th><th scope="col">Last reading by</th><th scope="col">Last activity</th><th scope="col">Inspection / signoff</th><th scope="col"><span className="sample-history-action-heading">View sample</span></th></tr></thead><tbody>{displayed.map(sheet => {
        const selected = current?.id === sheet.id;
        const count = readingCount(sheet);
        const lastReading = sheet.lastRecordedByEmployeeNumber;
        const hasReading = !!lastReading || !!sheet.lastRecordedShift || (count ?? 0) > 0;
        return <tr key={sheet.id} className={selected ? 'sample-history-current' : ''}>
          <th scope="row"><div className="sample-history-label">Sample {sheet.sampleNumber}{selected && <span>Open now</span>}</div><small>{sheet.partNumber} · REV {sheet.revisionCode}</small><small>Started {dateTime(sheet.createdAt)}</small></th>
          <td>{hasReading ? <><strong>{lastReading ? `Employee ${lastReading}` : 'Employee unrecorded'}</strong><small>{shiftName(sheet.lastRecordedShift)}</small></> : <><strong>No readings yet</strong><small>{sheet.employeeNumber ? `Started by Employee ${sheet.employeeNumber}` : 'Starting employee unrecorded'}</small></>}</td>
          <td><time dateTime={sheet.lastActivityAt || sheet.completedAt || sheet.createdAt}>{dateTime(sheet.lastActivityAt || sheet.completedAt || sheet.createdAt)}</time><small>{sheet.status === 'completed' ? 'Inspection completed' : hasReading ? 'Latest saved reading' : 'Sheet started'}</small></td>
          <td><span className={`sample-history-status ${sheet.status}`}>
            {sheet.status === 'completed' ? <Check size={12}/> : <Clock3 size={12}/>}{sheet.status === 'completed' ? 'Completed' : hasReading ? 'Saved · In progress' : 'In progress'}
          </span>{sheet.status === 'completed' ? <div className="sample-history-signoff"><strong>{sheet.completedByEmployeeNumber ? `Signed by Employee ${sheet.completedByEmployeeNumber}` : 'Signoff employee unrecorded'}</strong><small>{shiftName(sheet.completedShift)}</small><small>{dateTime(sheet.completedAt)}</small>{sheet.overallStatus && <small className={sheet.overallStatus === 'fail' ? 'sample-history-failed' : ''}>{sheet.overallStatus === 'pass' ? 'All readings pass' : 'Out-of-tolerance readings'}</small>}</div> : <small>{count === undefined ? 'Open to review readings' : `${count} characteristic${count === 1 ? '' : 's'} recorded`}</small>}</td>
          <td><button className="sample-history-open" aria-label={`Open sample ${sheet.sampleNumber} started ${dateTime(sheet.createdAt)}`} disabled={disabled} onClick={() => onOpen(sheet)}>{selected ? 'View sample' : 'Open sample'}<ArrowUpRight size={14}/></button></td>
        </tr>;
      })}</tbody></table>
    </div>}
    <div className="sample-history-footer"><span role="status">{loading ? 'Loading sample history…' : `${displayed.length} sample${displayed.length === 1 ? '' : 's'} shown${hasMore ? ' · earlier samples available' : ''}`}</span>{hasMore && <button className="button secondary" disabled={disabled || loading} onClick={() => void more()}>{loading ? 'Loading…' : 'Load earlier samples'}</button>}</div>
  </section>;
}
