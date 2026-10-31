import { renderToStaticMarkup } from 'react-dom/server';
import type { Feature, Part } from '../src/types';
import { BuiltinOpSketch } from '../src/components/OpSketch';
import MechanicalOpSketch from '../src/components/MechanicalOpSketch';
import MechanicalFeatureViewer from '../src/components/MechanicalFeatureViewer';
import { mechanicalRequirement } from '../src/lib/mechanical';

function svgFrom(markup: string) { return markup.match(/<svg[\s\S]*?<\/svg>/)?.[0] || ''; }
export function operationSvg(part: Part) {
  const Component = part.revision.geometryFamily === 'dog-clutch' ? BuiltinOpSketch : MechanicalOpSketch;
  return svgFrom(renderToStaticMarkup(<Component part={part} selected={part.features[0]} onSelect={() => {}}/>));
}

function DogSection({ part }: { part: Part }) {
  const find = (key: string) => part.features.find(feature => feature.animationKey === key)!;
  return <svg viewBox="0 0 720 470"><path d="M110 300H585V350H110Z" fill="#dce5d5" stroke="#78916c"/><path d="M210 300V235L330 155H455V300Z" fill="#c5d8c0" stroke="#78916c" strokeWidth="2"/><path d="M110 350H600" stroke="#78916c" strokeDasharray="8 4"/><path d="M500 155V350M470 155H515M470 350H515M170 235V350M150 235H200M150 350H200M330 125H455M330 115V145M455 115V145M210 235H300M265 235A55 55 0 0 0 254 205" fill="none" stroke="#168372" strokeWidth="2"/><text x="515" y="250" fill="#168372" fontFamily="monospace" fontSize="18">{mechanicalRequirement(find('dog-height'))}</text><text x="55" y="287" fill="#168372" fontFamily="monospace" fontSize="17">{mechanicalRequirement(find('ramp-height'))}</text><text x="360" y="110" fill="#168372" fontFamily="monospace" fontSize="17">{mechanicalRequirement(find('dog-width'))}</text><text x="283" y="220" fill="#168372" fontFamily="monospace" fontSize="17">{mechanicalRequirement(find('ramp-angle'))}</text><text x="116" y="377" fill="#78916c" fontFamily="sans-serif" fontSize="15">A · FINISHED BOTTOM FACE / ZERO PLANE</text><text x="310" y="420" fill="#78916c" fontFamily="sans-serif" fontSize="12" textAnchor="middle">Dog profile · heights share datum A; ramp angle uses its own baseline</text></svg>;
}

function Guide({ part, feature }: { part: Part; feature: Feature }) {
  return <MechanicalFeatureViewer feature={feature} geometryFamily={part.revision.geometryFamily || 'ring'} playing={false} onTogglePlay={() => {}}/>;
}

/** Static vector companion: engineering values always come from the selected revision. */
export function diagramSvg(part: Part) {
  const dog = part.revision.geometryFamily === 'dog-clutch';
  const thread = part.features.find(feature => feature.animationKey === 'thread-depth');
  const second = part.features.find(feature => feature.animationKey === (thread ? 'drill-depth' : 'bore-diameter')) || part.features.find(feature => feature.animationKey === 'flange-thickness') || part.features[part.features.length - 1];
  const first = thread || part.features[0];
  const left = dog ? renderToStaticMarkup(<DogSection part={part}/>) : svgFrom(renderToStaticMarkup(<Guide part={part} feature={first}/>));
  const right = dog ? '' : svgFrom(renderToStaticMarkup(<Guide part={part} feature={second}/>));
  const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
  const heading = (feature: Feature) => xml(`${feature.sketchRef} · ${feature.label}`);
  const prefix = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 690"><rect width="1120" height="690" fill="#fbfcf8"/><rect x="18" y="18" width="1084" height="654" fill="none" stroke="#a0b1a1"/><path d="M18 94H1102M18 568H1102M18 626H1102" fill="none" stroke="#a0b1a1"/><text x="40" y="50" font-family="sans-serif" font-size="20" fill="#355748">${part.number} / MEASUREMENT SETUP</text><text x="40" y="76" font-family="sans-serif" font-size="12" fill="#6f8573">SYNTHETIC EXAMPLE · REV ${part.revision.code} · OP ${part.operation.code} · NOT TO SCALE</text>`;
  const nesting = (svg: string, x: number, width: number) => svg.replace('<svg ', `<svg x="${x}" y="138" width="${width}" height="380" `);
  return `${prefix}${dog ? nesting(left,80,960) : `<path d="M560 94V568" stroke="#d8e3d4"/><text x="48" y="125" font-family="sans-serif" font-size="13" fill="#47705a">${heading(first)}</text><text x="586" y="125" font-family="sans-serif" font-size="13" fill="#47705a">${heading(second)}</text>${nesting(left,28,515)}${nesting(right,576,515)}`}<text x="40" y="593" font-family="sans-serif" font-size="12" fill="#47705a">${thread ? 'Full-form thread plane, gage lead, drill floor, and counterbore seat are distinct references.' : dog ? 'Do not confuse overall dog height, ramp start height, ramp angle, and body thickness.' : 'Measure the indicated finished feature; avoid chamfers, corner radii, and neighboring geometry.'}</text><text x="40" y="615" font-family="sans-serif" font-size="11" fill="#6f8573">Only the selected requirement is dimensioned in each detail. Use the sheet for complete limits and the approved method.</text><text x="40" y="650" font-family="sans-serif" font-size="11" fill="#6f8573">ILLUSTRATIVE GEOMETRY · NOT A CONTROLLED MANUFACTURING DRAWING</text><text x="1080" y="650" text-anchor="end" font-family="sans-serif" font-size="11" fill="#6f8573">SHEET 1 / 1</text></svg>`;
}
