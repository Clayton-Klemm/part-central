import * as THREE from 'three';

export const GEAR = { deck: 5 / 12, top: 12.5 / 12, shoulder: 8 / 12, bore: 25 / 24, pitch: 76 / 24, root: 3.03, outer: 3.4, dogInner: 1.88, dogOuter: 2.52, dogAngle: Math.PI / 4 };

export function polar(radius: number, angle: number, height: number) {
  return new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
}

export function animationSample(progress: number, pointCount: number) {
  const portion = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 1)) : 0;
  return {
    portion,
    pointIndex: pointCount > 0 ? Math.max(0, Math.min(pointCount - 1, Math.floor(portion * (pointCount - 1)))) : -1,
    drawCount: Math.min(pointCount, Math.max(2, Math.floor(portion * pointCount))),
  };
}

export function makeGearGeometry() {
  const outline = new THREE.Shape();
  const teeth = 44;
  const profile = [[0, GEAR.root], [0.17, GEAR.root], [0.31, GEAR.outer], [0.67, GEAR.outer], [0.81, GEAR.root], [1, GEAR.root]];
  for (let tooth = 0; tooth < teeth; tooth++) {
    for (const [offset, radius] of profile) {
      const angle = ((tooth + offset) / teeth) * Math.PI * 2;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (tooth === 0 && offset === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    }
  }
  outline.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, GEAR.bore, 0, Math.PI * 2, true);
  outline.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: GEAR.deck - 0.05, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 80 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.025, 0);
  return geometry;
}

export function dogHeight(t: number) {
  return GEAR.shoulder + Math.min(t / 0.62, 1) * (GEAR.top - GEAR.shoulder);
}

export function makeDogGeometry(angle: number, patch: 'body' | 'ramp' | 'top' = 'body') {
  const positions: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  const samples = 20;
  const start = patch === 'top' ? 0.62 : 0;
  const end = patch === 'ramp' ? 0.62 : 1;
  for (let step = 0; step < samples; step++) {
    const t1 = start + (end - start) * step / samples;
    const t2 = start + (end - start) * (step + 1) / samples;
    const a1 = angle - 0.3 + t1 * 0.6, a2 = angle - 0.3 + t2 * 0.6;
    const h1 = dogHeight(t1) + (patch === 'body' ? 0 : 0.005), h2 = dogHeight(t2) + (patch === 'body' ? 0 : 0.005);
    const i1 = polar(GEAR.dogInner, a1, h1), o1 = polar(GEAR.dogOuter, a1, h1);
    const i2 = polar(GEAR.dogInner, a2, h2), o2 = polar(GEAR.dogOuter, a2, h2);
    push(i1, o2, o1); push(i1, i2, o2);
    if (patch !== 'body') continue;
    const ib1 = polar(GEAR.dogInner, a1, GEAR.deck), ob1 = polar(GEAR.dogOuter, a1, GEAR.deck);
    const ib2 = polar(GEAR.dogInner, a2, GEAR.deck), ob2 = polar(GEAR.dogOuter, a2, GEAR.deck);
    push(i1, ib1, i2); push(i2, ib1, ib2);
    push(o1, o2, ob1); push(o2, ob2, ob1);
    push(ib1, ob1, ob2); push(ib1, ob2, ib2);
    if (step === 0) { push(i1, o1, ob1); push(i1, ob1, ib1); }
    if (step === samples - 1) { push(i2, ob2, o2); push(i2, ib2, ob2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function ringGeometry(inner: number, outer: number, height: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(shape, 120);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height, 0);
  return geometry;
}

export type Guide = { points: THREE.Vector3[]; extensions: THREE.Vector3[][]; label: THREE.Vector3; highlight: 'top' | 'ramp' | 'bore' | 'face' | 'pitch' | 'body'; description: string };

function segment(a: THREE.Vector3, b: THREE.Vector3, count = 80) {
  return Array.from({ length: count + 1 }, (_, i) => a.clone().lerp(b, i / count));
}

export function featureGuide(key: string): Guide {
  const angle = GEAR.dogAngle;
  if (key === 'bore-diameter') {
    const a = polar(GEAR.bore, angle, GEAR.deck + 0.04), b = polar(GEAR.bore, angle + Math.PI, GEAR.deck + 0.04);
    return { points: segment(a, b), extensions: [], label: new THREE.Vector3(0, GEAR.deck + 0.55, 0), highlight: 'bore', description: 'Across the bore, through its center' };
  }
  if (key === 'pitch-diameter') {
    const points = Array.from({ length: 161 }, (_, i) => polar(GEAR.pitch, i / 160 * Math.PI * 2, GEAR.deck + 0.08));
    return { points, extensions: [[polar(GEAR.pitch, angle, GEAR.deck + 0.08), polar(GEAR.pitch, angle + Math.PI, GEAR.deck + 0.08)]], label: polar(3.6, angle - 0.25, 0.7), highlight: 'pitch', description: 'Pitch circle through all gear teeth' };
  }
  if (key === 'face-runout') {
    const points = Array.from({ length: 161 }, (_, i) => polar(2.78, i / 160 * Math.PI * 2, GEAR.deck + 0.055));
    return { points, extensions: [[polar(2.78, angle, GEAR.deck + 0.05), polar(2.78, angle, 1.42)]], label: polar(3.25, angle, 1.5), highlight: 'face', description: 'Sweep the indicated face through one revolution' };
  }
  if (key === 'dog-width') {
    const a = polar(2.2, angle + 0.072, GEAR.top + 0.15), b = polar(2.2, angle + 0.3, GEAR.top + 0.15);
    return { points: segment(a, b), extensions: [[a.clone().setY(GEAR.top), a], [b.clone().setY(GEAR.top), b]], label: a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.45, 0)), highlight: 'top', description: 'Tangential width across the flat top land' };
  }
  if (key === 'ramp-angle') {
    const start = polar(2.2, angle - 0.3, GEAR.shoulder + 0.025);
    const end = polar(2.2, angle - 0.3 + 0.6 * 0.62, GEAR.top + 0.025);
    const flatEnd = end.clone().setY(start.y);
    const direction = flatEnd.clone().sub(start).normalize();
    const slope = Math.atan2(end.y - start.y, flatEnd.distanceTo(start));
    const points = Array.from({ length: 81 }, (_, i) => start.clone().addScaledVector(direction, Math.cos(slope * i / 80) * 0.63).add(new THREE.Vector3(0, Math.sin(slope * i / 80) * 0.63, 0)));
    return { points, extensions: [[start, flatEnd], [start, end]], label: start.clone().addScaledVector(direction, 0.7).add(new THREE.Vector3(0, 0.55, 0)), highlight: 'ramp', description: 'Lead-in ramp angle, parallel to datum A' };
  }
  const ramp = key === 'ramp-height';
  const overall = key === 'overall-thickness';
  const featureAngle = ramp ? angle - 0.3 : angle + 0.22;
  const bottom = 0;
  const top = ramp ? GEAR.shoulder : overall ? GEAR.deck : GEAR.top;
  const pointA = polar(GEAR.dogOuter, featureAngle, bottom);
  const pointB = polar(GEAR.dogOuter, featureAngle, top);
  const a = polar(3.72, featureAngle, bottom), b = polar(3.72, featureAngle, top);
  return { points: segment(a, b), extensions: [[pointA, a], [pointB, b]], label: a.clone().lerp(b, 0.5).add(polar(0.32, featureAngle, 0)), highlight: ramp ? 'ramp' : overall ? 'body' : 'top', description: ramp ? 'Bottom datum A to the lower ramp shoulder' : overall ? 'Bottom datum A to the annular top face' : 'Bottom datum A to the top land of the dog' };
}
