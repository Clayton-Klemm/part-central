import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Box, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clock3, Command, Database, FileCheck2, FileText, FolderOpen, Layers3, Maximize2, Plus, Search, ShieldCheck, Sparkles, X, CircleAlert, BookOpen, ExternalLink, LogOut } from 'lucide-react';
import type { Feature, Part, Run, RunFields, RunSummary, ReferenceBundle, Employee, Shift } from './types';
import { apiMode, listParts, getPart, startRun, saveMeasurement, completeRun, listRuns, loadRun, getSession, signOut } from './lib/data';
import { latestMeasurements, formatDimension, toleranceText, parseMeasurement, reportCsv } from './lib/inspection';
import ReferenceGuide, { hasAnimation } from './components/ReferenceGuide';
import AdminReferences from './components/AdminReferences';
import CatalogAdmin from './components/CatalogAdmin';
import EmployeeLogin from './components/EmployeeLogin';
import OpSketch from './components/OpSketch';
import JobHome from './components/JobHome';
import JobInspections from './components/JobInspections';
import SampleHistory from './components/SampleHistory';
import { nextSampleIdentifier, suggestNextSampleIdentifier, shiftName } from './lib/workflow';

type Modal = 'parts' | 'sketch' | 'guide' | 'history' | 'sample' | 'docs' | 'admin' | 'catalog' | null;
type Tab = 'sheet' | 'sketch' | 'details' | 'samples';
const initialFields: RunFields = { jobNumber: '', inspector: '', lotNumber: '', sampleNumber: '01' };

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => { prior?.focus(); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">PART CENTRAL</span><h2>{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

export default function App() {
  const [employee, setEmployee] = useState<Employee | null | undefined>(undefined);
  const [sessionError, setSessionError] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [partMatches, setPartMatches] = useState<Part[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [part, setPart] = useState<Part | null>(null);
  const [activeId, setActiveId] = useState('');
  const [tab, setTab] = useState<Tab>('sheet');
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [fields, setFields] = useState(initialFields);
  const [shift, setShift] = useState<Shift | ''>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(true);
  const [hoverEnabled, setHoverEnabled] = useState(true);
  const [quickGuide, setQuickGuide] = useState<{ feature: Feature; x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'fail'>('all');
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sampleLabel, setSampleLabel] = useState('');
  const [sampleShift, setSampleShift] = useState<Shift | ''>('');
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const sampleGeneration = useRef(0);
  const catalogGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const queue = useRef(Promise.resolve());
  const runRef = useRef<Run | null>(null);
  const switchingRef = useRef(false);
  const sessionGeneration = useRef(0);
  const pendingPopupClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const shiftRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let alive = true;
    getSession().then(session => { if (alive) { setEmployee(session); if (session) setFields(f => ({ ...f, inspector: session.displayName })); } }).catch(e => { if (alive) { setEmployee(null); setSessionError((e as Error).message); } });
    const expired = () => { sessionGeneration.current += 1; setEmployee(null); setModal(null); setRun(null); runRef.current = null; setPart(null); setValues({}); setShift(''); setSessionError('Your session ended. Sign in to continue. Saved sheets remain on the server.'); };
    window.addEventListener('part-central:session-expired', expired);
    return () => { alive = false; window.removeEventListener('part-central:session-expired', expired); };
  }, []);
  useEffect(() => {
    if (!employee) return;
    setCatalogLoaded(false);
    let cancelled = false;
    listParts().then(available => {
      if (cancelled) return;
      setParts(available); setPartMatches(available);
      setCatalogLoaded(true);
    }).catch(e => { if (!cancelled) { setError(`Could not load the part library. ${e.message}`); setCatalogLoaded(true); } });
    return () => { cancelled = true; };
  }, [employee]);
  useEffect(() => {
    if (modal !== 'parts') return;
    const generation = ++catalogGeneration.current;
    const timer = setTimeout(() => {
      listParts(query).then(found => { if (generation === catalogGeneration.current) setPartMatches(found); }).catch(e => { if (generation === catalogGeneration.current) setError((e as Error).message); });
    }, 200);
    return () => { clearTimeout(timer); catalogGeneration.current += 1; };
  }, [query, modal]);
  useEffect(() => {
    if (modal !== 'history') return;
    const generation = ++historyGeneration.current;
    const timer = setTimeout(() => {
      setHistoryLoading(true); setHistoryError('');
      listRuns(historyQuery).then(found => {
        if (generation === historyGeneration.current) { setHistory(found); setHistoryOffset(0); setHistoryHasMore(found.length === 50); }
      }).catch(e => { if (generation === historyGeneration.current) setHistoryError((e as Error).message); }).finally(() => { if (generation === historyGeneration.current) setHistoryLoading(false); });
    }, 220);
    return () => { clearTimeout(timer); historyGeneration.current += 1; };
  }, [historyQuery, modal]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setModal('parts'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => {
    if (pendingPopupClose.current) clearTimeout(pendingPopupClose.current);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const announce = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4500);
  };
  const updateRun = (next: Run | null) => { runRef.current = next; setRun(next); };
  const selectPart = async (number: string) => {
    if (switchingRef.current || finalizing) return;
    if (hasUnsaved) { setError('Save or discard your unsaved readings before opening another part.'); setModal(null); return; }
    switchingRef.current = true; setSwitching(true);
    setBusy(n => n + 1); setError('');
    try {
      await queue.current;
      sessionGeneration.current += 1;
      const selectionSession = sessionGeneration.current;
      const selected = await getPart(number);
      if (selectionSession !== sessionGeneration.current) return;
      setPart(selected); setActiveId(selected.features[0]?.id || ''); setShift('');
      updateRun(null); setValues({}); setFields({ ...initialFields, inspector: employee?.displayName || '' }); setTab('sheet'); setFilter('all'); setModal(null); setQuery(''); setQuickGuide(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(n => n - 1); switchingRef.current = false; setSwitching(false); }
  };
  const beginInspection = async () => {
    if (!part || runRef.current || switchingRef.current || busy > 0) return;
    const session = sessionGeneration.current;
    setBusy(n => n + 1); setFinalizing(true); setError('');
    try {
      const started = await startRun(part, fields);
      if (session !== sessionGeneration.current) return;
      updateRun(started);
      setFields(f => ({ ...f, jobNumber: started.jobNumber }));
      announce(`Job ${started.jobNumber} · inspection sheet started.`);
    } catch (e) { if (session === sessionGeneration.current) setError((e as Error).message); }
    finally { setBusy(n => n - 1); setFinalizing(false); }
  };
  const saveReadings = async () => {
    if (!part || !runRef.current || runRef.current.status === 'completed' || switchingRef.current || finalizing || busy > 0) return;
    if (!shift) { setError('Choose the shift you are working before saving these readings.'); shiftRef.current?.focus(); return; }
    const saved = latestMeasurements(runRef.current);
    const changed = part.features.filter(f => values[f.id]?.trim() && parseMeasurement(values[f.id]) !== saved[f.id]?.value);
    const invalid = changed.find(f => parseMeasurement(values[f.id]) === null);
    if (invalid) { setError(`${invalid.label}: enter a decimal value with up to six decimal places.`); return; }
    if (part.features.some(f => saved[f.id] && !values[f.id]?.trim())) { setError('Enter a replacement reading, or discard edits to keep the existing saved value. Saved readings cannot be erased.'); return; }
    if (!changed.length) return;
    const session = sessionGeneration.current;
    const recordingShift = shift;
    setBusy(n => n + 1); setFinalizing(true); setError('');
    queue.current = queue.current.then(async () => {
      try {
        for (const f of changed) {
          if (session !== sessionGeneration.current || !runRef.current) return;
          const updated = await saveMeasurement(part, runRef.current, f.id, parseMeasurement(values[f.id])!, recordingShift);
          if (session !== sessionGeneration.current) return;
          updateRun(updated);
        }
        announce(`${changed.length} reading${changed.length === 1 ? '' : 's'} saved · Employee ${employee?.employeeNumber} · ${shiftName(recordingShift)}.`);
      } catch (e) { if (session === sessionGeneration.current) setError((e as Error).message); }
      finally { setBusy(n => n - 1); setFinalizing(false); }
    });
    await queue.current;
  };
  const finish = async () => {
    if (switchingRef.current || finalizing) return;
    if (!shift) { setError('Choose your shift before completing this inspection.'); shiftRef.current?.focus(); return; }
    const session = sessionGeneration.current;
    await queue.current;
    if (!part || !runRef.current || session !== sessionGeneration.current) return;
    const saved = latestMeasurements(runRef.current);
    if (part.features.some(f => parseMeasurement(values[f.id] ?? '') !== saved[f.id]?.value)) {
      setError('Save a valid reading for every field before completing the inspection. Earlier readings remain in the audit trail.');
      return;
    }
    setBusy(n => n + 1); setFinalizing(true); setError('');
    try { const completed = await completeRun(part, runRef.current, shift); if (session !== sessionGeneration.current) return; updateRun(completed); setValues(Object.fromEntries(Object.values(latestMeasurements(completed)).map(m => [m.featureId, String(m.value)]))); announce(completed.overallStatus === 'fail' ? 'Inspection completed with out-of-tolerance readings. Review disposition before release.' : `Inspection completed. All ${part.features.length} characteristics are within tolerance.`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(n => n - 1); setFinalizing(false); }
  };
  const newSample = async () => {
    if (!part || !runRef.current || switchingRef.current || finalizing || busy > 0 || hasUnsaved) return;
    const source = runRef.current;
    const generation = ++sampleGeneration.current;
    setSampleLabel(nextSampleIdentifier(source.sampleNumber)); setSampleShift(''); setSampleError(''); setSampleLoading(true); setModal('sample');
    try {
      const recent = await listRuns('', 0, source.jobNumber);
      if (generation === sampleGeneration.current) setSampleLabel(suggestNextSampleIdentifier(source.sampleNumber, recent));
    } catch (e) { if (generation === sampleGeneration.current) setSampleError(`Could not check recent sample labels. ${(e as Error).message}`); }
    finally { if (generation === sampleGeneration.current) setSampleLoading(false); }
  };
  const startNextSample = async () => {
    if (!part || !runRef.current || !sampleShift || !sampleLabel.trim() || sampleLoading || switchingRef.current || finalizing || busy > 0 || hasUnsaved) return;
    const session = sessionGeneration.current;
    const source = runRef.current;
    const nextFields = { jobNumber: source.jobNumber, inspector: employee?.displayName || '', lotNumber: source.lotNumber, sampleNumber: sampleLabel.trim() };
    setBusy(n => n + 1); setSwitching(true); setFinalizing(true); switchingRef.current = true; setSampleError('');
    try {
      const activePart = await getPart(part.number);
      if (session !== sessionGeneration.current) return;
      const started = await startRun(activePart, nextFields);
      if (session !== sessionGeneration.current) return;
      setPart(activePart); setActiveId(activePart.features[0]?.id || '');
      updateRun(started); setValues({}); setError(''); setFilter('all'); setTab('sheet'); setShift(sampleShift); setFields({ ...nextFields, jobNumber: started.jobNumber }); setQuickGuide(null); setModal(null); sampleGeneration.current += 1;
      announce(`Sample ${started.sampleNumber} started · ${shiftName(sampleShift)}. Sample ${source.sampleNumber} stays saved in this job.`);
      requestAnimationFrame(() => tableRef.current?.querySelector<HTMLInputElement>('input')?.focus());
    } catch (e) { if (session === sessionGeneration.current) setSampleError((e as Error).message); }
    finally { setBusy(n => n - 1); setSwitching(false); setFinalizing(false); switchingRef.current = false; }
  };
  const openHistory = async () => {
    await queue.current;
    setError(''); setHistoryQuery(''); setHistory([]); setHistoryOffset(0); setHistoryHasMore(false); setHistoryLoading(true); setHistoryError(''); setModal('history');
  };
  const moreHistory = async () => {
    if (historyLoading) return;
    const generation = historyGeneration.current;
    setHistoryLoading(true);
    try {
      const found = await listRuns(historyQuery, historyOffset + 50);
      if (generation === historyGeneration.current) { setHistory(h => [...h, ...found]); setHistoryOffset(o => o + 50); setHistoryHasMore(found.length === 50); }
    } catch (e) { setError((e as Error).message); }
    finally { if (generation === historyGeneration.current) setHistoryLoading(false); }
  };
  const restore = async (item: RunSummary, discard = false) => {
    if (switchingRef.current || finalizing) return;
    if (hasUnsaved && !discard) { setError('Save or discard your unsaved readings before switching inspections.'); return; }
    switchingRef.current = true; setSwitching(true);
    setBusy(n => n + 1); setError('');
    try {
      await queue.current;
      sessionGeneration.current += 1;
      const restoreSession = sessionGeneration.current;
      const restored = await loadRun(item.id);
      const candidate = restored.partNumber || parts.find(p => p.revision.id === restored.partRevisionId)?.number;
      if (!candidate) throw new Error('The pinned part revision is not available.');
      const detail = await getPart(candidate, restored.partRevisionId);
      if (restoreSession !== sessionGeneration.current) return;
      setPart(detail); setActiveId(detail.features[0]?.id || ''); updateRun(restored);
      setFields({ jobNumber: restored.jobNumber || `LEGACY-${restored.lotNumber}`, inspector: restored.inspector, lotNumber: restored.lotNumber, sampleNumber: restored.sampleNumber });
      setValues(Object.fromEntries(Object.values(latestMeasurements(restored)).map(m => [m.featureId, String(m.value)])));
      setTab('sheet'); setFilter('all'); setShift(''); setModal(null); announce('Saved inspection opened.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(n => n - 1); switchingRef.current = false; setSwitching(false); }
  };
  const download = (kind: 'csv' | 'json') => {
    if (!part || !run || hasUnsaved) return;
    const content = kind === 'csv' ? reportCsv(part.number, part.revision.code, part.features, run) : JSON.stringify({ part, run, exportedAt: new Date().toISOString(), environment: apiMode ? 'database' : 'browser-demo' }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${part.number}-rev${part.revision.code}-${fields.jobNumber}-${fields.sampleNumber}.${kind}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000); setExportOpen(false); announce('Inspection report exported.');
  };
  const showQuickGuide = (feature: Feature, element: HTMLElement) => {
    if (!hoverEnabled || !hasAnimation(feature, runRef.current?.references || part?.references)) return;
    if (pendingPopupClose.current) clearTimeout(pendingPopupClose.current);
    const rect = element.getBoundingClientRect();
    setQuickGuide({ feature, x: Math.max(12, Math.min(rect.right + 14, window.innerWidth - 370)), y: Math.max(12, Math.min(rect.top - 100, window.innerHeight - 470)) });
  };
  const hideQuickGuide = () => { pendingPopupClose.current = setTimeout(() => setQuickGuide(null), 180); };

  const feature = part?.features.find(f => f.id === activeId) || part?.features[0];
  const referenceSnapshot = run?.references || part?.references;
  const references = referenceSnapshot ? { ...referenceSnapshot, geometryFamily: referenceSnapshot.geometryFamily || part?.revision.geometryFamily } : referenceSnapshot;
  const displayPart = part ? { ...part, references } : null;
  const animated = !!feature && hasAnimation(feature, references);
  const latest = latestMeasurements(run);
  const measuredCount = part?.features.filter(f => latest[f.id]).length || 0;
  const failCount = part?.features.filter(f => latest[f.id]?.status === 'fail').length || 0;
  const hasUnsaved = part?.features.some(f => latest[f.id] ? parseMeasurement(values[f.id] ?? '') !== latest[f.id].value : !!values[f.id]?.trim()) || false;
  useEffect(() => {
    const preventAccidentalClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (hasUnsaved) window.addEventListener('beforeunload', preventAccidentalClose);
    return () => window.removeEventListener('beforeunload', preventAccidentalClose);
  }, [hasUnsaved]);
  const completed = run?.status === 'completed';
  const visibleFeatures = part?.features.filter(f => filter === 'all' || (filter === 'pending' ? !latest[f.id] : latest[f.id]?.status === 'fail')) || [];
  const openGuide = (f: Feature) => { setActiveId(f.id); setQuickGuide(null); setModal('guide'); };
  const home = async () => {
    if (busy > 0 || switchingRef.current) return;
    if (hasUnsaved) { setError('Save or discard your unsaved readings before returning to jobs.'); return; }
    await queue.current; sessionGeneration.current += 1;
    setPart(null); updateRun(null); setActiveId(''); setShift(''); setFields({ ...initialFields, inspector: employee?.displayName || '' }); setValues({}); setModal(null); setQuickGuide(null); setError('');
  };
  const leaveWorkspace = async () => {
    if (hasUnsaved) { setError('Save or discard your unsaved readings before signing out.'); return; }
    await queue.current; sessionGeneration.current += 1; setBusy(n => n + 1);
    try { await signOut(); setEmployee(null); updateRun(null); setPart(null); setParts([]); setModal(null); setValues({}); setSessionError(''); setFields(initialFields); setShift(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(n => n - 1); }
  };
  if (employee === undefined) return <div className="session-loading"><Layers3 size={29}/><span>Opening local workspace…</span></div>;
  if (!employee) return <EmployeeLogin serverError={sessionError} onSignedIn={session => { sessionGeneration.current += 1; setEmployee(session); setPart(null); setShift(''); setSessionError(''); setFields({ ...initialFields, inspector: session.displayName }); setError(''); }}/ >;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); void home(); }} aria-label="Part Central home"><div className="brand-symbol"><Layers3 size={25} strokeWidth={1.8} /></div><div>part<span>central</span><small>PRECISION, CONNECTED.</small></div></a>
      <div className="workspace-label">WORKSPACE <span>01</span></div>
      <nav aria-label="Main navigation">
        <button className={`nav-item ${!part ? 'active' : ''}`} onClick={() => void home()}><FolderOpen size={19} />Jobs & inspections<span className="nav-dot" /></button>
        <button className={`nav-item ${modal === 'parts' ? 'selected' : ''}`} onClick={() => setModal('parts')}><Box size={19} />Part library<span className="nav-count">{parts.length || '—'}</span></button>
        <button className="nav-item" onClick={openHistory}><Clock3 size={19} />Job inspection archive</button>
      </nav>
      {employee.role === 'admin' && <><button className="nav-item" onClick={() => setModal('catalog')}><Layers3 size={19}/>Part management</button><button className="nav-item" onClick={() => setModal('admin')} disabled={!part}><ShieldCheck size={19} />Reference administration</button></>}<div className="sidebar-divider" />
      <button className="nav-item" onClick={() => setModal('docs')}><BookOpen size={19} />How it works<ExternalLink size={13} className="nav-end" /></button>
      <div className="sidebar-bottom">
        <div className="demo-card"><div><span className="status-dot" />{apiMode ? 'Connected workspace' : 'Interactive tech demo'}</div><p>{apiMode ? 'Shared data. Revision-aware inspections.' : 'Explore a more connected shop floor.'}</p><button onClick={() => setModal('docs')}>Explore the workflow <ArrowRight size={14} /></button></div>
        <div className="profile"><div className="avatar">{employee.role === 'admin' ? 'AD' : employee.employeeNumber.slice(-2)}</div><div><strong>{employee.displayName}</strong><span>{employee.role === 'admin' ? 'Administrator · 0000' : `Operator · ${employee.employeeNumber}`}</span></div><button className="sign-out" aria-label="Sign out" disabled={busy > 0} onClick={() => void leaveWorkspace()}><LogOut size={16}/></button></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>{part ? `Job ${run?.jobNumber || fields.jobNumber || 'preparation'}` : 'Jobs & inspections'}</strong></div><div className="topbar-right"><span className="environment"><span />{apiMode ? 'DATABASE MODE' : 'DEMO ENVIRONMENT'}</span><button className="global-search" onClick={() => setModal('parts')} aria-label="Find a part, Control K"><Search size={16} /><span>Find a part</span><kbd><Command size={10} /> K</kbd></button><button className="help-button" aria-label="How it works" onClick={() => setModal('docs')}><CircleHelp size={19} /></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">QUALITY AT EVERY STEP</div><h1>{part ? 'Inspection workspace' : 'Your workspace'}<span>.</span></h1><p>{part ? 'The right part. The right reference. Every measurement.' : 'One job. Every inspection. Across every shift.'}</p></div><button className="button secondary new-inspection" onClick={() => setModal('parts')} disabled={busy > 0}><Plus size={16} />Open a part</button></div>
        {error && <div className="error-banner" role="alert"><CircleAlert size={18} /><span>{error}</span>{run && <button className="reload-saved" disabled={busy > 0} onClick={() => void restore(run, true)}>Reload saved sheet</button>}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {!part || !feature ? <JobHome key={employee.employeeNumber} employee={employee} onFindPart={() => setModal('parts')} onOpen={item => void restore(item)} disabled={busy > 0 || !catalogLoaded}/> : <>
          <button className="back-to-jobs" onClick={() => void home()} disabled={busy > 0}><ArrowLeft size={14}/>All jobs</button>
          {(run?.jobNumber || fields.jobNumber.trim()) && <JobInspections jobNumber={run?.jobNumber || fields.jobNumber.trim().toUpperCase()} current={run} disabled={busy > 0 || hasUnsaved} onOpen={item => void restore(item)} onNew={() => void newSample()} onHistory={() => setTab('samples')}/>}
          <section className="part-card" aria-label="Selected part">
            <div className="part-miniature">{part.number.startsWith('DG-') ? <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M32 9H48L51 17L59 21L67 20L74 33L68 40L67 48L70 55L59 67L50 65L42 69L37 76L22 70L22 61L15 55L6 54L5 38L13 33L17 25L16 17Z" fill="#e0e8dc" stroke="#78927a" strokeWidth="1.3"/><ellipse cx="40" cy="42" rx="25" ry="25" fill="#b8cbb4" stroke="#78927a"/><ellipse cx="40" cy="42" rx="10" ry="10" fill="#f0f3ea" stroke="#78927a"/>{[0,60,120,180,240,300].map(a=><path key={a} d="M35 20H45V28H35Z" transform={`rotate(${a} 40 42)`} fill="#809b7e"/>)}</svg> : <Box size={35} strokeWidth={1.2}/>}</div>
            <div className="part-identity"><div className="part-number-line"><button onClick={() => setModal('parts')}>{part.number}<ChevronDown size={17} /></button><span className="revision-badge">REV {part.revision.code}</span><span className="released"><CircleCheck size={12} />Released</span></div><h2>{part.name}</h2><div className="part-meta"><span>{part.material}</span><i /> <span>{part.finish}</span></div></div>
            <div className="operation-meta"><span className="eyebrow">CURRENT OPERATION</span><strong><span>OP {part.operation.code}</span> {part.operation.name}</strong><small>{part.operation.sketchId}</small></div>
            <div className="part-actions"><button className="button secondary" onClick={() => setModal('sketch')}><FileText size={16} />Op sketch<ExternalLink size={13} /></button><div className="export-wrap"><button className="button dark" disabled={!run || busy > 0 || hasUnsaved} onClick={() => setExportOpen(v => !v)}><ArrowDownToLine size={16} />Export report<ChevronDown size={13} /></button>{exportOpen && <div className="export-menu"><button onClick={() => download('csv')}>Inspection sheet (.csv)</button><button onClick={() => download('json')}>Full audit trail (.json)</button></div>}</div></div>
          </section>
          <div className={`content-grid ${tab === 'samples' ? 'sample-history-layout' : ''}`}>
            <section className="inspection-card">
              <div className="tabs" role="tablist" aria-label="Inspection workspace views"><button role="tab" aria-selected={tab === 'sheet'} className={tab === 'sheet' ? 'active' : ''} onClick={() => setTab('sheet')}><FileCheck2 size={16} />Current sample<span>{String(part.features.length).padStart(2, '0')}</span></button><button role="tab" aria-selected={tab === 'samples'} disabled={!run?.jobNumber && !fields.jobNumber.trim()} className={tab === 'samples' ? 'active' : ''} onClick={() => setTab('samples')}><Clock3 size={15}/>Sample history</button><button role="tab" aria-selected={tab === 'sketch'} className={tab === 'sketch' ? 'active' : ''} onClick={() => setTab('sketch')}><Layers3 size={15} />Operation sketch</button><button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}><Database size={15} />Run details</button></div>
              {tab === 'sheet' && <div role="tabpanel" aria-label="Inspection sheet">
                <div className="sheet-heading"><div><h2>{run ? `Sample ${run.sampleNumber}` : 'In-process inspection'} <span className={`run-status ${completed ? 'complete' : ''}`}>{completed ? 'Completed' : run ? 'In progress' : 'Sheet template'}</span></h2><p>{run ? `Job ${run.jobNumber} · revision ${part.revision.code} · each sample keeps its own readings` : 'Enter a job number and start a new inspection sheet.'}</p></div><button className={`hover-toggle ${hoverEnabled ? 'enabled' : ''}`} aria-label="Hover guides" aria-pressed={hoverEnabled} onClick={() => { setHoverEnabled(v => !v); setQuickGuide(null); }}><Sparkles size={14} /><span>Hover guides</span><span className="toggle-track"><i /></span></button></div>
                <div className="run-fields job-run-fields"><label>JOB NUMBER<input value={fields.jobNumber} placeholder="e.g. JOB-10482" maxLength={80} disabled={!!run || busy > 0} onChange={e => setFields(f => ({ ...f, jobNumber: e.target.value }))} /></label><label>LOT / BATCH <span className="field-optional">optional</span><input value={fields.lotNumber} maxLength={80} disabled={!!run || busy > 0} onChange={e => setFields(f => ({ ...f, lotNumber: e.target.value }))} /></label><label>{run ? 'SHEET STARTED BY' : 'SIGNED IN AS'}<input value={fields.inspector} maxLength={100} disabled={true} onChange={e => setFields(f => ({ ...f, inspector: e.target.value }))} /></label><label>SAMPLE<input value={fields.sampleNumber} maxLength={40} disabled={!!run || busy > 0} onChange={e => setFields(f => ({ ...f, sampleNumber: e.target.value }))} /></label></div>
                {run && <div className={`save-readings-bar ${completed ? 'saved-sheet' : ''}`}><div className="saving-identity"><ShieldCheck size={18}/><div><strong>{completed ? `Completed by ${run.completedByEmployeeNumber ? `Employee ${run.completedByEmployeeNumber}` : run.inspector}` : `Saving as Employee ${employee.employeeNumber}`}</strong><span>{completed ? `${shiftName(run.completedShift)} · ${new Date(run.completedAt || run.createdAt).toLocaleString()}` : 'Save readings to keep your work. Start a new sample when you are ready.'}</span></div></div>{!completed && <div className="saving-controls"><label>YOUR SHIFT<select ref={shiftRef} aria-label="Your shift" value={shift} disabled={busy > 0} onChange={e => setShift(e.target.value as Shift | '')}><option value="">Choose shift</option><option value="1">1 — Shift 1</option><option value="2">2 — Shift 2</option><option value="71">71 — Weekends</option></select></label><button className="button primary" onClick={() => void saveReadings()} disabled={busy > 0 || !hasUnsaved}><Check size={15}/>{busy > 0 ? 'Saving…' : 'Save readings'}</button>{hasUnsaved && <button className="discard-readings" disabled={busy > 0} onClick={() => { setValues(Object.fromEntries(Object.values(latest).map(m => [m.featureId, String(m.value)]))); setError(''); }}>Discard edits</button>}</div>}</div>}
                <div className="table-toolbar"><div><span className="section-label">CHARACTERISTICS</span><span className="muted">{part.features.length} total</span></div><label className="filter-select"><select value={filter} aria-label="Filter characteristics" onChange={e => setFilter(e.target.value as typeof filter)}><option value="all">All characteristics</option><option value="pending">Pending measurements</option><option value="fail">Out of tolerance</option></select><ChevronDown size={12} /></label></div>
                <div className="table-scroll" ref={tableRef}><table className="inspection-table"><thead><tr><th className="feature-col">FEATURE / CHARACTERISTIC</th><th>REQUIREMENT</th><th className="measured-col">MEASURED</th><th className="result-col">RESULT</th></tr></thead><tbody>{visibleFeatures.map(f => {
                  const m = latest[f.id]; const text = values[f.id] ?? ''; const parsed = parseMeasurement(text); const invalid = !!text.trim() && parsed === null; const unsaved = m ? parsed !== m.value : !!text.trim();
                  return <tr key={f.id} className={activeId === f.id ? 'active-row' : ''} onMouseEnter={() => { if (hoverEnabled) setActiveId(f.id); }}><td><div className="feature-cell"><button className={`callout-number ${activeId === f.id ? 'active' : ''}`} onClick={() => setActiveId(f.id)} aria-label={`Select feature ${f.sketchRef}: ${f.label}`}>{f.sketchRef}</button><div><button className="feature-name" onClick={() => setActiveId(f.id)}>{f.label}{f.critical && <span className="critical-dot" title="Critical characteristic" />}</button><span>{f.method}</span></div><button className="feature-help" aria-label={`Preview guide for ${f.label}`} onMouseEnter={e => showQuickGuide(f, e.currentTarget)} onMouseLeave={hideQuickGuide} onFocus={() => setActiveId(f.id)} onClick={() => openGuide(f)}><CircleHelp size={15} /></button></div></td><td><div className="nominal">{f.limitType === 'minimum' ? '≥ ' : f.limitType === 'maximum' ? '≤ ' : ''}{formatDimension(f.nominal, f.unit)} <small>{f.unit === 'deg' ? '°' : f.unit}</small></div><span className="tolerance">{toleranceText(f)}</span></td><td><div className={`measurement-input ${m?.status || ''} ${unsaved ? 'unsaved' : ''} ${invalid ? 'invalid' : ''}`}><input type="text" inputMode="decimal" aria-invalid={invalid || undefined} aria-describedby={invalid ? `measurement-error-${f.id}` : undefined} aria-label={`Measured ${f.label} in ${f.unit}`} placeholder="—" value={text} disabled={!run || completed || switching || finalizing} onFocus={() => setActiveId(f.id)} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input') || []); inputs[inputs.indexOf(e.currentTarget) + 1]?.focus(); } }} /><small>{f.unit === 'deg' ? '°' : 'mm'}</small></div>{invalid && <small className="measurement-entry-error" id={`measurement-error-${f.id}`}>Enter a decimal, e.g. .04, with up to 6 decimal places.</small>}</td><td>{m && !unsaved ? <span className={`result-badge ${m.status}`}>{m.status === 'pass' ? <Check size={12} /> : <X size={12} />}{m.status === 'pass' ? 'Pass' : 'Fail'}</span> : <span className="pending-result">{unsaved ? 'Unsaved' : 'Pending'}</span>}{m && <small className="reading-signature">{m.employeeNumber ? `Employee ${m.employeeNumber}` : 'Employee unrecorded'}<br/>{shiftName(m.shift)}<br/>{new Date(m.recordedAt).toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>}</td></tr>;
                })}</tbody></table>{!visibleFeatures.length && <div className="empty-filter"><CheckCheck size={22} /><p>{filter === 'fail' ? 'No out-of-tolerance readings.' : 'Every characteristic has a measurement.'}</p><button onClick={() => setFilter('all')}>Show all characteristics</button></div>}</div>
                <div className="sheet-legend"><span><i className="critical-dot" />Critical characteristic</span><span><CircleHelp size={13} />Hover the helper to preview a feature</span></div>
                <div className="inspection-footer"><div className="inspection-progress"><div className="progress-ring" style={{ background: `conic-gradient(#26745f ${measuredCount / part.features.length * 100}%, #e7ebe5 0)` }}><span>{measuredCount}</span></div><div><strong>{!run ? 'Ready for a job' : `${measuredCount} of ${part.features.length} measured`}</strong><span>{busy > 0 ? !run ? 'Starting inspection…' : 'Saving measurement…' : completed ? 'Inspection locked · full history retained' : failCount ? `${failCount} out of tolerance · review required` : !run ? 'Start the sheet to record measurements' : hasUnsaved ? 'Unsaved readings · choose shift and save' : measuredCount === 0 ? 'Enter readings, then save this sample' : 'Saved readings include employee and shift'}</span></div></div>{!run ? <button className="button primary" onClick={() => void beginInspection()} disabled={busy > 0 || !fields.jobNumber.trim() || !fields.inspector.trim() || !fields.sampleNumber.trim()}><Plus size={15} />Start inspection sheet</button> : completed ? <button className="button primary" onClick={() => void newSample()}><Plus size={15} />New sample inspection</button> : <div className="inspection-footer-actions"><button className="button secondary" aria-label="Save readings at bottom of sheet" onClick={() => void saveReadings()} disabled={busy > 0 || !hasUnsaved}><Check size={15}/>Save readings</button><button className="button primary" onClick={finish} disabled={measuredCount !== part.features.length || busy > 0 || hasUnsaved}><CheckCheck size={16} />Complete inspection</button><button className="button primary" onClick={() => void newSample()} disabled={busy > 0 || hasUnsaved || measuredCount === 0}><Plus size={15}/>New sample inspection</button></div>}</div><div className="sample-workflow-note">{run && <><span>Saved samples stay available in this job. Complete inspection locks a finished sheet.</span><button onClick={() => setTab('samples')}><Clock3 size={13}/>View sample history<ArrowRight size={13}/></button></>}</div>
              </div>}
              {tab === 'samples' && <SampleHistory jobNumber={run?.jobNumber || fields.jobNumber.trim().toUpperCase()} current={run} disabled={busy > 0 || hasUnsaved} onOpen={item => void restore(item)}/>}
              {tab === 'sketch' && <div className="sketch-tab" role="tabpanel" aria-label="Operation sketch"><div className="sheet-heading"><div><h2>Operation sketch</h2><p>Select a callout to explore its feature guide.</p></div><button className="icon-button" aria-label="Expand operation sketch" onClick={() => setModal('sketch')}><Maximize2 size={17} /></button></div><OpSketch part={displayPart!} selected={feature} onSelect={f => setActiveId(f.id)} /><div className="sketch-warning"><CircleHelp size={14} />Illustrative demo drawing. Use controlled CAD and approved sketches for production.</div></div>}
              {tab === 'details' && <div className="details-tab" role="tabpanel" aria-label="Run details"><div className="sheet-heading"><div><h2>Traceability, built in.</h2><p>Every measurement connects back to its exact requirement.</p></div><ShieldCheck size={25} /></div><div className="trace-chain"><span>Part</span><ChevronRight size={15}/><span>Revision {part.revision.code}</span><ChevronRight size={15}/><span>OP {part.operation.code}</span><ChevronRight size={15}/><span>Feature</span></div><dl className="details-list"><div><dt>Job number</dt><dd>{run?.jobNumber || fields.jobNumber || 'Enter a job number to start'}</dd></div><div><dt>Sample</dt><dd>{run?.sampleNumber || fields.sampleNumber}</dd></div><div><dt>Sheet started by</dt><dd>{run?.employeeNumber ? `Employee ${run.employeeNumber}` : fields.inspector}</dd></div>{run?.status === 'completed' && <div><dt>Completed by / shift</dt><dd>{run.completedByEmployeeNumber ? `Employee ${run.completedByEmployeeNumber}` : 'Employee unrecorded'} · {shiftName(run.completedShift)}</dd></div>}<div><dt>Reference version</dt><dd>{references ? `Version ${references.version}${run ? ' · saved with this sheet' : ' · used for new sheets'}` : 'Written instructions only'}</dd></div><div><dt>Part revision ID</dt><dd>{part.revision.id}</dd></div><div><dt>Operation sketch</dt><dd>{part.operation.sketchId}</dd></div><div><dt>Setup instructions</dt><dd>{part.operation.setup}</dd></div><div><dt>Inspection run</dt><dd>{run?.id || 'Created when you start the inspection sheet'}</dd></div><div><dt>Data storage</dt><dd>{apiMode ? 'PostgreSQL · shared database via API' : 'This browser · local demo storage'}</dd></div><div><dt>Recorded at</dt><dd>{run ? new Date(run.createdAt).toLocaleString() : 'Not started'}</dd></div></dl><h3>Measurement audit trail</h3>{!run?.measurements.length ? <div className="details-empty"><Clock3 size={22}/><p>Record a measurement to start the audit trail.</p></div> : <div className="audit-list">{[...run.measurements].reverse().map(m => <div key={m.id}><span className={`audit-dot ${m.status}`} /><div><strong>{part.features.find(f=>f.id===m.featureId)?.label}</strong><small>{new Date(m.recordedAt).toLocaleString()}{m.employeeNumber ? ` · Employee ${m.employeeNumber}` : ' · Employee unrecorded'} · {shiftName(m.shift)}</small></div><span>{m.value} {part.features.find(f=>f.id===m.featureId)?.unit}</span><span className={`result-badge ${m.status}`}>{m.status}</span></div>)}</div>}</div>}
            </section>
            {tab !== 'samples' && <aside className="feature-panel"><section className="guide-card"><div className="guide-card-heading"><div><span className="live-indicator"><span /></span><strong>Feature guide</strong><span className={`live-label ${animated ? '' : 'reference-incomplete'}`}>{animated ? '3D GUIDE' : references?.sketch || references?.diagram ? 'SKETCH AVAILABLE' : 'INSTRUCTIONS ONLY'}</span></div><button className="icon-button" aria-label="Expand feature guide" onClick={() => setModal('guide')}><Maximize2 size={16} /></button></div><div className="guide-title"><span className="callout-number active">{feature.sketchRef}</span><div><span className="eyebrow">{feature.zone}</span><h2>{feature.label}</h2></div><span className="guide-unit">{feature.unit === 'deg' ? 'ANGLE' : 'LINEAR'}</span></div><ReferenceGuide features={part?.features} onSelectFeature={f => setActiveId(f.id)} feature={feature} references={references} playing={playing && !modal && !quickGuide} onTogglePlay={() => setPlaying(v => !v)} onSketch={() => setModal('sketch')} /><div className="guide-spec"><div><span>{feature.limitType === 'minimum' ? 'MINIMUM' : feature.limitType === 'maximum' ? 'MAXIMUM' : 'NOMINAL'}</span><strong>{formatDimension(feature.nominal, feature.unit)}<small>{feature.unit === 'deg' ? '°' : 'mm'}</small></strong></div><div><span>{feature.limitType && feature.limitType !== 'bilateral' ? 'LIMIT RULE' : 'TOLERANCE'}</span><strong>{feature.limitType === 'minimum' ? 'Minimum only' : feature.limitType === 'maximum' ? 'Maximum only' : toleranceText(feature)}{(!feature.limitType || feature.limitType === 'bilateral') && <small>{feature.unit === 'deg' ? '°' : 'mm'}</small>}</strong></div><div><span>DATUM</span><strong className="datum-symbol">{feature.datum}</strong></div></div><div className="how-to"><div><span className="eyebrow">HOW TO MEASURE</span><span className="step-tag">01 / 01</span></div><p>{feature.instruction}</p><div className="tool-tag"><Box size={14} />{feature.method}</div></div><button className="sketch-reference" onClick={() => setModal('sketch')}><FileText size={16} /><div><strong>{references?.sketch || references?.diagram ? 'View operation references' : 'Written instructions available'}</strong><span>{references?.sketch?.name || references?.diagram?.name || 'Visual references can be added later'} · {feature.sketchRef}</span></div><ArrowRight size={16} /></button></section><div className="reference-note"><ShieldCheck size={18} /><p><strong>One source of truth.</strong>Job requirements and available references are saved together when a sheet starts.</p></div><button className="guide-next" onClick={() => setActiveId(part.features[(part.features.findIndex(f => f.id === activeId) + 1) % part.features.length].id)}><span>Explore the next feature</span><ArrowRight size={15} /></button></aside>}
          </div>
          <footer className="workspace-footer"><span><span className="status-dot" />{apiMode ? 'Connected to shared inspection data' : 'Demo data · saved in this browser'}</span><span>{part.number} / Rev {part.revision.code} <i /> Units: mm, degrees <i /> Part Central v0.1</span></footer>
        </>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><CircleCheck size={18} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {quickGuide && <div className="quick-guide" style={{ left: quickGuide.x, top: quickGuide.y }} onMouseEnter={() => { if (pendingPopupClose.current) clearTimeout(pendingPopupClose.current); }} onMouseLeave={hideQuickGuide}><div className="quick-heading"><span className="callout-number active">{quickGuide.feature.sketchRef}</span><strong>{quickGuide.feature.label}</strong><button className="icon-button" aria-label="Close preview" onClick={() => setQuickGuide(null)}><X size={14}/></button></div><ReferenceGuide features={part?.features} onSelectFeature={f => { setActiveId(f.id); setQuickGuide(q => q ? { ...q, feature: f } : null); }} feature={quickGuide.feature} references={references} playing={playing && !modal} onTogglePlay={() => setPlaying(v => !v)} onSketch={() => setModal('sketch')}/><button className="quick-expand" onClick={() => openGuide(quickGuide.feature)}>Open full feature guide<Maximize2 size={14}/></button></div>}
    {modal && <Dialog title={modal === 'parts' ? 'Find your part.' : modal === 'history' ? 'Job inspection archive.' : modal === 'sample' ? 'New sample inspection.' : modal === 'sketch' ? 'Operation sketch.' : modal === 'guide' ? 'A closer look.' : modal === 'admin' ? 'Reference administration.' : modal === 'catalog' ? 'Part & revision management.' : 'From part to confidence.'} wide={modal === 'sketch' || modal === 'guide' || modal === 'admin' || modal === 'catalog'} onClose={() => { if (modal === 'sample' && busy > 0) return; sampleGeneration.current += 1; setModal(null); }}>
      {modal === 'sample' && run && <form className="new-sample-form" onSubmit={e => { e.preventDefault(); void startNextSample(); }}>
        <div className="new-sample-job"><FolderOpen size={20}/><div><span>SAME JOB · FRESH READINGS</span><strong>{run.jobNumber}</strong></div><span>{part?.number}</span></div>
        <p>Sample {run.sampleNumber} stays saved with its readings, employee numbers, shifts, and times. The new sheet starts blank using the active part revision.</p>
        <div className="new-sample-fields"><label>SAMPLE LABEL<input autoFocus aria-label="New sample label" value={sampleLabel} maxLength={40} disabled={sampleLoading || busy > 0} onChange={e => setSampleLabel(e.target.value)}/><small>{sampleLoading ? 'Checking recent samples…' : 'Suggested from recent samples. You can use your own label.'}</small></label><label>YOUR SHIFT<select aria-label="Shift for new sample" value={sampleShift} disabled={busy > 0} required onChange={e => setSampleShift(e.target.value as Shift | '')}><option value="">Choose shift</option><option value="1">1 — Shift 1</option><option value="2">2 — Shift 2</option><option value="71">71 — Weekends</option></select><small>Choose the shift for this sample.</small></label></div>
        {sampleError && <div className="sample-start-error" role="alert"><CircleAlert size={16}/>{sampleError}</div>}
        <div className="new-sample-footer"><button type="button" className="button secondary" disabled={busy > 0} onClick={() => { sampleGeneration.current += 1; setModal(null); }}>Keep current sample</button><button type="submit" className="button primary" disabled={busy > 0 || sampleLoading || !sampleLabel.trim() || !sampleShift}><Plus size={15}/>{busy > 0 ? 'Starting sample…' : 'Start sample inspection'}</button></div>
      </form>}
      {modal === 'parts' && <div className="part-picker"><div className="picker-search"><Search size={19}/><input autoFocus placeholder="Search part number, name, or material…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search parts"/><kbd>ESC</kbd></div><div className="picker-label">RELEASED PARTS <span>{partMatches.length === 50 ? 'First 50 · refine search' : partMatches.length}</span></div><div className="picker-results">{partMatches.filter(p => `${p.number} ${p.name} ${p.material}`.toLowerCase().includes(query.toLowerCase())).map(p => <button key={p.id} className="picker-part" disabled={busy > 0} onClick={() => selectPart(p.number)}><div className="picker-part-icon"><Box size={24}/></div><div><strong>{p.number}<span>REV {p.revision.code}</span></strong><span>{p.name}</span><small>{p.material} · OP {p.operation.code}</small></div><ArrowRight size={18}/></button>)}{!partMatches.filter(p=>`${p.number} ${p.name} ${p.material}`.toLowerCase().includes(query.toLowerCase())).length && <div className="picker-empty"><Search size={25}/><p>No parts match “{query}”.</p><button onClick={() => setQuery('')}>Clear search</button></div>}</div><div className="picker-footer"><ShieldCheck size={15}/>Select a part, then enter the job number to start a sheet. Saved sheets stay in the job archive.</div></div>}
      {modal === 'sketch' && part && feature && <div className="modal-sketch"><OpSketch part={displayPart!} selected={feature} onSelect={f => setActiveId(f.id)} /><div className="modal-bottom"><p>Revision {part.revision.code} · Reference geometry is illustrative.</p><button className="button primary" onClick={() => setModal('guide')}>Show feature guide<ArrowRight size={15}/></button></div></div>}
      {modal === 'guide' && feature && <div className="expanded-guide"><div className="expanded-view"><ReferenceGuide features={part?.features} onSelectFeature={f => setActiveId(f.id)} feature={feature} references={references} playing={playing} onTogglePlay={() => setPlaying(v => !v)} expanded onSketch={() => setModal('sketch')} /></div><div className="expanded-description"><span className="callout-number active">{feature.sketchRef}</span><div className="eyebrow">{feature.zone}</div><h2>{feature.label}</h2><div className="expanded-nominal">{formatDimension(feature.nominal, feature.unit)}<span>{feature.unit === 'deg' ? '°' : 'mm'}</span></div><p className="expanded-tolerance">{feature.limitType === 'minimum' ? 'Minimum requirement' : feature.limitType === 'maximum' ? 'Maximum allowed' : `${toleranceText(feature)} ${feature.unit}`} · Datum {feature.datum}</p><hr/><h3>How to measure</h3><p>{feature.instruction}</p><div className="tool-tag"><Box size={14}/>{feature.method}</div><button className="button secondary" onClick={() => setModal('sketch')}><FileText size={16}/>Open operation sketch</button><div className="guide-pagination"><button className="icon-button" aria-label="Previous feature" onClick={() => setActiveId(part!.features[(part!.features.findIndex(f=>f.id===activeId)-1+part!.features.length)%part!.features.length].id)}><ArrowLeft size={18}/></button><span>{feature.sketchRef} / {String(part!.features.length).padStart(2, '0')}</span><button className="icon-button" aria-label="Next feature" onClick={() => setActiveId(part!.features[(part!.features.findIndex(f=>f.id===activeId)+1)%part!.features.length].id)}><ArrowRight size={18}/></button></div></div></div>}
      {modal === 'history' && <div className="history-content"><p className="modal-intro">{apiMode ? 'Search saved inspection sheets by job number. Completed sheets retain their requirements and reference versions.' : 'Job sheets saved in this browser. Docker keeps the job archive shared across computers.'}</p><div className="picker-search archive-search"><Search size={17}/><input autoFocus placeholder="Search by job number…" aria-label="Search job archive" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)}/><span>{historyLoading ? 'Searching…' : `${history.length} sheets`}</span></div>{historyError && <div className="admin-error" role="alert"><CircleAlert size={17}/>{historyError}</div>}{!history.length ? <div className="history-empty"><FolderOpen size={38}/><h3>{historyLoading ? 'Loading job sheets…' : historyQuery ? 'No matching job sheets.' : 'A clean inspection record.'}</h3><p>{historyLoading ? 'Reading the shared job archive.' : historyQuery ? 'Try another job number.' : 'Start an inspection sheet with a job number to see it here.'}</p><button className="button primary" onClick={() => setModal(null)}>Back to inspection</button></div> : history.map(item => <button className="history-row" disabled={busy > 0} key={item.id} onClick={() => restore(item)}><div className="history-icon"><FileCheck2 size={22}/></div><div><strong>{item.jobNumber || `LEGACY-${item.lotNumber}`}<span>{item.partNumber || parts.find(p=>p.revision.id===item.partRevisionId)?.number || item.partRevisionId} · Sample {item.sampleNumber}</span></strong><small>{item.status === 'completed' ? (item.completedByEmployeeNumber ? `Completed by ${item.completedByEmployeeNumber}` : item.inspector) : (item.lastRecordedByEmployeeNumber ? `Employee ${item.lastRecordedByEmployeeNumber}` : item.inspector)} · {shiftName(item.status === 'completed' ? item.completedShift : item.lastRecordedShift)} · {new Date(item.lastActivityAt || item.createdAt).toLocaleString()}</small></div><span className={`run-status ${item.status==='completed'?'complete':''}`}>{item.status === 'completed' ? 'Completed' : 'In progress'}</span><ChevronRight size={17}/></button>)}{historyHasMore && <button className="button secondary archive-more" disabled={historyLoading} onClick={() => void moreHistory()}>Load more sheets<ChevronDown size={14}/></button>}</div>}
      {modal === 'admin' && employee.role === 'admin' && part && <AdminReferences part={part} onPublished={(bundle: ReferenceBundle) => { setPart(p => p ? { ...p, references: bundle } : p); announce(`Reference version ${bundle.version} published for future job sheets.`); }}/>}
      {modal === 'catalog' && employee.role === 'admin' && <CatalogAdmin onCatalogChanged={() => { void listParts().then(setParts).catch(e => setError((e as Error).message)); }} onOpenPart={number => void selectPart(number)}/>}
      {modal === 'docs' && <div className="docs-content"><p className="modal-intro">A connected inspection workflow for the machining floor. Explore synthetic gears, differentials, manifolds, shafts, and housings across a shared job workflow.</p><div className="workflow-step"><span>01</span><div><h3>Find the released part</h3><p>Look up a part number to load its revision, operation, and inspection characteristics. Enter the job number and choose Start inspection sheet.</p></div></div><div className="workflow-step"><span>02</span><div><h3>See exactly what to measure</h3><p>Move over a row to update the feature guide. Hover its helper icon for an animated popup, or click to expand. Drag the 3D part to rotate it; use Pause to study a feature.</p></div></div><div className="workflow-step"><span>03</span><div><h3>Record, review, and trace</h3><p>Enter readings, choose your shift, and select Save readings. Each reading records the signed-in employee and shift. Limits are inclusive. Corrected readings retain their earlier values in the audit trail. Complete every required check to lock the run, including any failures for disposition. Find a job to continue its latest sheet, or use the inspection tabs to compare past samples across days and shifts.</p></div></div><div className="docs-storage"><Database size={21}/><div><strong>{apiMode ? 'Shared database mode' : 'Browser demo mode'}</strong><p>{apiMode ? 'Readings are stored in PostgreSQL through the API. Administrator access protects reference publications. Operator identity still needs your organization’s sign-in before production use.' : 'Data stays in local browser storage on this device. Docker adds FastAPI and PostgreSQL for shared records. Browser records are editable by the device owner and are not a regulated audit log.'}</p></div></div><p className="demo-disclaimer">Illustrative geometry and sample tolerances. Production use needs approved drawings and metrology, controlled releases, authentication, and a validated inspection procedure. See the repository architecture guide.</p><button className="button primary" onClick={() => setModal(null)}>Start exploring<ArrowRight size={16}/></button></div>}
    </Dialog>}
  </div>;
}




