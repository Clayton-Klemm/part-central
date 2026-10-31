import { useId } from 'react';
import type { Feature, Part } from '../types';
import { FamilyShape } from './MechanicalGeometry';
import './MechanicalFeatureViewer.css';
import { mechanicalDimension, mechanicalRequirement } from '../lib/mechanical';

const POINTS: Record<string, readonly (readonly [number, number])[]> = {
  'differential-case': [[190,240],[570,335],[480,300],[355,180],[213,300],[620,335],[485,184],[285,175]],
  'bearing-cap': [[360,205],[210,304],[360,115],[360,158],[210,280],[510,318],[190,340]],
  flange: [[476,130],[350,147],[530,395],[442,138],[442,322],[258,322],[505,288]],
  shaft: [[170,206],[235,286],[600,240],[445,203],[346,180],[579,224],[578,249],[170,274]],
  'threaded-block': [[300,168],[430,168],[300,152],[260,290],[430,168],[540,300],[189,290],[432,226],[500,340]],
  housing: [[350,142],[451,143],[540,357],[460,230],[430,340],[267,147],[433,147],[505,350]],
  ring: [[180,230],[350,180],[510,272]],
};
const BUBBLES: readonly (readonly [number, number])[] = [[84,126],[334,115],[641,132],[651,235],[631,420],[467,458],[281,455],[79,401],[79,269]];

/** An interactive, family-specific synthetic drawing. Engineering values come from the pinned revision. */
export default function MechanicalOpSketch({ part, selected, onSelect }: { part: Part; selected: Feature; onSelect: (feature: Feature) => void }) {
  const id = useId().replace(/:/g, '');
  const family = part.references?.geometryFamily || part.revision.geometryFamily || 'ring';
  const dimension = mechanicalDimension(selected.animationKey, family, selected.label);
  const isDepth = ['thread-depth', 'drill-depth', 'counterbore-depth'].includes(selected.animationKey || '');
  return <div className="sketch-document">
    <svg viewBox="0 0 1120 690" role="img" aria-label={`${part.number} revision ${part.revision.code}, operation ${part.operation.code}. Selectable synthetic ${family} operation sketch.`}>
      <defs><pattern id={`op-grid-${id}`} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e4eae2" strokeWidth=".6"/></pattern><pattern id={`op-hatch-${id}`} width="13" height="13" patternUnits="userSpaceOnUse"><rect width="13" height="13" fill="#dce5d5"/><path d="M0 13L13 0" stroke="#bccbb4" strokeWidth=".7"/></pattern></defs>
      <rect width="1120" height="690" fill="#fbfcf8"/><rect x="18" y="18" width="1084" height="654" fill={`url(#op-grid-${id})`} stroke="#9eaea1"/>
      <path d="M18 87H1102M735 87V584M18 584H1102M18 626H1102M735 584V672" fill="none" stroke="#9eaea1"/>
      <text x="40" y="49" fontFamily="sans-serif" fontSize="18" fontWeight="600" fill="#355748">{part.number} / {part.name}</text>
      <text x="40" y="72" fontFamily="sans-serif" fontSize="11" fill="#6f8573">OP {part.operation.code} · {part.operation.name.toUpperCase()} · REV {part.revision.code} · DIMENSIONS mm UNLESS NOTED</text>
      <text x="1082" y="49" textAnchor="end" fontFamily="sans-serif" fontSize="10" fill="#6c8874">ILLUSTRATIVE / NTS</text>
      <g transform="translate(0 60)"><FamilyShape family={family} active={selected.animationKey} hatch={`op-hatch-${id}`}/>
        {!isDepth && <><path d={`M${dimension.start.join(' ')}L${dimension.end.join(' ')}`} fill="none" stroke="#128571" strokeWidth="2"/><circle cx={dimension.start[0]} cy={dimension.start[1]} r="3" fill="#128571"/><circle cx={dimension.end[0]} cy={dimension.end[1]} r="3" fill="#128571"/></>}
      </g>
      {part.features.map((feature, index) => {
        const point = POINTS[family]?.[index] || [350,240];
        const bubble = BUBBLES[index % BUBBLES.length];
        return <g key={feature.id} className={`sketch-callout ${selected.id === feature.id ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Show ${feature.label}`} onClick={() => onSelect(feature)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(feature); } }}>
          <path d={`M${bubble.join(' ')}L${point[0]} ${point[1] + 60}`}/><circle cx={bubble[0]} cy={bubble[1]} r="17"/><text x={bubble[0]} y={bubble[1] + 4}>{feature.sketchRef}</text>
        </g>;
      })}
      <text x="360" y="558" textAnchor="middle" fontFamily="sans-serif" fontSize="10" letterSpacing="1" fill="#6c8874">FEATURE LOCATION VIEW · SELECT A CALLOUT</text>
      <text x="754" y="113" fontFamily="sans-serif" fontSize="10" letterSpacing="1" fill="#5f7d68">INSPECTION CHARACTERISTICS</text>
      {part.features.map((feature, index) => <g key={feature.id} onClick={() => onSelect(feature)} role="button" tabIndex={0} aria-label={`Select ${feature.label}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(feature); } }} style={{ cursor: 'pointer' }}>
        <rect x="746" y={126 + index * 48} width="345" height="45" rx="4" fill={selected.id === feature.id ? '#e2f1e6' : '#fbfcf8'} stroke={selected.id === feature.id ? '#8cbca1' : '#e0e8dd'}/>
        <text x="758" y={144 + index * 48} fontFamily="monospace" fontSize="11" fontWeight="600" fill="#39765f">{feature.sketchRef}</text>
        <text x="788" y={143 + index * 48} fontFamily="sans-serif" fontSize="10" fill="#365849">{feature.label.length > 43 ? `${feature.label.slice(0,41)}…` : feature.label}</text>
        <text x="788" y={161 + index * 48} fontFamily="monospace" fontSize="11" fill="#16816c">{mechanicalRequirement(feature)}{feature.limitType === 'bilateral' || !feature.limitType ? `  −${feature.toleranceMinus.toFixed(3)} / +${feature.tolerancePlus.toFixed(3)}` : ''}</text>
      </g>)}
      <text x="40" y="610" fontFamily="sans-serif" fontSize="11" fill="#46644f">DATUM A · FINISHED SEATING / ENTRY FACE    |    B · PRIMARY BORE OR JOURNAL AXIS</text>
      <text x="40" y="648" fontFamily="sans-serif" fontSize="10" fill="#68816e">SYNTHETIC EXAMPLE · NOT A CONTROLLED MANUFACTURING DRAWING</text>
      <text x="40" y="665" fontFamily="sans-serif" fontSize="9" fill="#809582">Use the inspection sheet for the method, limits, datum alignment, and complete measurement instructions.</text>
      <text x="754" y="609" fontFamily="sans-serif" fontSize="10" fill="#46644f">MATERIAL · {part.material}</text><text x="754" y="649" fontFamily="monospace" fontSize="11" fill="#46644f">{part.operation.sketchId || `SK-${part.number}-${part.revision.code}`}</text><text x="1084" y="666" textAnchor="end" fontFamily="sans-serif" fontSize="9" fill="#809582">SHEET 1 / 1</text>
    </svg>
    <div className="sketch-caption"><span className="callout-number active">{selected.sketchRef}</span><div><strong>{selected.label}</strong><span>{selected.instruction}</span></div></div>
  </div>;
}
