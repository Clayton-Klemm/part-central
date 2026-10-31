import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Feature } from '../types';
import { mechanicalDimension, threadSection } from '../lib/mechanical';
import './MechanicalFeatureViewer.css';
import { FamilyShape } from './MechanicalGeometry';

type Props = { feature: Feature; geometryFamily: string; playing: boolean; onTogglePlay: () => void; expanded?: boolean };
const FAMILY_NAMES: Record<string, string> = { 'differential-case': 'DIFFERENTIAL CARRIER', 'bearing-cap': 'SPLIT BEARING CAP', flange: 'AXLE FLANGE', shaft: 'STEPPED SHAFT', 'threaded-block': 'THREADED MANIFOLD', housing: 'PUMP HOUSING', ring: 'SPACER RING' };

function ThreadSection({ feature, marker, hatch }: { feature: Feature; marker: string; hatch: string }) {
  const layout = threadSection(feature);
  const threaded = feature.animationKey === 'thread-depth';
  const drilled = feature.animationKey === 'drill-depth';
  const x = feature.animationKey === 'counterbore-depth' ? 495 : 468;
  const styles = { '--gage-start': `${layout.surfaceY - 38}px`, '--gage-stop': `${layout.gageFullFormY}px`, '--probe-stop': `${layout.activeEndY}px` } as CSSProperties;
  const threadRows = Array.from({ length: Math.max(1, Math.floor((layout.threadEndY - layout.counterboreY) / 14)) }, (_, i) => layout.counterboreY + i * 14);
  return <>
    <g className="mech-body"><rect x="150" y={layout.surfaceY} width="420" height="270" fill={`url(#${hatch})`}/><path d={`M250 ${layout.surfaceY}H390V${layout.counterboreY}H365V${layout.cylindricalEndY}L320 ${layout.floorY}L275 ${layout.cylindricalEndY}V${layout.counterboreY}H250Z`} className="mech-hole"/>
      {threadRows.map((y, i) => <path key={i} d={`M275 ${y}l9 5-9 5M365 ${y}l-9 5 9 5`} className={`mech-thread-line ${threaded ? 'mech-active-line' : ''}`}/>)}
      <path d={`M365 ${layout.counterboreY}H390M250 ${layout.counterboreY}H275`} className={feature.animationKey === 'counterbore-depth' ? 'mech-active-line' : ''}/>
      <path d={`M275 ${layout.cylindricalEndY}L320 ${layout.floorY}L365 ${layout.cylindricalEndY}`} className={drilled ? 'mech-active-line' : ''}/>
    </g>
    <path d={`M132 ${layout.surfaceY}H590`} className="mech-surface-plane"/>
    <text x="159" y={layout.surfaceY - 13} className="mech-small-text">ENTRY FACE / DATUM A</text>
    <path d={`M244 ${layout.threadEndY}H427`} className={`mech-reference-plane ${threaded ? 'mech-active-line' : ''}`}/>
    <path d={`M320 ${layout.floorY}H430`} className="mech-floor-plane"/>
    <text x="160" y="430" className="mech-small-text">FULL THREAD ≠ DRILLED DEPTH</text>
    {threaded ? <g transform="translate(320 0)"><g className="mech-thread-gage" style={styles}>
      <rect x="-11" y="-240" width="22" height="145" rx="3" className="mech-gage-shaft"/>
      <rect x="-38" y="-280" width="76" height="40" rx="7" className="mech-gage-handle"/>
      <path d="M-27-269H27M-27-260H27M-27-251H27" className="mech-gage-grip"/>
      <rect x="-21" y="-100" width="42" height="100" rx="2" className="mech-gage-member"/>
      {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M-21 ${-94 + i * 11}l42 7`} className="mech-gage-grip"/>)}
      <path d={`M-21 0H21L0 ${layout.gageTipY - layout.gageFullFormY}Z`} className="mech-gage-lead"/>
      <path d="M-27 0H27" className="mech-full-form-plane"/><circle r="4" className="mech-trace-dot"/>
    </g></g> : <g transform={`translate(${drilled ? 320 : 258} 0)`}><g className="mech-depth-probe" style={styles}><rect x="-5" y="-350" width="10" height="350" rx="2" className="mech-gage-shaft"/><circle r="4" className="mech-trace-dot"/></g><rect x="-62" y={layout.surfaceY - 12} width="124" height="12" rx="2" className="mech-gage-handle"/></g>}
    {threaded && <><rect x="250" y={layout.surfaceY - 9} width="140" height="9" rx="2" className="mech-sleeve"/><text x="422" y={layout.threadEndY - 15} className="mech-label-text">FULL-FORM PLANE</text><text x="422" y={layout.floorY + 20} className="mech-small-text">DRILL FLOOR</text></>}
    <path d={`M${x} ${layout.surfaceY}V${layout.activeEndY}`} markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`} className="mech-measure"/>
    <path d={`M390 ${layout.surfaceY}H${x + 10}M${threaded ? 365 : drilled ? 320 : 390} ${layout.activeEndY}H${x + 10}`} className="mech-extension"/>
  </>;
}

export default function MechanicalFeatureViewer({ feature, geometryFamily, playing, onTogglePlay, expanded = false }: Props) {
  const id = useId().replace(/:/g, '');
  const [replay, setReplay] = useState(0);
  const key = feature.animationKey;
  const isDepth = key === 'thread-depth' || key === 'drill-depth' || key === 'counterbore-depth';
  const dimension = mechanicalDimension(key, geometryFamily, feature.label);
  const caption = isDepth ? key === 'thread-depth' ? 'Calibrated full-form plane, with lead clearance above the drill floor' : key === 'drill-depth' ? 'Probe to the specified drilled-hole floor, not the last full thread' : 'Entry-face datum to the flat counterbore seat' : dimension.caption;
  return <div className={`mechanical-viewer ${expanded ? 'mechanical-expanded' : ''} ${playing ? '' : 'mechanical-paused'}`}>
    <div className="mechanical-stage" key={`${feature.id}-${replay}`}>
      <div className="mechanical-view-label"><span>{FAMILY_NAMES[geometryFamily] || 'MACHINED PART'}</span><strong>{isDepth ? 'SECTION A–A' : 'FEATURE LOCATION'}</strong></div>
      <svg viewBox="0 0 720 470" role="img" aria-label={`${feature.label}. ${caption}. Illustrative geometry, not to scale.`}>
        <defs>
          <pattern id={`grid-${id}`} width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#dfe7db" strokeWidth=".6"/></pattern>
          <pattern id={`hatch-${id}`} width="13" height="13" patternUnits="userSpaceOnUse"><rect width="13" height="13" fill="#d9e2d3"/><path d="M-2 2L2-2M0 13L13 0M11 15L15 11" stroke="#bbcbb2" strokeWidth=".7"/></pattern>
          <marker id={`arrow-${id}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M9 1L1 5L9 9" fill="none" stroke="#168372" strokeWidth="1.4"/></marker>
        </defs>
        <rect x="25" y="45" width="670" height="390" fill={`url(#grid-${id})`} opacity=".7"/>
        {isDepth ? <ThreadSection feature={feature} marker={`arrow-${id}`} hatch={`hatch-${id}`}/> : <>
          <FamilyShape family={geometryFamily} active={key} hatch={`hatch-${id}`}/>
          {key === 'flatness' && <><path d="M175 340H545M175 352H545" className="mech-reference-plane"/><rect x="175" y="340" width="370" height="12" className="mech-flatness-band"/></>}
          {key === 'face-runout' && <g transform={geometryFamily === 'shaft' ? 'translate(-330 -90)' : undefined} className="mech-indicator"><path d="M505 296V250H554V181"/><circle cx="554" cy="164" r="22"/><path d="M554 164l9-11" className="mech-indicator-needle"/><circle cx="505" cy="296" r="4"/></g>}
          {geometryFamily === 'ring' && key === 'flange-thickness' && <path d="M520 230H568M520 272H568" className="mech-extension"/>}
          <path d={`M${dimension.start.join(' ')}L${dimension.end.join(' ')}`} className="mech-measure" markerStart={`url(#arrow-${id})`} markerEnd={`url(#arrow-${id})`}/>
          <circle cx={dimension.end[0]} cy={dimension.end[1]} r="4" className="mech-trace-dot mech-feature-point"/>
        </>}
        <text x="42" y="453" className="mech-footer-text">ILLUSTRATIVE GEOMETRY · NTS</text>
        <text x="678" y="453" textAnchor="end" className="mech-footer-text">FEATURE {feature.sketchRef}</text>
      </svg>
      <div className="mechanical-controls"><button type="button" aria-label="Replay measurement animation" title="Replay animation" onClick={() => { setReplay(v => v + 1); if (!playing) onTogglePlay(); }}><RotateCcw size={15}/></button><button type="button" aria-label={playing ? 'Pause measurement animation' : 'Play measurement animation'} title={playing ? 'Pause animation' : 'Play animation'} onClick={onTogglePlay}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button></div>
    </div>
    <div className="mechanical-caption"><span/>{caption}</div>
    {isDepth && <div className="mechanical-depth-note">{key === 'thread-depth' ? 'Use the gage’s approved zero/lead correction. The physical tip is not the full-form depth datum.' : 'Depth conventions vary. The approved drawing and inspection method define the contact plane.'}</div>}
  </div>;
}
