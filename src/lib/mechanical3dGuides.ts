import type { Feature } from '../types';
import type { Axis3, GuideRegion, MechanicalFamily, MechanicalGuide3D, Point3 } from './mechanical3dTypes';

const FAMILIES = new Set<string>(['differential-case', 'bearing-cap', 'flange', 'shaft', 'threaded-block', 'housing', 'ring']);
export function isMechanicalFamily(value: string): value is MechanicalFamily { return FAMILIES.has(value); }

const CAMERAS: Record<MechanicalFamily, Point3> = {
  'differential-case': [9, 7, 10], 'bearing-cap': [7, 5.5, 9], flange: [7, 7, 8],
  shaft: [9, 6, 9], 'threaded-block': [8, 7, 10], housing: [8, 7, 9], ring: [7, 6, 8],
};
const CENTERS: Record<MechanicalFamily, Point3> = {
  'differential-case': [0, 1.8, 0], 'bearing-cap': [0, 1.05, 0], flange: [0, .65, 0],
  shaft: [0, 1, 0], 'threaded-block': [0, 1.45, 0], housing: [0, 1.35, 0], ring: [0, .38, 0],
};
const midpoint = (a: Point3, b: Point3): Point3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const translate = (p: Point3, v: Point3): Point3 => [p[0] + v[0], p[1] + v[1], p[2] + v[2]];
const ring = (center: Point3, radius: number, axis: Axis3, width = .055): GuideRegion => ({ kind: 'ring', center, radius: radius + width, innerRadius: Math.max(0, radius - width), axis });
const box = (center: Point3, size: Point3): GuideRegion => ({ kind: 'box', center, size });
const cylinder = (center: Point3, radius: number, length: number, axis: Axis3): GuideRegion => ({ kind: 'cylinder', center, radius, length, axis });

function base(family: MechanicalFamily, description: string): MechanicalGuide3D {
  const center = CENTERS[family];
  return { path: [translate(center, [-.5, 0, 0]), translate(center, [.5, 0, 0])], extensions: [], regions: [], focus: center, label: translate(center, [0, .5, 0]), camera: CAMERAS[family], description, mode: 'linear', section: false, sectionZ: 0 };
}
function linear(family: MechanicalFamily, contacts: readonly [Point3, Point3], offset: Point3, description: string, regions: GuideRegion[] = [], section = false): MechanicalGuide3D {
  const path = contacts.map(p => translate(p, offset));
  return { ...base(family, description), path, extensions: [[contacts[0], path[0]], [contacts[1], path[1]]], regions, focus: midpoint(...contacts), label: translate(midpoint(path[0], path[1]), [0, .25, 0]), section };
}
function circle(center: Point3, radius: number, axis: Axis3, steps = 80): Point3[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = i / steps * Math.PI * 2, u = radius * Math.cos(a), v = radius * Math.sin(a);
    return axis === 'x' ? [center[0], center[1] + u, center[2] + v] : axis === 'y' ? [center[0] + u, center[1], center[2] + v] : [center[0] + u, center[1] + v, center[2]];
  });
}
function diameter(family: MechanicalFamily, center: Point3, radius: number, axis: Axis3, description: string): MechanicalGuide3D {
  const vector: Point3 = axis === 'x' ? [0, radius, 0] : [radius, 0, 0];
  const negative: Point3 = [-vector[0], -vector[1], -vector[2]];
  return { ...base(family, description), path: [translate(center, negative), translate(center, vector)], regions: [ring(center, radius, axis)], focus: center, label: translate(center, [0, radius * .3 + .38, .1]), mode: 'diameter' };
}
function sweep(family: MechanicalFamily, center: Point3, radius: number, axis: Axis3, description: string): MechanicalGuide3D {
  return { ...base(family, description), path: circle(center, radius, axis), regions: [ring(center, radius, axis, .09)], focus: center, label: translate(center, [0, radius + .32, 0]), mode: 'sweep' };
}
function flatFace(family: MechanicalFamily, corner: Point3, width: number, depth: number, description: string, regions: GuideRegion[]): MechanicalGuide3D {
  const path: Point3[] = [];
  // A serpentine probe trace, with every contact on this finished face.
  for (let row = 0; row < 5; row++) {
    const z = corner[2] + depth * row / 4;
    const points: Point3[] = [[corner[0], corner[1], z], [corner[0] + width, corner[1], z]];
    path.push(...(row % 2 ? points.reverse() : points));
  }
  const center: Point3 = [corner[0] + width / 2, corner[1], corner[2] + depth / 2];
  return { ...base(family, description), path, regions, focus: center, label: translate(center, [0, .4, 0]), mode: 'sweep' };
}

type DepthSetup = { axis: Axis3; entry: Point3; fullForm: Point3; floor: Point3; seat?: Point3; radius: number; offset: Point3; counterRadius?: number };
function depth(family: MechanicalFamily, feature: Feature, setup: DepthSetup): MechanicalGuide3D {
  const key = feature.animationKey;
  const end = key === 'drill-depth' ? setup.floor : key === 'counterbore-depth' ? setup.seat || setup.fullForm : setup.fullForm;
  const caption = key === 'drill-depth'
    ? 'Entry face to the drilled-hole floor. This is separate from full-form thread depth.'
    : key === 'counterbore-depth'
      ? 'Entry face to the flat counterbore seat; exclude the entry chamfer and deeper threaded bore.'
      : 'Entry face to the calibrated full-form thread plane. The gauge lead and drill floor are different references.';
  const result = linear(family, [setup.entry, end], setup.offset, caption, [ring(setup.entry, setup.radius, setup.axis), ring(end, key === 'counterbore-depth' ? setup.counterRadius || setup.radius * 1.35 : setup.radius, setup.axis)], true);
  result.sectionZ = setup.entry[2];
  result.mode = key === 'thread-depth' ? 'thread' : 'linear';
  return { ...result, gauge: { entry: setup.entry, fullForm: setup.fullForm, floor: setup.floor, radius: setup.radius, axis: setup.axis, seat: setup.seat } };
}

function differential(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'differential-case';
  switch (feature.animationKey) {
    case 'bearing-bore': return { ...diameter(family, [-2.46, 1.8, 0], .65, 'x', 'Bearing bore diameter through datum axis B, clear of the entry chamfer.'), regions: [ring([-2.46, 1.8, 0], .65, 'x'), cylinder([-2.12, 1.8, 0], .65, .62, 'x')], camera: [-9, 6, 9] };
    case 'outside-diameter': return { ...diameter(family, [2.66, 1.8, 0], 1.25, 'x', 'Ring-gear locating pilot diameter across the finished cylindrical pilot.'), regions: [cylinder([2.425, 1.8, 0], 1.26, .45, 'x')] };
    case 'face-runout': return sweep(family, [2.215, 1.8, 0], 1.48, 'x', 'Rotate about datum axis B and sweep the ring-gear mounting face. Report maximum minus minimum indicator reading.');
    case 'bore-diameter': return { ...diameter(family, [0, 1.8, 1.77], .35, 'z', 'Cross-pin bore diameter at the accessible window boss, independent of its location to axis B.'), regions: [ring([0, 1.8, 1.77], .35, 'z'), cylinder([0, 1.8, 1.5], .35, .53, 'z')] };
    case 'overall-length': return linear(family, [[-1.8, 2.78, 0], [1.8, 2.78, 0]], [0, 1.42, 0], 'Axial distance between the finished bearing shoulder planes; exclude casting and corner reliefs.', [ring([-1.805, 1.8, 0], 1.05, 'x', .16), ring([1.805, 1.8, 0], 1.05, 'x', .16)]);
    case 'bolt-circle': return { ...diameter(family, [2.225, 1.8, 0], 1.7, 'x', 'Pitch-circle diameter through the mounting-hole axes about datum B; not the flange outside diameter.'), extensions: [circle([2.225, 1.8, 0], 1.7, 'x')], regions: [ring([2.225, 1.8, 0], 1.7, 'x', .035)] };
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'x', entry: [2.2, 3.5, 0], fullForm: [1.35, 3.5, 0], floor: [1.05, 3.5, 0], radius: .19, offset: [0, .75, 0] });
    case 'wall-thickness': {
      const d = Math.SQRT1_2, start: Point3 = [.4, 1.8 + 1.22 * d, 1.22 * d], end: Point3 = [.4, 1.8 + 1.65 * d, 1.65 * d];
      return { ...linear(family, [start, end], [1.1, .3, .3], 'Material remaining across the diagonal carrier-window ligament at the indicated station.', [box(midpoint(start, end), [.52, .22, .22])], true), sectionZ: 1.2 };
    }
    default: return base(family, 'Illustrative carrier feature location. Follow the pinned requirement and operation sketch.');
  }
}
function bearingCap(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'bearing-cap';
  switch (feature.animationKey) {
    case 'bearing-bore': return diameter(family, [0, .65, .665], 1.15, 'z', 'Assembled bearing bore reference circle. Inspect with the matched component and approved torque; the loose cap alone cannot establish this diameter.');
    case 'hole-spacing': return linear(family, [[-1.9, .65, 0], [1.9, .65, 0]], [0, .45, 1.28], 'Mounting-hole axis to mounting-hole axis, not the distance between their nearest edges.', [ring([-1.9, .66, 0], .24, 'y'), ring([1.9, .66, 0], .24, 'y')]);
    case 'shoulder-height': return linear(family, [[0, .65, 0], [0, 2.3, 0]], [2.9, 0, 0], 'Crown height above the seated split-face plane, clear of the edge break.', [box([0, 2.305, 0], [.35, .015, 1.1]), box([-1.9, .655, 0], [.95, .015, 1.65]), box([1.9, .655, 0], [.95, .015, 1.65])]);
    case 'wall-thickness': return linear(family, [[0, 1.8, 0], [0, 2.3, 0]], [0, 0, 1.05], 'Crown wall between the finished bore and the outside crown; not the full cap height.', [box([0, 2.05, -.02], [.4, .5, .08])], true);
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'y', entry: [1.9, .65, 0], fullForm: [1.9, .2, 0], floor: [1.9, .05, 0], radius: .24, offset: [0, 0, 1.2] });
    case 'flatness': return flatFace(family, [1.47, .665, -.72], .86, 1.44, 'Evaluate the complete specified split seating faces. This trace illustrates one pad; repeat the approved coverage across the matched seating faces.', [box([-1.9, .66, 0], [.95, .012, 1.6]), box([1.9, .66, 0], [.95, .012, 1.6])]);
    default: return base(family, 'Illustrative bearing-cap feature location. Follow the pinned requirement and operation sketch.');
  }
}
function flange(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'flange';
  switch (feature.animationKey) {
    case 'outside-diameter': return diameter(family, [0, .55, 0], 2.3, 'y', 'Outside diameter across the finished flange, excluding its chamfer.');
    case 'bearing-bore': case 'bore-diameter': return { ...diameter(family, [0, 1.365, 0], .72, 'y', 'Locating bore diameter through its axis, at the approved depths and orientations.'), regions: [ring([0, 1.365, 0], .72, 'y'), cylinder([0, 1, 0], .715, .68, 'y')] };
    case 'flange-thickness': return linear(family, [[-2.05, .05, 0], [-2.05, .8, 0]], [-.65, 0, .3], 'Finished flange-face separation away from the hub, bolt holes, and chamfers.', [ring([0, .81, 0], 2.08, 'y', .1), ring([0, .04, 0], 2.08, 'y', .1)]);
    case 'bolt-circle': return { ...diameter(family, [0, .825, 0], 1.75, 'y', 'Pitch-circle diameter through the four fitted mounting-hole axes.'), extensions: [circle([0, .825, 0], 1.75, 'y')], regions: [ring([0, .825, 0], 1.75, 'y', .035)] };
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'y', entry: [1.75, .8, 0], fullForm: [1.75, .25, 0], floor: [1.75, .06, 0], seat: [1.75, .58, 0], radius: .2, counterRadius: .32, offset: [0, 0, 2.65] });
    case 'face-runout': return sweep(family, [0, .815, 0], 1.45, 'y', 'Indicator sweep of the specified annular face while rotating about the approved locating axis. Record the full maximum-minus-minimum excursion.');
    default: return base(family, 'Illustrative flange feature location. Follow the pinned requirement and operation sketch.');
  }
}
function shaft(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'shaft';
  switch (feature.animationKey) {
    case 'outside-diameter': return { ...diameter(family, [-1.55, 1, 0], .85, 'x', 'Ground bearing journal diameter at two axial planes and perpendicular orientations.'), regions: [cylinder([-1.55, 1, 0], .86, 1.36, 'x')] };
    case 'hole-spacing': return linear(family, [[-.8, 1.86, 0], [1.3, 1.86, 0]], [0, .75, 0], 'Axial distance between the two indicated finished bearing shoulder planes.', [ring([-.805, 1, 0], .94, 'x', .095), ring([1.305, 1, 0], .89, 'x', .16)]);
    case 'overall-length': return linear(family, [[-3.3, 1, 0], [3.3, 1, 0]], [0, 1.9, 0], 'Overall length between the finished end planes; exclude center holes and edge breaks.', [ring([-3.315, 1, 0], .42, 'x', .1), ring([3.315, 1, 0], .4, 'x', .1)]);
    case 'shoulder-height': return linear(family, [[1.31, 1.72, 0], [1.31, 2.05, 0]], [.65, 0, .6], 'Radial shoulder step between coaxial surfaces. This is a radius difference, not a full diameter difference.', [ring([1.31, 1, 0], .885, 'x', .165)]);
    case 'slot-width': return linear(family, [[.2, 1.98, -.16], [.2, 1.98, .16]], [0, .65, 0], 'Straight keyway flank-to-flank width above the cutter radius.', [box([.2, 1.98, -.16], [1.05, .12, .015]), box([.2, 1.98, .16], [1.05, .12, .015])]);
    case 'bore-diameter': case 'bearing-bore': return diameter(family, [3.315, 1, 0], .28, 'x', 'Axial pilot bore diameter, independent of its depth and entry chamfer.');
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'x', entry: [3.3, 1, 0], fullForm: [2.35, 1, 0], floor: [2.1, 1, 0], radius: .28, offset: [0, 1.45, 0] });
    case 'face-runout': return { ...sweep(family, [-1.55, 1, 0], .865, 'x', 'Journal runout: rotate about the approved datum axis and sweep the required journal length. Report the complete indicator excursion.'), regions: [cylinder([-1.55, 1, 0], .86, 1.35, 'x')], path: Array.from({ length: 97 }, (_, i): Point3 => [-2.15 + i / 96 * 1.2, 1 + .865 * Math.cos(i / 96 * Math.PI * 4), .865 * Math.sin(i / 96 * Math.PI * 4)]) };
    default: return base(family, 'Illustrative shaft feature location. Follow the pinned requirement and operation sketch.');
  }
}
function manifold(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'threaded-block';
  switch (feature.animationKey) {
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'y', entry: [-1.15, 2.85, 0], fullForm: [-1.15, 1.4, 0], floor: [-1.15, .9, 0], seat: [-1.15, 2.48, 0], radius: .45, counterRadius: .62, offset: [0, 0, 2.05] });
    case 'bore-diameter': case 'bearing-bore': return { ...diameter(family, [2.515, 1.25, 0], .4, 'x', 'Cross-port bore diameter at the side opening, clear of intersections with the top ports.'), regions: [ring([2.515, 1.25, 0], .4, 'x'), cylinder([2.12, 1.25, 0], .398, .78, 'x')], section: true };
    case 'hole-spacing': {
      const mounting = feature.label.toLowerCase().includes('mounting');
      return mounting ? linear(family, [[-1.8, 2.85, 1.1], [1.8, 2.85, 1.1]], [0, .5, 1.02], 'Mounting-hole axis spacing in the specified direction, distinct from the two port axes.', [ring([-1.8, 2.87, 1.1], .2, 'y'), ring([1.8, 2.87, 1.1], .2, 'y')])
        : linear(family, [[-1.15, 2.85, 0], [1.15, 2.85, 0]], [0, .6, 0], 'Fitted port-axis center distance; do not substitute the gap between visible thread crests.', [ring([-1.15, 2.87, 0], .45, 'y'), ring([1.15, 2.87, 0], .45, 'y')]);
    }
    case 'overall-length': return linear(family, [[-2.5, 1.5, 0], [2.5, 1.5, 0]], [0, 1.95, 1.95], 'Overall width between the two finished opposing block faces.', [box([-2.51, 1.45, 0], [.015, 2.6, 3.2]), box([2.51, 1.45, 0], [.015, 2.6, 3.2])]);
    case 'wall-thickness': return linear(family, [[-2.5, 1.8, 0], [-1.6, 1.8, 0]], [0, 1.5, 0], 'Remaining ligament between the outer block wall and the indicated port station. Use the approved access method for the real part.', [box([-2.05, 1.8, -.02], [.9, .28, .08])], true);
    case 'flatness': return flatFace(family, [-2.15, 2.87, .75], 4.3, .55, 'Scan the defined seal face using the approved flatness evaluation; a single high-point reading is insufficient.', [box([0, 2.86, .98], [4.45, .012, .65])]);
    default: return base(family, 'Illustrative manifold feature location. Follow the pinned requirement and operation sketch.');
  }
}
function housing(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'housing';
  switch (feature.animationKey) {
    case 'bearing-bore': case 'bore-diameter': return { ...diameter(family, [0, 2.715, 0], 1.1, 'y', 'Finished bearing pocket diameter through its axis, clear of the shoulder radius.'), regions: [ring([0, 2.715, 0], 1.1, 'y'), cylinder([0, 2, 0], 1.095, 1.38, 'y')] };
    case 'outside-diameter': return { ...diameter(family, [0, .25, 0], 1.25, 'y', 'Machined locating spigot diameter, excluding the surrounding cast body.'), regions: [cylinder([0, .275, 0], 1.26, .44, 'y')], camera: [8, 4, 9] };
    case 'flange-thickness': return linear(family, [[-2.1, .3, 0], [-2.1, .65, 0]], [-.75, 0, 0], 'Mounting-flange face separation at the finished station, away from ribs and bolt bosses.', [box([-2.1, .655, 0], [.4, .012, 1.1]), box([-2.1, .295, 0], [.4, .012, 1.1])]);
    case 'wall-thickness': return linear(family, [[1.1, 1.9, 0], [1.7, 1.9, 0]], [0, 1.35, 0], 'Specified cavity wall between the bearing pocket and outer body; casting ribs are not the measurement location.', [box([1.4, 1.9, -.02], [.6, .3, .08])], true);
    case 'flatness': return { ...sweep(family, [0, 2.715, 0], 1.4, 'y', 'Evaluate the defined machined sealing annulus with the approved flatness method, independently of datum orientation.'), regions: [{ kind: 'ring', center: [0, 2.715, 0], radius: 1.68, innerRadius: 1.12, axis: 'y' }] };
    case 'thread-depth': case 'drill-depth': case 'counterbore-depth': return depth(family, feature, { axis: 'y', entry: [1.8, .65, 1.8], fullForm: [1.8, .35, 1.8], floor: [1.8, .31, 1.8], seat: [1.8, .5, 1.8], radius: .24, counterRadius: .34, offset: [.75, 0, .75] });
    case 'hole-spacing': return linear(family, [[-1.8, .65, 1.8], [1.8, .65, 1.8]], [0, .45, .95], 'Distance between the fitted cover-hole axes in the specified mounting direction.', [ring([-1.8, .665, 1.8], .24, 'y'), ring([1.8, .665, 1.8], .24, 'y')]);
    default: return base(family, 'Illustrative housing feature location. Follow the pinned requirement and operation sketch.');
  }
}
function ringGuide(feature: Feature): MechanicalGuide3D {
  const family: MechanicalFamily = 'ring';
  switch (feature.animationKey) {
    case 'outside-diameter': return diameter(family, [0, .71, 0], 2.5, 'y', 'Finished ring outside diameter through its axis, clear of chamfers.');
    case 'bore-diameter': case 'bearing-bore': return { ...diameter(family, [0, .715, 0], 1.35, 'y', 'Ring bore diameter through the center, at the approved contact depths and orientations.'), regions: [ring([0, .715, 0], 1.35, 'y'), cylinder([0, .38, 0], 1.345, .62, 'y')] };
    case 'flange-thickness': return linear(family, [[-2.1, .05, 0], [-2.1, .7, 0]], [-.9, 0, 0], 'Ring thickness between its two finished parallel seating faces, sampled at approved positions.', [{ kind: 'ring', center: [0, .71, 0], radius: 2.45, innerRadius: 1.4, axis: 'y' }, { kind: 'ring', center: [0, .04, 0], radius: 2.45, innerRadius: 1.4, axis: 'y' }]);
    default: return base(family, 'Illustrative ring feature location. Follow the pinned requirement and operation sketch.');
  }
}

/**
 * Measurement anchors are in each procedural model's illustrative coordinate
 * system. The numeric acceptance requirement is never derived from model size:
 * the viewer labels this guide using the pinned feature's own values and units.
 */
export function mechanicalGuide3D(family: MechanicalFamily, feature: Feature): MechanicalGuide3D {
  switch (family) {
    case 'differential-case': return differential(feature);
    case 'bearing-cap': return bearingCap(feature);
    case 'flange': return flange(feature);
    case 'shaft': return shaft(feature);
    case 'threaded-block': return manifold(feature);
    case 'housing': return housing(feature);
    case 'ring': return ringGuide(feature);
  }
}
