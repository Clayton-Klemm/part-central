import { useEffect, useState } from 'react';
import { Check, FileText, Image, Upload, ShieldCheck, X, CircleAlert } from 'lucide-react';
import type { Part, ReferenceBundle } from '../types';
import { adminRequest, apiMode, uploadReference } from '../lib/data';

const emptyBundle: ReferenceBundle = { id: null, version: 0, sketch: null, diagram: null, modelAvailable: false, notes: '' };

export default function AdminReferences({ part, onPublished }: { part: Part; onPublished: (bundle: ReferenceBundle) => void }) {
  const [authorized, setAuthorized] = useState(false);
  const [current, setCurrent] = useState<ReferenceBundle>(part.references || emptyBundle);
  const [sketch, setSketch] = useState<File | null>(null);
  const [diagram, setDiagram] = useState<File | null>(null);
  const [removeSketch, setRemoveSketch] = useState(false);
  const [removeDiagram, setRemoveDiagram] = useState(false);
  const [model, setModel] = useState(current.modelAvailable);
  const [notes, setNotes] = useState(current.notes);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const authenticate = async () => {
    setBusy('Checking access…'); setError('');
    try {
      const bundle = await adminRequest<ReferenceBundle>('', `/operations/${part.operation.id}/references`);
      setCurrent(bundle); setModel(bundle.modelAvailable); setNotes(bundle.notes); setAuthorized(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  useEffect(() => { if (apiMode) void authenticate(); }, [part.operation.id]);
  const selectFile = (kind: 'sketch' | 'diagram', file: File | undefined) => {
    setError(''); setSuccess('');
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('Choose a file smaller than 10 MB.'); return; }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { setError('Use a PDF, PNG, or JPEG file.'); return; }
    if (kind === 'sketch') { setSketch(file); setRemoveSketch(false); }
    else { setDiagram(file); setRemoveDiagram(false); }
  };
  const publish = async () => {
    setError(''); setSuccess('');
    try {
      let sketchId = removeSketch ? null : current.sketch?.id || null;
      let diagramId = removeDiagram ? null : current.diagram?.id || null;
      if (sketch) { setBusy('Uploading operation sketch…'); sketchId = (await uploadReference('', part.operation.id, 'sketch', sketch)).id; }
      if (diagram) { setBusy('Uploading diagram…'); diagramId = (await uploadReference('', part.operation.id, 'diagram', diagram)).id; }
      setBusy('Publishing reference version…');
      const bundle = await adminRequest<ReferenceBundle>('', `/operations/${part.operation.id}/references`, { sketchAssetId: sketchId, diagramAssetId: diagramId, modelAvailable: model, notes, expectedVersion: current.version });
      setCurrent(bundle); setSketch(null); setDiagram(null); setRemoveSketch(false); setRemoveDiagram(false);
      setSuccess(`Reference version ${bundle.version} published. New job sheets will use this version.`);
      onPublished(bundle);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  if (!apiMode) return <div className="admin-content"><div className="admin-intro"><ShieldCheck size={27}/><div><h3>One shared reference library.</h3><p>Administrator uploads are available in the Docker server version. The public browser demo keeps its sample catalog read-only.</p></div></div><p className="admin-footnote">The shared server verifies administrator access, versions each publication, and retains the references used by existing job sheets.</p></div>;
  return <div className="admin-content">
    <div className="admin-part"><span>{part.number} · REV {part.revision.code}</span><strong>OP {part.operation.code} / {part.operation.name}</strong><small>Engineering requirements stay attached to their released revision.</small></div>
    {error && <div className="admin-error" role="alert"><CircleAlert size={17}/>{error}</div>}
    {!authorized ? <div className="admin-intro"><ShieldCheck size={25}/><div><h3>{busy || 'Administrator session required'}</h3><p>{busy ? 'Opening this operation’s versioned reference library.' : 'Sign in as employee 0000 to manage references.'}</p></div></div> : <>
      <div className="admin-version"><ShieldCheck size={16}/><span>Administrator session verified</span><strong>Current reference version {current.version}</strong></div>
      <div className="admin-uploads">{(['sketch', 'diagram'] as const).map(kind => {
        const file = kind === 'sketch' ? sketch : diagram;
        const removed = kind === 'sketch' ? removeSketch : removeDiagram;
        const existing = current[kind];
        return <div className="upload-card" key={kind}><div className="upload-heading">{kind === 'sketch' ? <FileText size={20}/> : <Image size={20}/>}<h3>{kind === 'sketch' ? 'Operation sketch' : 'Supporting diagram'}</h3><span>OPTIONAL</span></div><p>{file ? file.name : removed ? 'Will be removed from the next version' : existing?.name || 'No file added yet'}</p><label className={`upload-button ${busy ? 'disabled' : ''}`}><Upload size={15}/>{existing || file ? 'Choose replacement' : 'Choose a file'}<input type="file" accept="application/pdf,image/png,image/jpeg" disabled={!!busy} aria-label={`Upload ${kind === 'sketch' ? 'operation sketch' : 'supporting diagram'}`} onChange={e => selectFile(kind, e.target.files?.[0])}/></label>{(existing || file) && <button className="remove-reference" disabled={!!busy} onClick={() => { if (kind === 'sketch') { setSketch(null); setRemoveSketch(!removeSketch); } else { setDiagram(null); setRemoveDiagram(!removeDiagram); } }}><X size={12}/>{removed ? 'Keep existing file' : 'Remove from next version'}</button>}<small>PDF, PNG, or JPEG · up to 10 MB</small></div>;
      })}</div>
      <label className="model-checkbox"><input type="checkbox" checked={model} disabled={!!busy || !part.features.some(f => !!f.animationKey)} onChange={e => setModel(e.target.checked)}/><span><strong>Use available animated feature guides</strong><small>{part.features.some(f => !!f.animationKey) ? 'Enable the existing animations for new job sheets.' : 'This part has no configured animated guide. A sketch or written instructions are enough to start.'}</small></span></label>
      <label className="admin-notes">REFERENCE / CHANGE NOTES<textarea maxLength={2000} rows={3} value={notes} disabled={!!busy} onChange={e => setNotes(e.target.value)} placeholder="For example: added the existing shop-floor operation sketch."/></label>
      <div className="admin-retention"><ShieldCheck size={18}/><p>Publishing creates a new reference version. Existing inspections keep the version they started with, including the original files.</p></div>
      {success && <div className="admin-success" role="status"><Check size={17}/>{success}</div>}
      <div className="admin-publish"><span>A blank reference set is valid during rollout.</span><button className="button primary" disabled={!!busy} onClick={() => void publish()}><Check size={15}/>{busy || 'Publish reference version'}</button></div>
    </>}
  </div>;
}
