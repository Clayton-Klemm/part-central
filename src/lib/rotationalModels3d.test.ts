import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRotationalModel } from './rotationalModels3d';
import type { MechanicalFamily, Point3 } from './mechanical3dTypes';

function intersections(family: MechanicalFamily, origin: Point3, direction: Point3) {
  const model = createRotationalModel(family)!;
  model.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  model.traverse(item => { if (item instanceof THREE.Mesh) meshes.push(item); });
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize()).intersectObjects(meshes, false);
}

describe('rotatable mechanical teaching models', () => {
  it.each(['differential-case', 'flange', 'shaft', 'ring'] as const)('%s creates finite geometry with bounded complexity and double-sided section materials', family => {
    const model = createRotationalModel(family)!;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    expect(bounds.isEmpty()).toBe(false);
    expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(10);
    let triangles = 0;
    model.traverse(item => {
      if (!(item instanceof THREE.Mesh)) return;
      const positions = item.geometry.getAttribute('position');
      triangles += (item.geometry.index?.count || positions.count) / 3;
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      expect(item.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect((item.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
      expect(item.name.length).toBeGreaterThan(0);
    });
    expect(triangles).toBeGreaterThan(500);
    expect(triangles).toBeLessThan(60_000);
  });

  it('has an actual spacer bore, rather than a dark disk on a solid cylinder', () => {
    expect(intersections('ring', [0, 4, 0], [0, -1, 0])).toHaveLength(0);
    const material = intersections('ring', [2, 4, 0], [0, -1, 0]);
    expect(material[0].point.y).toBeCloseTo(.7, 3);
  });

  it('makes the flange counterbore seat and blind drilled floor separate contact planes', () => {
    // Center clears the thread helix and reaches the drilled floor.
    const center = intersections('flange', [1.75, 4, 0], [0, -1, 0]);
    expect(center[0].point.y).toBeCloseTo(.06, 3);
    // Radius .23 is inside the counterbore but outside the threaded bore.
    const seat = intersections('flange', [1.98, 4, 0], [0, -1, 0]);
    expect(seat[0].point.y).toBeCloseTo(.58, 3);
    expect(intersections('flange', [0, 4, 1.75], [0, -1, 0])).toHaveLength(0);
  });

  it('cuts the shaft keyway below the journal and leaves a real axial blind bore', () => {
    const slot = intersections('shaft', [.2, 5, 0], [0, -1, 0]);
    expect(slot[0].point.y).toBeCloseTo(1.82, 3);
    const journal = intersections('shaft', [-1.55, 5, 0], [0, -1, 0]);
    expect(journal[0].point.y).toBeCloseTo(1.85, 3);
    const bore = intersections('shaft', [5, 1, 0], [-1, 0, 0]);
    expect(bore[0].point.x).toBeCloseTo(2.1, 3);
  });

  it('keeps the carrier bearing path and casting windows open', () => {
    expect(intersections('differential-case', [-5, 1.8, 0], [1, 0, 0])).toHaveLength(0);
    expect(intersections('differential-case', [.4, 5, 0], [0, -1, 0])).toHaveLength(0);
    const radial = Math.SQRT1_2;
    const ligament = intersections('differential-case', [.4, 1.8 + radial * 4, radial * 4], [0, -radial, -radial]);
    expect(ligament.length).toBeGreaterThan(0);
    expect(Math.hypot(ligament[0].point.y - 1.8, ligament[0].point.z)).toBeCloseTo(1.65, 2);
  });

  it('returns no rotational geometry for prismatic families', () => {
    expect(createRotationalModel('threaded-block')).toBeNull();
  });
});
