import { useState } from 'react';
import { FileText, ExternalLink, BookOpen } from 'lucide-react';
import type { Feature, Part } from '../types';
import MechanicalOpSketch from './MechanicalOpSketch';

type Props = { part: Part; selected: Feature; onSelect: (feature: Feature) => void };
export default function OpSketch(props: Props) {
  const { part, selected, onSelect } = props;
  const [kind, setKind] = useState<'sketch' | 'diagram'>('sketch');
  const references = part.references;
  const asset = references?.[kind] || references?.sketch || references?.diagram;
  if (asset?.mediaType === 'application/x-partcentral-sketch') return <><div className="reference-file-tabs"><button className={kind === 'sketch' ? 'active' : ''} onClick={() => setKind('sketch')}>Operation sketch</button>{references?.diagram && <button className={kind === 'diagram' ? 'active' : ''} onClick={() => setKind('diagram')}>Supporting diagram</button>}</div>{references?.geometryFamily && references.geometryFamily !== 'dog-clutch' ? <MechanicalOpSketch {...props}/> : <BuiltinOpSketch {...props}/>}</>;
  return <div className="uploaded-reference">
    {(references?.sketch || references?.diagram) && <div className="reference-file-tabs">{references.sketch && <button className={kind === 'sketch' ? 'active' : ''} onClick={() => setKind('sketch')}>Operation sketch</button>}{references.diagram && <button className={kind === 'diagram' ? 'active' : ''} onClick={() => setKind('diagram')}>Supporting diagram</button>}<span>Reference version {references.version}</span></div>}
    {asset?.url ? <><div className="reference-asset-heading"><FileText size={18}/><strong>{asset.name}</strong><a href={asset.url} target="_blank" rel="noreferrer">Open file<ExternalLink size={13}/></a></div>{asset.mediaType.startsWith('image/') ? <img className="uploaded-sketch-image" src={asset.url} alt={asset.name}/> : <div className="pdf-reference"><FileText size={45}/><strong>PDF reference available</strong><p>Open the original document to zoom, print, or review all pages.</p><a className="button secondary" href={asset.url} target="_blank" rel="noreferrer">Open PDF<ExternalLink size={14}/></a></div>}</> : <div className="reference-empty reference-document-empty"><BookOpen size={35}/><strong>No visual reference added yet.</strong><p>Your inspection sheet is available. Use the written measurement instructions and your existing approved job paperwork while references are added gradually.</p></div>}
    {references?.notes && <div className="reference-version-note">{references.notes}</div>}
    <div className="reference-feature-links">{part.features.map(f => <button key={f.id} className={selected.id === f.id ? 'active' : ''} onClick={() => onSelect(f)}><span>{f.sketchRef}</span>{f.label}</button>)}</div>
    <div className="sketch-caption"><span className="callout-number active">{selected.sketchRef}</span><div><strong>{selected.label}</strong><span>{selected.instruction}</span></div></div>
  </div>;
}

export function BuiltinOpSketch({ part, selected, onSelect }: Props) {
  const gearPath = Array.from({ length: 176 }, (_, i) => {
    const angle = i * Math.PI * 2 / 176;
    const radius = i % 4 === 0 || i % 4 === 3 ? 142 : 130;
    return `${i ? 'L' : 'M'} ${260 + Math.cos(angle) * radius} ${250 + Math.sin(angle) * radius}`;
  }).join(' ') + ' Z';
  const callout = (n: number, x: number, y: number, tx: number, ty: number) => {
    const f = part.features[n - 1];
    return <g key={n} className={`sketch-callout ${selected.number === n ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Show ${f.label}`} onClick={() => onSelect(f)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(f); } }}>
      <path d={`M${x} ${y}L${tx} ${ty}`} /><circle cx={x} cy={y} r="15" /><text x={x} y={y + 4}>{String(n).padStart(2, '0')}</text>
    </g>;
  };
  return <div className="sketch-document">
    <svg viewBox="0 0 900 570" aria-label={`Operation sketch ${part.operation.sketchId}, selectable inspection callouts`}>
      <defs><pattern id="drawing-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e8eae4" strokeWidth=".5" /></pattern></defs>
      <rect x="0" y="0" width="900" height="570" fill="url(#drawing-grid)" />
      <rect x="16" y="16" width="868" height="538" fill="none" stroke="#a7b1a8" />
      <text x="40" y="50" className="sketch-heading">OPERATION {part.operation.code} / {part.operation.name.toUpperCase()}</text>
      <text x="40" y="72" className="sketch-note">Illustrative inspection reference · dimensions in mm unless noted</text>
      <g fill="none" stroke="#3e5048" strokeWidth="1.6">
        <path d={gearPath} fill="#e5e9e2" />
        <circle cx="260" cy="250" r="113" strokeDasharray="8 4" stroke="#8c9a8d" />
        <circle cx="260" cy="250" r="42" fill="#f9faf6" />
        <circle cx="260" cy="250" r="49" />
        {Array.from({ length: 6 }, (_, i) => <g key={i} transform={`rotate(${i * 60} 260 250)`}><path d="M240 159L240 190L280 190L280 170L269 159Z" fill="#bac8bc"/><path d="M269 159L269 190" /></g>)}
        <path d="M95 250H425M260 85V415" strokeDasharray="14 4 2 4" strokeWidth=".7" />
        <path d="M544 341H831V323H544Z" fill="#d6dfd3" />
        <path d="M561 323V265H585L609 233H642V323M685 323V265H709L733 233H766V323" fill="#bdcbbc" />
        <path d="M532 348H843" strokeWidth="3" />
        <path d="M550 341L540 357H560Z" fill="#3e5048" />
        <path d="M800 341V233M790 233H810M790 341H810M796 239L800 233L804 239M796 335L800 341L804 335" stroke="#2c8c72" />
        <path d="M534 341V265M525 265H550M525 341H550" stroke="#2c8c72" />
        <path d="M586 265H627M609 233L585 265" stroke="#2c8c72" />
        <path d="M619 265A34 34 0 0 0 609 242" stroke="#2c8c72" />
        <path d="M609 216H642M609 210V226M642 210V226" stroke="#2c8c72" />
      </g>
      <text x="251" y="257" fontSize="15" fill="#3e5048">B</text>
      <text x="544" y="375" fontSize="13" fill="#3e5048">A</text>
      <text x="220" y="438" className="sketch-label">TOP VIEW</text>
      <text x="620" y="438" className="sketch-label">SECTION / DOG PROFILE</text>
      <text x="812" y="290" className="sketch-dimension">12.500</text>
      <text x="484" y="307" className="sketch-dimension">8.000</text>
      <text x="621" y="259" className="sketch-dimension">25°</text>
      {callout(1, 839, 176, 800, 251)}
      {callout(2, 494, 213, 534, 270)}
      {callout(3, 663, 177, 611, 249)}
      {callout(4, 588, 153, 627, 216)}
      {callout(5, 79, 132, 181, 168)}
      {callout(6, 420, 322, 296, 272)}
      {callout(7, 429, 150, 336, 223)}
      {callout(8, 839, 402, 820, 330)}
      <path d="M16 472H884M498 472V554M722 472V554M498 512H884" stroke="#a7b1a8" fill="none" />
      <text x="36" y="495" className="sketch-note">DATUM A · FINISHED BOTTOM FACE</text>
      <text x="36" y="515" className="sketch-note">DATUM B · FINISHED BORE AXIS</text>
      <text x="36" y="539" className="sketch-note">DEMO GEOMETRY · NOT A CONTROLLED MANUFACTURING DRAWING</text>
      <text x="516" y="497" className="sketch-heading">{part.number} / {part.name}</text>
      <text x="516" y="537" className="sketch-note">{part.operation.sketchId}</text>
      <text x="738" y="497" className="sketch-heading">REV {part.revision.code} · SHEET 1 / 1</text>
      <text x="738" y="537" className="sketch-note">SCALE NTS</text>
    </svg>
    <div className="sketch-caption"><span className="callout-number">{selected.sketchRef}</span><div><strong>{selected.label}</strong><span>Select a numbered callout to connect the sketch to its inspection requirement.</span></div></div>
  </div>;
}
