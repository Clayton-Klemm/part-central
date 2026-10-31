import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Box, CircleAlert, Clock3, FileCheck2, FolderOpen, Search } from 'lucide-react';
import type { Employee, RunSummary } from '../types';
import { listRuns } from '../lib/data';
import { groupJobActivity, shiftName } from '../lib/workflow';

export default function JobHome({ employee, onFindPart, onOpen, disabled }: { employee: Employee; onFindPart: () => void; onOpen: (run: RunSummary) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const [sheets, setSheets] = useState<RunSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    let alive = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      listRuns(query).then(found => { if (alive) { setSheets(found); setOffset(0); setMore(found.length === 50); } }).catch(e => { if (alive) setError((e as Error).message); }).finally(() => { if (alive) setLoading(false); });
    }, 220);
    return () => { alive = false; clearTimeout(timer); generation.current += 1; };
  }, [query]);
  const loadMore = async () => {
    const requestGeneration = generation.current;
    setLoading(true);
    try { const found = await listRuns(query, offset + 50); if (requestGeneration === generation.current) { setSheets(prior => [...prior, ...found]); setOffset(o => o + 50); setMore(found.length === 50); } }
    catch (e) { if (requestGeneration === generation.current) setError((e as Error).message); }
    finally { if (requestGeneration === generation.current) setLoading(false); }
  };
  const jobs = groupJobActivity(sheets);
  return <div className="job-home">
    <section className="home-intro"><div><span className="eyebrow">EMPLOYEE {employee.employeeNumber} / READY WHEN YOU ARE</span><h2>A clear start.<br/>A connected job.</h2><p>Pick up where the last shift left off, or find a part to start a new job. Every inspection stays together.</p><div className="home-intro-note"><FileCheck2 size={16}/><span>Part requirements stay pinned to each inspection.</span></div></div><button className="start-job-card" onClick={onFindPart} disabled={disabled}><div className="start-job-icon"><Box size={29} strokeWidth={1.4}/></div><span className="eyebrow">START SOMETHING NEW</span><h3>Find a part.<br/>Start an inspection.</h3><p>Choose the active revision, enter your job number, and begin.</p><span className="start-job-link">Open part library<ArrowRight size={18}/></span></button></section>
    <section className="job-directory" aria-label="Find an existing job"><div className="job-directory-heading"><div><span className="eyebrow">KEEP THE JOB MOVING</span><h2>Continue an existing job<span>.</span></h2></div><span className="recent-note"><Clock3 size={14}/>Recently started sheets</span></div><div className="job-search"><Search size={20}/><input placeholder="Search by job number…" aria-label="Find existing job number" value={query} maxLength={80} onChange={e => setQuery(e.target.value)}/><span>{loading ? 'Searching…' : 'Job number'}</span></div>
      {error && <div className="admin-error" role="alert"><CircleAlert size={16}/>{error}</div>}
      {!jobs.length ? <div className="job-directory-empty"><FolderOpen size={35} strokeWidth={1.3}/><h3>{loading ? 'Finding your jobs…' : query ? 'No matching jobs yet.' : 'Your next job starts here.'}</h3><p>{query ? 'Check the job number, or open a part to start a new inspection.' : 'Saved jobs appear here so any shift can continue the work.'}</p></div> : <div className="job-cards" aria-busy={loading}>{jobs.map(job => <button className="job-card" key={job.number} disabled={disabled || loading} onClick={() => onOpen(job.resume)}><div className="job-card-top"><span className="job-folder"><FolderOpen size={19}/></span><span className={`run-status ${job.resume.status === 'completed' ? 'complete' : ''}`}>{job.resume.status === 'draft' ? 'In progress' : 'Completed'}</span></div><strong>{job.number}</strong><span className="job-part">{job.resume.partNumber} <i/> REV {job.resume.revisionCode}</span><div className="job-last-sheet">Sample {job.resume.sampleNumber} · {job.resume.status === 'completed' ? (job.resume.completedByEmployeeNumber ? `Completed by ${job.resume.completedByEmployeeNumber}` : job.resume.inspector) : (job.resume.lastRecordedByEmployeeNumber ? `Employee ${job.resume.lastRecordedByEmployeeNumber}` : job.resume.employeeNumber ? `Started by ${job.resume.employeeNumber}` : job.resume.inspector)}<br/>{shiftName(job.resume.status === 'completed' ? job.resume.completedShift : job.resume.lastRecordedShift)}</div><div className="job-card-bottom"><time>{new Date(job.latest.lastActivityAt || job.latest.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time><span>{job.resume.status === 'draft' ? 'Continue inspection' : 'View job'}<ArrowRight size={15}/></span></div></button>)}</div>}
      {more && <button className="button secondary archive-more" disabled={loading} onClick={() => void loadMore()}>Load earlier job sheets</button>}
    </section>
  </div>;
}
