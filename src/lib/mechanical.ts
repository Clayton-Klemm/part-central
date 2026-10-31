import type { Feature } from '../types';

export const MECHANICAL_FAMILIES = ['differential-case', 'bearing-cap', 'flange', 'shaft', 'threaded-block', 'housing', 'ring'] as const;
export const MECHANICAL_ANIMATIONS = ['outside-diameter', 'bearing-bore', 'bore-diameter', 'thread-depth', 'drill-depth', 'counterbore-depth', 'hole-spacing', 'bolt-circle', 'face-runout', 'wall-thickness', 'overall-length', 'shoulder-height', 'flatness', 'slot-width', 'flange-thickness'] as const;

export function mechanicalRequirement(feature: Feature): string {
  const value = feature.nominal.toFixed(feature.unit === 'deg' ? 2 : 3);
  const suffix = feature.limitType === 'minimum' ? ' MIN' : feature.limitType === 'maximum' ? ' MAX' : '';
  return `${value} ${feature.unit === 'deg' ? '°' : feature.unit}${suffix}`;
}

/** Pixel layout is illustrative. Only the active requirement is dimensioned. */
export function threadSection(feature: Pick<Feature, 'animationKey' | 'nominal'>) {
  const selected = feature.animationKey;
  const nominal = Number.isFinite(feature.nominal) && feature.nominal > 0 ? feature.nominal : 18;
  const fullThreadDepth = selected === 'thread-depth' ? nominal : selected === 'drill-depth' ? nominal * .75 : Math.max(18, nominal * 3);
  const drillFloorDepth = selected === 'drill-depth' ? nominal : fullThreadDepth + Math.max(6, fullThreadDepth / 3);
  const counterboreDepth = selected === 'counterbore-depth' ? nominal : Math.min(3, fullThreadDepth / 5);
  const surfaceY = 130, floorY = 376;
  const scale = (floorY - surfaceY) / drillFloorDepth;
  const threadEndY = surfaceY + fullThreadDepth * scale;
  const counterboreY = Math.min(surfaceY + counterboreDepth * scale, threadEndY - 30);
  const leadLength = Math.min(2, (drillFloorDepth - fullThreadDepth) / 3);
  return {
    surfaceY, floorY, scale, threadEndY, counterboreY,
    fullThreadDepth, drillFloorDepth, counterboreDepth,
    cylindricalEndY: floorY - 28,
    gageFullFormY: threadEndY,
    gageTipY: threadEndY + leadLength * scale,
    activeEndY: selected === 'drill-depth' ? floorY : selected === 'counterbore-depth' ? counterboreY : threadEndY,
  };
}

type Point = readonly [number, number];
export type MechanicalDimension = { start: Point; end: Point; label: Point; caption: string };

export function mechanicalDimension(key: string | null, family: string, label = ''): MechanicalDimension {
  const radial = family === 'flange' || family === 'ring' || family === 'housing';
  switch (key) {
    case 'outside-diameter':
      if (family === 'ring') return { start: [180, 230], end: [520, 230], label: [350, 210], caption: 'Outside diameter across the finished ring, through its axis' };
      if (family === 'differential-case') return { start: [505, 335], end: [635, 335], label: [570, 315], caption: 'Locating pilot diameter, through its axis' };
      if (family === 'shaft') return { start: [175, 206], end: [175, 274], label: [137, 241], caption: 'Diameter across the finished bearing journal' };
      return { start: [190, 230], end: [510, 230], label: [350, 209], caption: 'Outside diameter across the center' };
    case 'bearing-bore':
      if (family === 'differential-case') return { start: [122, 214], end: [122, 266], label: [88, 240], caption: 'Finished bearing bore, clear of the entry chamfer' };
      if (family === 'bearing-cap') return { start: [245, 325], end: [475, 325], label: [360, 302], caption: 'Assembled bearing bore; loose cap view is illustrative' };
      return { start: [267, 230], end: [433, 230], label: [350, 211], caption: 'Finished bearing pocket diameter through its axis' };
    case 'bore-diameter':
      if (family === 'ring') return { start: [248, 230], end: [452, 230], label: [350, 208], caption: 'Ring bore diameter through the center, clear of the chamfer' };
      if (family === 'shaft') return { start: [610, 224], end: [610, 256], label: [648, 239], caption: 'Axial pilot bore diameter, not its depth' };
      if (family === 'differential-case') return { start: [327, 180], end: [383, 180], label: [355, 158], caption: 'Cross-pin bore diameter at the indicated section' };
      if (family === 'threaded-block') return { start: [228, 290], end: [292, 290], label: [260, 269], caption: 'Cross-port bore diameter; keep contacts off intersections' };
      return { start: [radial ? 296 : 265, 230], end: [radial ? 404 : 435, 230], label: [350, 208], caption: 'Internal diameter through the bore center' };
    case 'overall-length':
      return { start: [family === 'shaft' ? 120 : 150, 415], end: [family === 'shaft' ? 600 : 570, 415], label: [family === 'shaft' ? 360 : 360, 399], caption: 'Distance between the indicated finished end planes' };
    case 'hole-spacing':
      if (family === 'shaft') return { start: [235, 325], end: [445, 325], label: [340, 305], caption: 'Axial spacing between the indicated finished shoulders' };
      if (family === 'bearing-cap') return { start: [210, 380], end: [510, 380], label: [360, 362], caption: 'Mounting-hole axis to mounting-hole axis' };
      if (family === 'threaded-block' && label.toLowerCase().includes('mounting')) return { start: [180, 340], end: [500, 340], label: [340, 318], caption: 'Mounting-hole axis spacing on the lower front face, separate from the ports' };
      if (family === 'threaded-block') return { start: [300, 168], end: [430, 168], label: [365, 143], caption: 'Center-to-center spacing of the indicated port axes' };
      return { start: [195, 360], end: [505, 360], label: [350, 340], caption: 'Distance between the fitted mounting-hole axes' };
    case 'bolt-circle':
      if (family === 'differential-case') return { start: [520, 335], end: [620, 335], label: [570, 309], caption: 'Bolt pitch circle about the locating axis; not tooth-tip diameter' };
      return { start: [220, 230], end: [480, 230], label: [350, 206], caption: 'Pitch-circle diameter through the mounting-hole centers' };
    case 'flange-thickness':
      if (family === 'ring') return { start: [558, 230], end: [558, 272], label: [608, 254], caption: 'Finished ring thickness between its two parallel seating faces' };
      return { start: [565, family === 'housing' ? 340 : 380], end: [565, family === 'housing' ? 374 : 415], label: [604, family === 'housing' ? 357 : 399], caption: 'Finished flange-face separation, clear of ribs and bosses' };
    case 'shoulder-height':
      if (family === 'bearing-cap') return { start: [580, 115], end: [580, 340], label: [622, 228], caption: 'Finished crown height from the seated split face' };
      return { start: [420, 180], end: [420, 206], label: [462, 192], caption: 'Radial shoulder height; not the difference of full diameters' };
    case 'slot-width':
      return { start: [410, 170], end: [410, 192], label: [457, 181], caption: 'Keyway flank-to-flank width above the cutter radius' };
    case 'wall-thickness':
      if (family === 'bearing-cap') return { start: [360, 115], end: [360, 205], label: [404, 160], caption: 'Minimum material remaining between bore and outside surface' };
      if (family === 'threaded-block') return { start: [150, 290], end: [228, 290], label: [188, 265], caption: 'Minimum ligament at the specified inspection station' };
      if (family === 'differential-case') return { start: [340, 136], end: [340, 172], label: [294, 151], caption: 'Remaining material at the indicated carrier window' };
      return { start: [438, 230], end: [482, 230], label: [460, 207], caption: 'Minimum specified cavity wall, excluding casting ribs' };
    case 'face-runout':
      if (family === 'shaft') return { start: [175, 202], end: [175, 206], label: [145, 180], caption: 'Journal runout: rotate about the approved datum axis and sweep the required journal length' };
      return { start: [505, 288], end: [505, 304], label: [562, 281], caption: 'Indicator sweep: report the complete maximum–minimum excursion' };
    case 'flatness':
      return { start: [560, 340], end: [560, 352], label: [600, 346], caption: 'Flatness envelope is exaggerated; use the approved evaluation method' };
    default:
      return { start: [180, 415], end: [540, 415], label: [360, 395], caption: 'Illustrative feature location; the controlled drawing owns the requirement' };
  }
}
