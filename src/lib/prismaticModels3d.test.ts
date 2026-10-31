import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPrismaticModel } from './prismaticModels3d';

function firstHit(group: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3) {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(origin, direction.normalize()).intersectObject(group, true).find(hit => hit.object instanceof THREE.Mesh);
}
function dispose(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    const drawable = object as THREE.Mesh;
    drawable.geometry?.dispose();
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
  });
  materials.forEach(material => material.dispose());
}

describe('prismatic model geometry', () => {
  it('leaves a genuine cap bore open and separates its crown and blind thread floor', () => {
    const cap = createPrismaticModel('bearing-cap')!;
    const openBore = firstHit(cap, new THREE.Vector3(0, 1.1, 4), new THREE.Vector3(0, 0, -1));
    expect(openBore).toBeUndefined();
    const crown = firstHit(cap, new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, -1, 0));
    expect(crown!.point.y).toBeCloseTo(2.3, 2);
    const drillFloor = firstHit(cap, new THREE.Vector3(1.9, 3, 0), new THREE.Vector3(0, -1, 0));
    expect(drillFloor!.point.y).toBeCloseTo(0.05, 3);
    expect(cap.userData.threadFullFormY).toBeGreaterThan(drillFloor!.point.y);
    dispose(cap);
  });

  it('cuts true blind top ports and a horizontal intersecting port into the manifold', () => {
    const manifold = createPrismaticModel('threaded-block')!;
    const body = manifold.getObjectByName('manifold-intersecting-port-body') as THREE.Mesh;
    expect(body.geometry.getAttribute('position').count).toBeGreaterThan(100);
    const floor = firstHit(manifold, new THREE.Vector3(-1.15, 4, 0), new THREE.Vector3(0, -1, 0));
    expect(floor!.point.y).toBeCloseTo(0.9, 1);
    const port = firstHit(manifold, new THREE.Vector3(4, 1.25, 0), new THREE.Vector3(-1, 0, 0));
    expect(port!.point.x).toBeLessThan(1.0);
    const untouchedTop = firstHit(manifold, new THREE.Vector3(0, 4, 1.0), new THREE.Vector3(0, -1, 0));
    expect(untouchedTop!.point.y).toBeCloseTo(2.85, 2);
    expect(manifold.userData.threadFullFormY).toBeGreaterThan(manifold.userData.drillFloorY);
    expect(manifold.userData.counterboreSeatY).toBeGreaterThan(manifold.userData.threadFullFormY);
    dispose(manifold);
  });

  it('keeps the housing bearing pocket and cover-hole counterbore open to their own contact planes', () => {
    const model = createPrismaticModel('housing')!;
    const pocket = firstHit(model, new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
    expect(pocket!.point.y).toBeCloseTo(1.25, 3);
    const coverFloor = firstHit(model, new THREE.Vector3(1.8, 3, 1.8), new THREE.Vector3(0, -1, 0));
    expect(coverFloor!.point.y).toBeCloseTo(0.31, 3);
    const seat = firstHit(model.getObjectByName('housing-flange-threaded-holes')!, new THREE.Vector3(1.8 + 0.30, 3, 1.8), new THREE.Vector3(0, -1, 0));
    expect(seat!.point.y).toBeCloseTo(0.50, 3);
    expect(model.children.filter(object => object.name.startsWith('housing-radial-rib-'))).toHaveLength(4);
    dispose(model);
  });

  it('provides finite clipped-section-compatible meshes only for its three owned families', () => {
    for (const family of ['bearing-cap', 'threaded-block', 'housing'] as const) {
      const group = createPrismaticModel(family)!;
      const bounds = new THREE.Box3().setFromObject(group);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) expect(material.side).toBe(THREE.DoubleSide);
      });
      dispose(group);
    }
    expect(createPrismaticModel('shaft')).toBeNull();
  });
});
