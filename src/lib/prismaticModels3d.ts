import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import type { MechanicalFamily } from './mechanical3dTypes';

/** Illustrative local geometry. The inspection sheet remains the dimension authority. */
type Hole = { x: number; z: number; radius: number };

function metal(color = 0xa4b1ad, roughness = 0.35, metalness = 0.64) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
}

function partMesh(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, edges = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (edges) {
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 35), new THREE.LineBasicMaterial({ color: 0x506660, transparent: true, opacity: 0.24 }));
    line.name = `${name}:machined-edges`;
    mesh.add(line);
  }
  return mesh;
}

function roundedRectangle(cx: number, cz: number, width: number, depth: number, radius: number) {
  const x = cx - width / 2, z = cz - depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, z);
  shape.lineTo(x + width - r, z);
  shape.quadraticCurveTo(x + width, z, x + width, z + r);
  shape.lineTo(x + width, z + depth - r);
  shape.quadraticCurveTo(x + width, z + depth, x + width - r, z + depth);
  shape.lineTo(x + r, z + depth);
  shape.quadraticCurveTo(x, z + depth, x, z + depth - r);
  shape.lineTo(x, z + r);
  shape.quadraticCurveTo(x, z, x + r, z);
  shape.closePath();
  return shape;
}

/** Extrusion is along Y, with the 2D drawing interpreted as the X/Z plane. */
function horizontalPlate(shape: THREE.Shape, bottom: number, top: number, holes: Hole[] = []) {
  // Reflect the 2D contour before extrusion rather than reflecting the final
  // mesh: this keeps the solid's outward winding and normals intact.
  const planeShape = new THREE.Shape(shape.getPoints(48).map(point => new THREE.Vector2(point.x, -point.y)));
  for (const hole of holes) {
    const path = new THREE.Path();
    path.absarc(hole.x, -hole.z, hole.radius, 0, Math.PI * 2, true);
    planeShape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(planeShape, { depth: top - bottom, bevelEnabled: false, curveSegments: 48 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

function annularCylinder(outer: number, inner: number, bottom: number, top: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  return horizontalPlate(shape, bottom, top, inner > 0 ? [{ x: 0, z: 0, radius: inner }] : []);
}

function flatRing(group: THREE.Group, name: string, x: number, y: number, z: number, inner: number, outer: number, material: THREE.Material) {
  const geometry = new THREE.RingGeometry(inner, outer, 64);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(x, y, z);
  return partMesh(group, name, geometry, material);
}

/** Short raised helices explain the bore's thread form; they are not a pitch gauge. */
function threadHelix(group: THREE.Group, name: string, x: number, z: number, bottom: number, top: number, radius: number, material: THREE.Material, axis: 'y' | 'x' = 'y') {
  const turns = Math.max(2.5, Math.min(9, (top - bottom) / 0.14));
  const points: THREE.Vector3[] = [];
  const steps = Math.ceil(turns * 24);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, angle = t * turns * Math.PI * 2;
    points.push(axis === 'y'
      ? new THREE.Vector3(x + radius * Math.cos(angle), bottom + t * (top - bottom), z + radius * Math.sin(angle))
      : new THREE.Vector3(bottom + t * (top - bottom), x + radius * Math.cos(angle), z + radius * Math.sin(angle)));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return partMesh(group, name, new THREE.TubeGeometry(curve, steps, 0.018, 4, false), material);
}

function bearingCap() {
  const group = new THREE.Group();
  group.name = 'bearing-cap';
  const cast = metal(0x9baaa4, 0.43, 0.57);
  const machined = metal(0xc2ccc7, 0.28, 0.74);
  const thread = metal(0x728a80, 0.45, 0.60);

  const arch = new THREE.Shape();
  arch.moveTo(-1.65, 0.65);
  arch.absarc(0, 0.65, 1.65, Math.PI, 0, true);
  arch.lineTo(1.15, 0.65);
  arch.absarc(0, 0.65, 1.15, 0, Math.PI, false);
  arch.closePath();
  const archGeometry = new THREE.ExtrudeGeometry(arch, { depth: 1.3, curveSegments: 64, bevelEnabled: false });
  archGeometry.translate(0, 0, -0.65);
  partMesh(group, 'cap-hollow-arch', archGeometry, cast, true);

  for (const x of [-1.9, 1.9]) {
    const side = x < 0 ? 'left' : 'right';
    partMesh(group, `cap-${side}-blind-floor`, horizontalPlate(roundedRectangle(x, 0, 1.0, 1.8, 0.12), 0, 0.05), machined, true);
    partMesh(group, `cap-${side}-threaded-foot`, horizontalPlate(roundedRectangle(x, 0, 1.0, 1.8, 0.12), 0.05, 0.65, [{ x, z: 0, radius: 0.24 }]), machined, true);
    flatRing(group, `cap-${side}-thread-entry`, x, 0.653, 0, 0.241, 0.30, machined);
    threadHelix(group, `cap-${side}-full-form-thread`, x, 0, 0.20, 0.61, 0.235, thread);
  }
  for (const z of [-0.65, -0.48, 0.48, 0.65]) {
    const geometry = new THREE.TorusGeometry(1.153, 0.006, 4, 72, Math.PI);
    geometry.translate(0, 0.65, z);
    partMesh(group, `cap-bore-tool-line-${z}`, geometry, thread);
  }
  // The bore is an open upper semicircle; its lower half belongs to the mating part.
  group.userData = { illustrative: true, boreAxis: 'z', boreCenter: [0, 0.65, 0], boreRadius: 1.15, crownInnerY: 1.8, crownOuterY: 2.3, threadEntryY: 0.65, threadFullFormY: 0.20, drillFloorY: 0.05 };
  return group;
}

function cylinderSdf(radial: number, axial: number, radius: number, halfLength: number) {
  const r = radial - radius, a = Math.abs(axial) - halfLength;
  return Math.min(Math.max(r, a), 0) + Math.hypot(Math.max(r, 0), Math.max(a, 0));
}

/** A compact one-time SDF extraction cuts intersecting horizontal and vertical ports. */
function manifoldBodyGeometry() {
  const material = metal();
  const surface = new MarchingCubes(64, material, false, false, 60_000);
  surface.isolation = 0;
  const sx = 2.75, sy = 1.7, sz = 1.95, cy = 1.45;
  const n = surface.size;
  const mounts = [-1.8, 1.8].flatMap(x => [-1.1, 1.1].map(z => ({ x, z })));
  for (let iz = 0; iz < n; iz++) for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const x = (ix / n * 2 - 1) * sx;
    const y = (iy / n * 2 - 1) * sy + cy;
    const z = (iz / n * 2 - 1) * sz;
    const qx = Math.abs(x) - 2.455, qy = Math.abs(y - 1.45) - 1.355, qz = Math.abs(z) - 1.655;
    let solid = Math.min(Math.max(qx, qy, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) - 0.045;
    for (const px of [-1.15, 1.15]) {
      const radial = Math.hypot(x - px, z);
      solid = Math.max(solid, -cylinderSdf(radial, y - 1.95, 0.45, 1.05)); // Floor .90, open beyond top.
      solid = Math.max(solid, -cylinderSdf(radial, y - 2.815, 0.62, 0.335)); // Counterbore seat 2.48.
    }
    const crossRadial = Math.hypot(y - 1.25, z);
    solid = Math.max(solid, -cylinderSdf(crossRadial, x - 1.75, 0.40, 1.0));
    solid = Math.max(solid, -cylinderSdf(crossRadial, x - 2.50, 0.50, 0.16));
    for (const hole of mounts) solid = Math.max(solid, -cylinderSdf(Math.hypot(x - hole.x, z - hole.z), y - 1.45, 0.20, 1.6));
    surface.field[ix + iy * n + iz * n * n] = -solid;
  }
  surface.update();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(surface.positionArray.slice(0, surface.count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(surface.normalArray.slice(0, surface.count * 3), 3));
  geometry.scale(sx, sy, sz);
  geometry.translate(0, cy, 0);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  surface.geometry.dispose();
  material.dispose();
  return geometry;
}

function threadedBlock() {
  const group = new THREE.Group();
  group.name = 'threaded-block';
  const body = metal(0xa2b1ad, 0.35, 0.67);
  const machined = metal(0xc3cfca, 0.25, 0.74);
  const thread = metal(0x6d887e, 0.42, 0.64);
  partMesh(group, 'manifold-intersecting-port-body', manifoldBodyGeometry(), body);
  for (const x of [-1.15, 1.15]) {
    flatRing(group, `manifold-port-${x}-entry`, x, 2.853, 0, 0.622, 0.75, machined);
    flatRing(group, `manifold-port-${x}-counterbore-seat`, x, 2.482, 0, 0.452, 0.62, machined);
    threadHelix(group, `manifold-port-${x}-full-form-thread`, x, 0, 1.40, 2.43, 0.442, thread);
  }
  for (const x of [-1.8, 1.8]) for (const z of [-1.1, 1.1]) flatRing(group, `manifold-mount-${x}-${z}`, x, 2.853, z, 0.203, 0.28, machined);
  // A true horizontal bore intersects the right vertical port, rather than a painted circle.
  const sideEntry = new THREE.RingGeometry(0.50, 0.63, 64);
  sideEntry.rotateY(Math.PI / 2);
  sideEntry.translate(2.503, 1.25, 0);
  partMesh(group, 'manifold-cross-port-machined-entry', sideEntry, machined);
  threadHelix(group, 'manifold-cross-port-thread', 1.25, 0, 1.73, 2.31, 0.393, thread, 'x');
  group.userData = { illustrative: true, topPortCenters: [[-1.15, 2.85, 0], [1.15, 2.85, 0]], threadEntryY: 2.85, threadFullFormY: 1.40, drillFloorY: 0.90, counterboreSeatY: 2.48, crossPortAxis: 'x', crossPortCenter: [2.5, 1.25, 0] };
  return group;
}

function housing() {
  const group = new THREE.Group();
  group.name = 'housing';
  const cast = metal(0x91a39b, 0.47, 0.55);
  const machined = metal(0xc0cdc6, 0.28, 0.72);
  const thread = metal(0x6d877b, 0.44, 0.62);
  const corners = [-1.8, 1.8].flatMap(x => [-1.8, 1.8].map(z => ({ x, z })));
  partMesh(group, 'housing-flange-drilled-floors', horizontalPlate(roundedRectangle(0, 0, 4.8, 4.8, 0.45), 0.30, 0.31), machined, true);
  partMesh(group, 'housing-flange-threaded-holes', horizontalPlate(roundedRectangle(0, 0, 4.8, 4.8, 0.45), 0.31, 0.50, corners.map(p => ({ ...p, radius: 0.24 }))), machined, true);
  partMesh(group, 'housing-flange-counterbores', horizontalPlate(roundedRectangle(0, 0, 4.8, 4.8, 0.45), 0.50, 0.65, corners.map(p => ({ ...p, radius: 0.38 }))), machined, true);
  partMesh(group, 'housing-locating-spigot', annularCylinder(1.25, 0, 0.05, 0.50), machined, true);
  partMesh(group, 'housing-bearing-pocket-floor', annularCylinder(1.70, 0, 0.50, 1.25), cast, true);
  partMesh(group, 'housing-hollow-bearing-pocket', annularCylinder(1.70, 1.10, 1.25, 2.70), cast, true);
  flatRing(group, 'housing-machined-sealing-face', 0, 2.703, 0, 1.10, 1.70, machined);
  for (const radius of [1.14, 1.20, 1.58, 1.64]) flatRing(group, `housing-seal-tool-line-${radius}`, 0, 2.705, 0, radius, radius + 0.005, thread);
  for (const corner of corners) {
    threadHelix(group, `housing-cover-thread-${corner.x}-${corner.z}`, corner.x, corner.z, 0.35, 0.485, 0.235, thread);
    flatRing(group, `housing-cover-counterbore-seat-${corner.x}-${corner.z}`, corner.x, 0.502, corner.z, 0.24, 0.38, machined);
  }
  for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4]) {
    const rib = new THREE.Shape();
    rib.moveTo(1.35, 0.65); rib.lineTo(2.10, 0.65); rib.lineTo(1.50, 1.80); rib.closePath();
    const geometry = new THREE.ExtrudeGeometry(rib, { depth: 0.22, bevelEnabled: false });
    geometry.translate(0, 0, -0.11); geometry.rotateY(angle);
    partMesh(group, `housing-radial-rib-${angle}`, geometry, cast, true);
  }
  group.userData = { illustrative: true, bearingPocketRadius: 1.10, bearingPocketFloorY: 1.25, sealingFaceY: 2.70, locatingSpigotRadius: 1.25, coverThreadCenter: [1.8, 0.65, 1.8], threadFullFormY: 0.35, drillFloorY: 0.31, counterboreSeatY: 0.50 };
  return group;
}

export function createPrismaticModel(family: MechanicalFamily): THREE.Group | null {
  if (family === 'bearing-cap') return bearingCap();
  if (family === 'threaded-block') return threadedBlock();
  if (family === 'housing') return housing();
  return null;
}
