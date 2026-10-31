import type { Feature } from '../types';

export type Point3 = readonly [number, number, number];
export type Axis3 = 'x' | 'y' | 'z';
export type MechanicalFamily = 'differential-case' | 'bearing-cap' | 'flange' | 'shaft' | 'threaded-block' | 'housing' | 'ring';
export interface GuideRegion {
  kind: 'ring' | 'cylinder' | 'box' | 'plane';
  center: Point3;
  axis?: Axis3;
  radius?: number;
  innerRadius?: number;
  length?: number;
  size?: Point3;
}
export interface MechanicalGuide3D {
  path: Point3[];
  extensions: Point3[][];
  regions: GuideRegion[];
  focus: Point3;
  label: Point3;
  camera: Point3;
  description: string;
  mode: 'linear' | 'diameter' | 'sweep' | 'angle' | 'thread';
  section: boolean;
  /** All models use a Z section; positive Z is the removable front half. */
  sectionZ: number;
  gauge?: { entry: Point3; fullForm: Point3; floor: Point3; radius: number; axis: Axis3; seat?: Point3 };
}
export interface MechanicalViewerProps {
  feature: Feature & { animationKey: string };
  geometryFamily: string;
  playing: boolean;
  onTogglePlay: () => void;
  expanded?: boolean;
  features?: Feature[];
  onSelectFeature?: (feature: Feature) => void;
}
