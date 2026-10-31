import { lazy, Suspense } from 'react';
import { FileText, Image, BookOpen, ArrowRight } from 'lucide-react';
import type { Feature, ReferenceBundle } from '../types';
import { MECHANICAL_FAMILIES as FAMILY_KEYS, MECHANICAL_ANIMATIONS as ANIMATION_KEYS } from '../lib/mechanical';
const FeatureViewer = lazy(() => import('./FeatureViewer'));
const Mechanical3DViewer = lazy(() => import('./Mechanical3DViewer'));
const SUPPORTED_ANIMATIONS = new Set(['dog-height', 'ramp-height', 'ramp-angle', 'dog-width', 'pitch-diameter', 'bore-diameter', 'face-runout', 'overall-thickness']);
const MECHANICAL_ANIMATIONS = new Set<string>(ANIMATION_KEYS);
const MECHANICAL_FAMILIES = new Set<string>(FAMILY_KEYS);

export function hasAnimation(feature: Feature, references?: ReferenceBundle | null): feature is Feature & { animationKey: string } {
  if (!feature.animationKey || !references?.modelAvailable) return false;
  const family = references.geometryFamily;
  if (family && MECHANICAL_FAMILIES.has(family)) return MECHANICAL_ANIMATIONS.has(feature.animationKey);
  return (!family || family === 'dog-clutch') && SUPPORTED_ANIMATIONS.has(feature.animationKey);
}
export default function ReferenceGuide({ feature, references, playing, onTogglePlay, expanded = false, onSketch, features, onSelectFeature }: { feature: Feature; references?: ReferenceBundle | null; playing: boolean; onTogglePlay: () => void; expanded?: boolean; onSketch: () => void; features?: Feature[]; onSelectFeature?: (feature: Feature) => void }) {
  if (hasAnimation(feature, references)) return <Suspense fallback={<div className="reference-empty"><BookOpen size={25}/><strong>Loading feature guide…</strong></div>}>{references?.geometryFamily && MECHANICAL_FAMILIES.has(references.geometryFamily) ? <Mechanical3DViewer feature={feature} geometryFamily={references.geometryFamily} playing={playing} onTogglePlay={onTogglePlay} expanded={expanded} features={features} onSelectFeature={onSelectFeature}/> : <FeatureViewer feature={feature} playing={playing} onTogglePlay={onTogglePlay} expanded={expanded}/>}</Suspense>;
  const visual = references?.diagram || references?.sketch;
  return <div className={`reference-empty ${expanded ? 'reference-empty-expanded' : ''}`}>
    {visual?.url && visual.mediaType.startsWith('image/') ? <img src={visual.url} alt={visual.name} loading="lazy"/> : <div className="reference-empty-symbol">{visual ? <FileText size={36}/> : <BookOpen size={36}/>}</div>}
    <span className="reference-stage">{visual ? 'SKETCH REFERENCE' : 'INSTRUCTIONS AVAILABLE'}</span>
    <strong>{visual ? visual.name : 'Ready for inspection.'}</strong>
    <p>{visual ? 'Use the approved reference alongside the written measurement instructions.' : 'This part can be inspected without a diagram. Follow the instructions and your existing approved job paperwork.'}</p>
    {visual ? <button className="button secondary" onClick={onSketch}><Image size={15}/>Open visual reference<ArrowRight size={13}/></button> : <span className="reference-pending">Visual references can be added later by an administrator.</span>}
  </div>;
}
