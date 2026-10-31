import * as THREE from 'three';
import type { Axis3, MechanicalFamily, Point3 } from './mechanical3dTypes';

// These are synthetic, not-to-scale teaching models. The inspection requirement
// supplies the dimension label; mesh proportions never establish acceptance.
type Materials = ReturnType<typeof materials>;
const TAU = Math.PI * 2;
const SEGMENTS = 64;

function materials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0x9aaba6, metalness: .72, roughness: .34, side: THREE.DoubleSide }),
    machined: new THREE.MeshStandardMaterial({ color: 0xbcc8c2, metalness: .78, roughness: .25, side: THREE.DoubleSide }),
    cast: new THREE.MeshStandardMaterial({ color: 0x81978d, metalness: .46, roughness: .63, side: THREE.DoubleSide }),
    interior: new THREE.MeshStandardMaterial({ color: 0x70887b, metalness: .61, roughness: .42, side: THREE.DoubleSide }),
    threads: new THREE.MeshStandardMaterial({ color: 0x8fa79b, metalness: .75, roughness: .3, side: THREE.DoubleSide }),
    edges: new THREE.LineBasicMaterial({ color: 0x415b4e, transparent: true, opacity: .25 }),
    turning: new THREE.LineBasicMaterial({ color: 0x5b7568, transparent: true, opacity: .31 }),
  };
}

function mesh(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: Point3 = [0, 0, 0], edges?: THREE.LineBasicMaterial) {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(...position);
  item.castShadow = true;
  item.receiveShadow = true;
  group.add(item);
  if (edges) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), edges);
    outline.name = `${name}-edges`;
    item.add(outline);
  }
  return item;
}

function orient(geometry: THREE.BufferGeometry, axis: Axis3) {
  // Lathe/cylinder geometries begin on Y. Axis rotations preserve true bores.
  if (axis === 'x') geometry.rotateZ(-Math.PI / 2);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  return geometry;
}

function tubeGeometry(axis: Axis3, start: number, end: number, outside: number, inside: number, bevel = .025) {
  const chamfer = Math.min(bevel, (outside - inside) / 3, (end - start) / 4);
  const profile = [
    new THREE.Vector2(inside + chamfer, start),
    new THREE.Vector2(outside - chamfer, start),
    new THREE.Vector2(outside, start + chamfer),
    new THREE.Vector2(outside, end - chamfer),
    new THREE.Vector2(outside - chamfer, end),
    new THREE.Vector2(inside + chamfer, end),
    new THREE.Vector2(inside, end - chamfer),
    new THREE.Vector2(inside, start + chamfer),
    new THREE.Vector2(inside + chamfer, start),
  ];
  return orient(new THREE.LatheGeometry(profile, SEGMENTS), axis);
}

function cylinderGeometry(axis: Axis3, start: number, end: number, radius: number) {
  const geometry = orient(new THREE.CylinderGeometry(radius, radius, end - start, SEGMENTS), axis);
  if (axis === 'x') geometry.translate((start + end) / 2, 0, 0);
  else if (axis === 'z') geometry.translate(0, 0, (start + end) / 2);
  else geometry.translate(0, (start + end) / 2, 0);
  return geometry;
}

function circularPlate(outside: number, holes: { u: number; v: number; radius: number }[]) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outside, 0, TAU, false);
  for (const hole of holes) {
    const path = new THREE.Path();
    path.absarc(hole.u, hole.v, hole.radius, 0, TAU, true);
    shape.holes.push(path);
  }
  return shape;
}

function plateGeometry(shape: THREE.Shape, axis: Axis3, start: number, end: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: end - start, bevelEnabled: false, curveSegments: 48, steps: 1 });
  // A shape is on XY and extrudes on Z. U/V are chosen per family's plane.
  if (axis === 'x') { geometry.rotateY(Math.PI / 2); geometry.translate(start, 0, 0); }
  else if (axis === 'y') { geometry.rotateX(-Math.PI / 2); geometry.translate(0, start, 0); }
  else geometry.translate(0, 0, start);
  return geometry;
}

function turningRing(group: THREE.Group, name: string, axis: Axis3, station: number, radius: number, center: Point3, material: THREE.LineBasicMaterial) {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i / SEGMENTS * TAU, u = Math.cos(a) * radius, v = Math.sin(a) * radius;
    points.push(axis === 'x' ? new THREE.Vector3(station, center[1] + u, center[2] + v) : axis === 'y' ? new THREE.Vector3(center[0] + u, station, center[2] + v) : new THREE.Vector3(center[0] + u, center[1] + v, station));
  }
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
  line.name = name;
  group.add(line);
}

function thread(group: THREE.Group, name: string, axis: Axis3, center: Point3, start: number, end: number, radius: number, pitch: number, material: THREE.Material) {
  const turns = (end - start) / pitch;
  const count = Math.max(64, Math.ceil(turns * 22));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= count; i++) {
    const progress = i / count, a = progress * turns * TAU;
    const along = start + progress * (end - start), u = Math.cos(a) * radius, v = Math.sin(a) * radius;
    points.push(axis === 'x' ? new THREE.Vector3(along, center[1] + u, center[2] + v) : axis === 'y' ? new THREE.Vector3(center[0] + u, along, center[2] + v) : new THREE.Vector3(center[0] + u, center[1] + v, along));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const item = mesh(group, name, new THREE.TubeGeometry(curve, count, .009, 5, false), material);
  item.userData.illustrativeThread = true;
}

function differential(m: Materials) {
  const group = new THREE.Group();
  const center: Point3 = [0, 1.8, 0];
  mesh(group, 'carrier-left-end-ring', tubeGeometry('x', -1.8, -1.35, 1.65, .65, .05), m.cast, center, m.edges);
  mesh(group, 'carrier-right-end-ring', tubeGeometry('x', 1.35, 1.8, 1.65, .65, .05), m.cast, center, m.edges);
  // Four separate cast ligaments leave genuinely open windows, rather than
  // drawing dark patches on a closed cylinder.
  for (let i = 0; i < 4; i++) {
    const middle = Math.PI / 4 + i * Math.PI / 2, half = .31;
    const profile = [new THREE.Vector2(1.22, -1.35), new THREE.Vector2(1.65, -1.35), new THREE.Vector2(1.65, 1.35), new THREE.Vector2(1.22, 1.35), new THREE.Vector2(1.22, -1.35)];
    const geometry = new THREE.LatheGeometry(profile, 22, middle - half, half * 2);
    geometry.rotateZ(-Math.PI / 2);
    mesh(group, `carrier-window-ligament-${i + 1}`, geometry, m.cast, center, m.edges);
    // Close the radial end faces of each window ligament.
    for (const angle of [middle - half, middle + half]) {
      const a = new THREE.Vector3(-1.35, -Math.sin(angle) * 1.22, Math.cos(angle) * 1.22);
      const b = new THREE.Vector3(1.35, a.y, a.z);
      const c = new THREE.Vector3(1.35, -Math.sin(angle) * 1.65, Math.cos(angle) * 1.65);
      const d = new THREE.Vector3(-1.35, c.y, c.z);
      const cap = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
      cap.computeVertexNormals();
      mesh(group, `carrier-window-wall-${i + 1}-${angle.toFixed(2)}`, cap, m.cast, center);
    }
  }
  mesh(group, 'left-bearing-journal', tubeGeometry('x', -2.45, -1.8, 1, .65, .035), m.machined, center, m.edges);
  mesh(group, 'right-bearing-collar', tubeGeometry('x', 1.65, 1.82, 1.2, .65), m.machined, center, m.edges);
  const holes = [{ u: 0, v: 0, radius: .65 }];
  for (let i = 0; i < 6; i++) {
    const angle = i / 6 * TAU;
    holes.push({ u: -Math.sin(angle) * 1.7, v: Math.cos(angle) * 1.7, radius: .16 });
  }
  mesh(group, 'six-hole-ring-gear-flange', plateGeometry(circularPlate(2.1, holes), 'x', 1.8, 2.2), m.machined, center, m.edges);
  mesh(group, 'ring-gear-locating-pilot', tubeGeometry('x', 2.2, 2.65, 1.25, .65, .035), m.machined, center, m.edges);
  const threadCenter: Point3 = [0, 3.5, 0];
  mesh(group, 'mounting-thread-blind-boss', tubeGeometry('x', 1.05, 1.8, .29, .16, .015), m.cast, threadCenter, m.edges);
  mesh(group, 'mounting-thread-drill-floor', cylinderGeometry('x', 1.02, 1.05, .16), m.interior, threadCenter);
  thread(group, 'mounting-thread-helix', 'x', threadCenter, 1.35, 2.15, .154, .092, m.threads);
  for (const sign of [-1, 1]) {
    const start = sign < 0 ? -1.76 : 1.22, end = sign < 0 ? -1.22 : 1.76;
    mesh(group, `cross-pin-boss-${sign < 0 ? 'rear' : 'front'}`, tubeGeometry('z', start, end, .58, .35), m.machined, center, m.edges);
  }
  for (const radius of [.74, .8, .86, 1.03, 1.12]) turningRing(group, `pilot-face-turning-${radius}`, 'x', 2.651, radius, center, m.turning);
  for (const radius of [1.42, 1.48, 1.54, 1.91, 1.96]) turningRing(group, `flange-face-turning-${radius}`, 'x', 2.202, radius, center, m.turning);
  for (const x of [-2.38, -2.34, -2.3, -2.26]) turningRing(group, `journal-grind-${x}`, 'x', x, 1.002, center, m.turning);
  return group;
}

function flange(m: Materials) {
  const group = new THREE.Group();
  const lower = [{ u: 0, v: 0, radius: .72 }], upper = [{ u: 0, v: 0, radius: .72 }];
  // AF-5400's saved instruction specifies four mounting-hole axes.
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU, u = Math.cos(a) * 1.75, v = -Math.sin(a) * 1.75;
    lower.push({ u, v, radius: .18 });
    upper.push({ u, v, radius: .29 });
  }
  mesh(group, 'four-hole-flange-lower', plateGeometry(circularPlate(2.3, lower), 'y', .05, .55), m.steel, [0, 0, 0], m.edges);
  mesh(group, 'flange-counterbore-seats', plateGeometry(circularPlate(2.16, lower), 'y', .55, .58), m.machined, [0, 0, 0], m.edges);
  mesh(group, 'flange-counterbored-face', plateGeometry(circularPlate(2.16, upper), 'y', .58, .8), m.machined, [0, 0, 0], m.edges);
  mesh(group, 'flange-locating-pilot', tubeGeometry('y', .8, 1.35, 1.15, .72, .035), m.machined, [0, 0, 0], m.edges);
  mesh(group, 'selected-blind-thread-drill-floor', cylinderGeometry('y', .05, .06, .18), m.interior, [1.75, 0, 0]);
  thread(group, 'selected-bolt-thread-helix', 'y', [1.75, 0, 0], .25, .56, .174, .065, m.threads);
  for (const r of [.82, .86, .92, 1.03]) turningRing(group, `pilot-top-turning-${r}`, 'y', 1.351, r, [0, 0, 0], m.turning);
  for (const r of [1.29, 1.34, 1.4, 2.03, 2.08]) turningRing(group, `flange-face-turning-${r}`, 'y', .802, r, [0, 0, 0], m.turning);
  return group;
}

function keywayProfile() {
  const radius = 1.05, halfWidth = .16, floor = .82;
  const top = Math.sqrt(radius * radius - halfWidth * halfWidth);
  const start = Math.atan2(top, -halfWidth), end = Math.atan2(top, halfWidth) + TAU;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, top);
  shape.absarc(0, 0, radius, start, end, false);
  shape.lineTo(halfWidth, floor);
  shape.lineTo(-halfWidth, floor);
  shape.closePath();
  return shape;
}

function shaft(m: Materials) {
  const group = new THREE.Group();
  const center: Point3 = [0, 1, 0];
  for (const [start, end, radius, name] of [
    [-3.3, -2.3, .55, 'left-pilot'], [-2.3, -.8, .85, 'bearing-journal'],
    [-.8, -.35, 1.05, 'keyway-left-shoulder'], [.75, 1.3, 1.05, 'keyway-right-shoulder'],
    [1.3, 2.1, .72, 'right-shoulder'],
  ] as const) mesh(group, `shaft-${name}`, cylinderGeometry('x', start, end, radius), m.machined, center, m.edges);
  mesh(group, 'shaft-keyway-cut-journal', plateGeometry(keywayProfile(), 'x', -.35, .75), m.machined, center, m.edges);
  mesh(group, 'shaft-bored-right-shoulder', tubeGeometry('x', 2.1, 2.4, .72, .28, .018), m.machined, center, m.edges);
  mesh(group, 'shaft-threaded-end-pilot', tubeGeometry('x', 2.4, 3.3, .5, .28, .025), m.machined, center, m.edges);
  // The preceding solid shoulder closes the bore at X=2.1. The thread ends
  // at X=2.35, keeping the full-form plane distinct from the drilled floor.
  thread(group, 'shaft-axial-thread-helix', 'x', center, 2.35, 3.23, .274, .105, m.threads);
  for (const x of [-2.22, -2.15, -2.08, -2.01, -1.94, -1.87, -1.8, -1.73, -1.66, -1.59, -1.52, -1.45, -1.38, -1.31, -1.24, -1.17, -1.1, -1.03, -.96]) turningRing(group, `bearing-journal-grind-${x}`, 'x', x, .851, center, m.turning);
  for (const x of [-3.02, -2.95, 2.62, 2.69]) turningRing(group, `pilot-circlip-groove-${x}`, 'x', x, x < 0 ? .551 : .501, center, m.turning);
  for (const radius of [.34, .38, .42]) turningRing(group, `thread-end-face-turning-${radius}`, 'x', 3.301, radius, center, m.turning);
  return group;
}

function ring(m: Materials) {
  const group = new THREE.Group();
  mesh(group, 'spacer-ring-finished-body', tubeGeometry('y', .05, .7, 2.5, 1.35, .05), m.machined, [0, 0, 0], m.edges);
  for (const radius of [1.46, 1.5, 1.54, 2.15, 2.2, 2.25, 2.3]) turningRing(group, `ring-face-turning-${radius}`, 'y', .701, radius, [0, 0, 0], m.turning);
  return group;
}

/** Pure scene construction: no DOM, network, database, or animation loop. */
export function createRotationalModel(family: MechanicalFamily): THREE.Group | null {
  if (!['differential-case', 'flange', 'shaft', 'ring'].includes(family)) return null;
  const m = materials();
  const group = family === 'differential-case' ? differential(m) : family === 'flange' ? flange(m) : family === 'shaft' ? shaft(m) : ring(m);
  group.name = `synthetic-${family}`;
  group.userData = { family, synthetic: true, notToScale: true };
  return group;
}
