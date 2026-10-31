import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Crosshair, Eye, Layers3, MapPin, Pause, Play, RotateCcw, Scan, View } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Feature } from '../types';
import type { Axis3, GuideRegion, MechanicalGuide3D, MechanicalViewerProps, Point3 } from '../lib/mechanical3dTypes';
import { createRotationalModel } from '../lib/rotationalModels3d';
import { createPrismaticModel } from '../lib/prismaticModels3d';
import { isMechanicalFamily, mechanicalGuide3D } from '../lib/mechanical3dGuides';
import { MECHANICAL_ANIMATIONS } from '../lib/mechanical';
import { fitSphereDistance, guideProgress, placeCallouts, resampleGuidePath } from '../lib/mechanicalViewerMath';
import MechanicalFeatureViewer from './MechanicalFeatureViewer';
import './Mechanical3DViewer.css';

const NAMES: Record<string, string> = { 'differential-case': 'DIFFERENTIAL CARRIER', 'bearing-cap': 'BEARING CAP', flange: 'AXLE FLANGE', shaft: 'STEPPED SHAFT', 'threaded-block': 'THREADED MANIFOLD', housing: 'BEARING HOUSING', ring: 'SPACER RING' };
const SUPPORTED = new Set<string>(MECHANICAL_ANIMATIONS);
const vec = (point: Point3) => new THREE.Vector3(...point);

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
function orient(object: THREE.Object3D, axis: Axis3 = 'y', normal = false) {
  if (normal) {
    if (axis === 'y') object.rotation.x = -Math.PI / 2;
    if (axis === 'x') object.rotation.y = Math.PI / 2;
  } else {
    if (axis === 'x') object.rotation.z = -Math.PI / 2;
    if (axis === 'z') object.rotation.x = Math.PI / 2;
  }
}
function regionMesh(region: GuideRegion, material: THREE.Material) {
  let geometry: THREE.BufferGeometry;
  if (region.kind === 'ring') geometry = new THREE.RingGeometry(region.innerRadius ?? Math.max(0, (region.radius || 1) - .08), region.radius || 1, 64);
  else if (region.kind === 'cylinder') geometry = new THREE.CylinderGeometry(region.radius || 1, region.radius || 1, region.length || .1, 64, 1, true);
  else if (region.kind === 'plane') geometry = new THREE.PlaneGeometry(region.size?.[0] || 1, region.size?.[1] || 1);
  else geometry = new THREE.BoxGeometry(...(region.size || [1, .05, 1]));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(vec(region.center));
  if (region.kind !== 'box') orient(mesh, region.axis, region.kind !== 'cylinder');
  mesh.renderOrder = 4;
  return mesh;
}

export default function Mechanical3DViewer({ feature, geometryFamily, playing, onTogglePlay, expanded = false, features, onSelectFeature }: MechanicalViewerProps) {
  const family = isMechanicalFamily(geometryFamily) ? geometryFamily : 'ring';
  const guide = useMemo(() => mechanicalGuide3D(family, feature), [family, feature]);
  const [section, setSection] = useState(guide.section);
  const [callouts, setCallouts] = useState(true);
  const [diagram, setDiagram] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const markerElements = useRef(new Map<string, HTMLButtonElement>());
  const leaderElements = useRef(new Map<string, SVGLineElement>());
  const wake = useRef<() => void>(() => {});
  const commands = useRef({ fit: () => {}, focus: () => {}, top: () => {}, replay: () => {} });
  const candidates = useMemo(() => (features || [feature]).filter(f => !!f.animationKey && SUPPORTED.has(f.animationKey)), [features, feature]);
  const markers = useMemo(() => {
    const selected = candidates.slice(0, 12);
    if (!selected.some(f => f.id === feature.id)) selected.splice(11, 1, feature);
    return selected;
  }, [candidates, feature]);
  const markerAnchors = useMemo(() => markers.map(f => mechanicalGuide3D(family, f).focus), [family, markers]);
  const live = useRef({ feature, guide, playing, section, callouts, markers, markerAnchors, reducedMotion });
  live.current = { feature, guide, playing, section, callouts, markers, markerAnchors, reducedMotion };

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(preference.matches);
    const changed = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);
  useEffect(() => { setSection(guide.section); }, [feature.id, family, guide.section]);
  useEffect(() => { wake.current(); }, [feature.id, guide, playing, section, callouts, reducedMotion]);

  useEffect(() => {
    const element = host.current;
    if (!element || diagram || unavailable) return;
    const model = createRotationalModel(family) || createPrismaticModel(family);
    if (!model) { setUnavailable(true); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { disposeTree(model); setUnavailable(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.27;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0xf1f5ed, 0);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('tabindex', '0');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.add(model);
    const camera = new THREE.PerspectiveCamera(36, 1, .05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .09; controls.enablePan = false;
    controls.minPolarAngle = .02; controls.maxPolarAngle = Math.PI - .05;
    const bounds = new THREE.Box3().setFromObject(model);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    controls.minDistance = Math.max(1.5, sphere.radius * .6);
    controls.maxDistance = sphere.radius * 8;
    let interacted = false;
    let fitted = false;
    const fit = (top = false) => {
      const distance = fitSphereDistance(sphere.radius + .15, camera.aspect);
      const direction = top ? new THREE.Vector3(0, 1, .001) : new THREE.Vector3(1.3, 1.05, 1.5).normalize();
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.target.copy(center); controls.update(); fitted = true;
    };
    scene.add(new THREE.HemisphereLight(0xf4fafb, 0x899481, 3.15));
    const keyLight = new THREE.DirectionalLight(0xfff5dc, 4.5); keyLight.position.set(-4, 9, 7); scene.add(keyLight);
    const fill = new THREE.DirectionalLight(0xd3e2ee, 2.6); fill.position.set(7, 4, -5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(-6, 3, -5); scene.add(rim);
    const grid = new THREE.GridHelper(13, 26, 0xc3d1bd, 0xd9e3d3); grid.position.y = bounds.min.y - .055;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = .32; scene.add(grid);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(sphere.radius * .88, 64), new THREE.MeshBasicMaterial({ color: 0x4a624c, transparent: true, opacity: .07, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(center.x, bounds.min.y - .04, center.z); shadow.scale.y = .7; scene.add(shadow);
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const bodyMaterials = new Set<THREE.Material>();
    model.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) bodyMaterials.add(material);
    });
    let overlay = new THREE.Group(); scene.add(overlay);
    let line: THREE.Line | null = null;
    let tracer: THREE.Mesh | null = null;
    let tool: THREE.Group | null = null;
    let activeGuide: MechanicalGuide3D = live.current.guide;
    let path: THREE.Vector3[] = [];
    let currentFeature = '';
    let elapsed = 0;
    let lastSection: boolean | undefined;
    let frame = 0;
    let previous: number | null = null;
    let inView = true;
    let disposed = false;
    let rendering = false;
    let dirty = true;
    const requestFrame = () => { dirty = true; if (!disposed && !frame && !rendering && inView && !document.hidden) frame = requestAnimationFrame(animate); };
    const addLine = (points: readonly Point3[], dashed = false, color = 0x087e73) => {
      const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: .10, gapSize: .055, depthTest: false, transparent: true, opacity: .65 }) : new THREE.LineBasicMaterial({ color, depthTest: false });
      const result = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(vec)), material);
      if (dashed) result.computeLineDistances();
      result.renderOrder = 12; overlay.add(result); return result;
    };
    const buildGuide = () => {
      scene.remove(overlay); disposeTree(overlay); overlay = new THREE.Group(); scene.add(overlay);
      activeGuide = live.current.guide;
      const sampled = resampleGuidePath(activeGuide.path); path = sampled.map(vec);
      line = addLine(sampled);
      activeGuide.extensions.forEach(extension => addLine(extension, true));
      tracer = new THREE.Mesh(new THREE.SphereGeometry(.048, 12, 8), new THREE.MeshBasicMaterial({ color: 0x087e73, depthTest: false })); tracer.renderOrder = 15; overlay.add(tracer);
      const patch = new THREE.MeshStandardMaterial({ color: 0x099d83, emissive: 0x086f58, emissiveIntensity: .36, transparent: true, opacity: .55, depthWrite: false, roughness: .45, metalness: .2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const region of activeGuide.regions) overlay.add(regionMesh(region, patch));
      if (path.length > 1 && !['sweep', 'angle'].includes(activeGuide.mode)) {
        for (const [point, other] of [[path[0], path[path.length - 1]], [path[path.length - 1], path[0]]]) {
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(.057, .16, 12), new THREE.MeshBasicMaterial({ color: 0x087e73, depthTest: false }));
          arrow.position.copy(point); arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), point.clone().sub(other).normalize()); arrow.renderOrder = 14; overlay.add(arrow);
        }
      }
      const gauge = activeGuide.gauge;
      tool = null;
      if (gauge) {
        tool = new THREE.Group(); tool.name = 'illustrative-measuring-tool';
        const direction = vec(gauge.entry).sub(vec(gauge.fullForm)).normalize();
        tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        const thread = live.current.feature.animationKey === 'thread-depth';
        const radius = Math.min(gauge.radius * .48, .16);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(thread ? radius : .038, thread ? radius : .038, 1.05, 20), new THREE.MeshStandardMaterial({ color: 0x70b59d, metalness: .6, roughness: .3 })); shaft.position.y = .525; tool.add(shaft);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .23, 24), new THREE.MeshStandardMaterial({ color: 0x285f4c, metalness: .35, roughness: .5 })); handle.position.y = 1.16; tool.add(handle);
        if (thread) {
          const lead = Math.min(.16, vec(gauge.floor).distanceTo(vec(gauge.fullForm)) * .25);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(radius, lead, 20), new THREE.MeshStandardMaterial({ color: 0xb8c9af, metalness: .4, roughness: .4 })); tip.rotation.x = Math.PI; tip.position.y = -lead / 2; tool.add(tip);
          const helix = Array.from({ length: 161 }, (_, i) => new THREE.Vector3(Math.cos(i / 160 * Math.PI * 16) * (radius + .005), i / 160 * .85 + .04, Math.sin(i / 160 * Math.PI * 16) * (radius + .005)));
          tool.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(helix), new THREE.LineBasicMaterial({ color: 0x285f4c })));
          const full = new THREE.Mesh(new THREE.RingGeometry(gauge.radius * .8, gauge.radius * 1.35, 48), new THREE.MeshBasicMaterial({ color: 0x087e73, side: THREE.DoubleSide, transparent: true, opacity: .8, depthTest: false }));
          full.position.copy(vec(gauge.fullForm)); orient(full, gauge.axis, true); full.renderOrder = 14; overlay.add(full);
        }
        const floor = new THREE.Mesh(new THREE.RingGeometry(gauge.radius * .6, gauge.radius, 48), new THREE.MeshBasicMaterial({ color: 0xb7975d, side: THREE.DoubleSide, transparent: true, opacity: .7 }));
        floor.position.copy(vec(gauge.floor)); orient(floor, gauge.axis, true); overlay.add(floor);
        overlay.add(tool);
      }
      elapsed = 0; currentFeature = live.current.feature.id;
      renderer.domElement.setAttribute('aria-label', `Interactive 3D ${NAMES[family].toLowerCase()} model. ${live.current.feature.label}. ${activeGuide.description}. Drag to rotate, scroll or pinch to zoom.`);
      renderer.domElement.dataset.modelFamily = family;
      renderer.domElement.dataset.guideFeature = currentFeature;
      dirty = true;
    };
    const projected = new THREE.Vector3();
    const project = (point: Point3) => {
      projected.set(...point).project(camera);
      return { x: (projected.x * .5 + .5) * element.clientWidth, y: (-projected.y * .5 + .5) * element.clientHeight, visible: projected.z >= -1 && projected.z <= 1 };
    };
    const positionCallouts = () => {
      const anchors = live.current.markerAnchors.map(project);
      const positions = placeCallouts(anchors, element.clientWidth, element.clientHeight);
      live.current.markers.forEach((f, index) => {
        const marker = markerElements.current.get(f.id); const leader = leaderElements.current.get(f.id); const anchor = anchors[index]; const placed = positions[index];
        const show = live.current.callouts && anchor.visible;
        if (marker) { marker.style.left = `${placed.x}px`; marker.style.top = `${placed.y}px`; marker.style.visibility = show ? 'visible' : 'hidden'; }
        if (leader) { leader.setAttribute('x1', String(anchor.x)); leader.setAttribute('y1', String(anchor.y)); leader.setAttribute('x2', String(placed.x)); leader.setAttribute('y2', String(placed.y)); leader.style.visibility = show ? 'visible' : 'hidden'; }
      });
    };
    function animate(time: number) {
      frame = 0;
      if (disposed || !inView || document.hidden) { previous = null; return; }
      rendering = true;
      const delta = previous === null ? 0 : Math.max(0, Math.min(.08, (time - previous) / 1000)); previous = time;
      if (currentFeature !== live.current.feature.id || activeGuide !== live.current.guide) buildGuide();
      if (lastSection !== live.current.section || clip.constant !== live.current.guide.sectionZ) {
        clip.constant = live.current.guide.sectionZ;
        bodyMaterials.forEach(material => { material.clippingPlanes = live.current.section ? [clip] : []; material.needsUpdate = true; });
        lastSection = live.current.section; dirty = true;
      }
      const moving = live.current.playing && !live.current.reducedMotion;
      if (moving) elapsed += delta;
      const progress = guideProgress(elapsed, live.current.reducedMotion);
      if (line) line.geometry.setDrawRange(0, Math.max(2, Math.ceil(progress.portion * path.length)));
      if (tracer && path.length) { tracer.position.copy(path[Math.min(path.length - 1, Math.floor(progress.portion * (path.length - 1)))]); tracer.visible = progress.portion < 1; }
      if (tool && activeGuide.gauge) {
        const gauge = activeGuide.gauge;
        const destination = live.current.feature.animationKey === 'drill-depth' ? gauge.floor : live.current.feature.animationKey === 'counterbore-depth' ? gauge.seat || gauge.fullForm : gauge.fullForm;
        const outward = vec(gauge.entry).sub(vec(destination)).normalize();
        const approach = vec(gauge.entry).addScaledVector(outward, .8);
        tool.position.copy(approach.lerp(vec(destination), progress.eased));
      }
      const damping = controls.update();
      if (dirty || moving || damping) { positionCallouts(); renderer.render(scene, camera); dirty = false; }
      rendering = false;
      if (moving || damping) frame = requestAnimationFrame(animate);
      else previous = null;
    }
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
      if (!fitted || !interacted) fit();
      requestFrame();
    };
    const changed = () => { dirty = true; requestFrame(); };
    const start = () => { interacted = true; };
    controls.addEventListener('change', changed); controls.addEventListener('start', start);
    const visibility = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; if (inView) requestFrame(); }); visibility.observe(element);
    const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(element);
    const pageVisibility = () => { if (!document.hidden) requestFrame(); };
    document.addEventListener('visibilitychange', pageVisibility);
    const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Home') { event.preventDefault(); fit(); requestFrame(); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); camera.position.sub(controls.target).multiplyScalar(.88).add(controls.target); requestFrame(); }
      if (event.key === '-') { event.preventDefault(); camera.position.sub(controls.target).multiplyScalar(1.12).add(controls.target); requestFrame(); }
    };
    renderer.domElement.addEventListener('keydown', keydown);
    commands.current = {
      fit: () => { fit(); requestFrame(); },
      top: () => { fit(true); requestFrame(); },
      focus: () => {
        const g = live.current.guide;
        const extent = Math.max(1.25, ...g.regions.map(region => region.radius || (region.size ? Math.max(...region.size) / 2 : .5)));
        const distance = fitSphereDistance(Math.min(sphere.radius + .1, extent), camera.aspect);
        controls.target.copy(vec(g.focus));
        camera.position.copy(controls.target).addScaledVector(vec(g.camera).sub(controls.target).normalize(), distance);
        controls.update(); requestFrame();
      },
      replay: () => { elapsed = 0; requestFrame(); },
    };
    wake.current = requestFrame;
    resize(); requestFrame();
    return () => {
      disposed = true; cancelAnimationFrame(frame); wake.current = () => {};
      visibility.disconnect(); sizeObserver.disconnect(); document.removeEventListener('visibilitychange', pageVisibility);
      controls.removeEventListener('change', changed); controls.removeEventListener('start', start); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.domElement.removeEventListener('keydown', keydown);
      disposeTree(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [family, diagram, unavailable]);

  const select = (f: Feature) => { onSelectFeature?.(f); };
  if (diagram || unavailable) return <div className="interactive-mechanical-fallback"><div className="model-view-tabs"><span>{unavailable ? '3D unavailable on this device' : 'Measurement diagram'}</span><button onClick={() => { setDiagram(false); setUnavailable(false); }}><Box size={13}/>Back to 3D</button></div><MechanicalFeatureViewer feature={feature} geometryFamily={family} playing={playing} onTogglePlay={onTogglePlay} expanded={expanded}/></div>;
  return <div className={`interactive-mechanical ${expanded ? 'interactive-mechanical-expanded' : ''}`}>
    <div className="model-view-tabs"><span><Box size={12}/>INTERACTIVE 3D</span><button onClick={() => setDiagram(true)}><View size={13}/>2D diagram</button></div>
    <div className="model-3d-stage" ref={host} data-testid="mechanical-3d-stage"><div className="model-family-title">{NAMES[family]}<span>ILLUSTRATIVE / NTS</span></div>
      <svg className="model-callout-leaders" aria-hidden="true">{markers.map(f => <line key={f.id} className={f.id === feature.id ? 'selected' : ''} ref={element => { if (element) leaderElements.current.set(f.id, element); else leaderElements.current.delete(f.id); }}/>)}</svg>
      {markers.map(f => <button key={f.id} className={`model-callout ${f.id === feature.id ? 'selected' : ''}`} aria-label={`Select 3D feature ${f.sketchRef}: ${f.label}`} aria-pressed={f.id === feature.id} title={f.label} onClick={() => select(f)} disabled={!onSelectFeature} ref={element => { if (element) markerElements.current.set(f.id, element); else markerElements.current.delete(f.id); }}>{f.sketchRef}</button>)}
      <div className="model-navigation-note">Drag to rotate · Scroll / pinch to zoom</div>
      <div className="model-play-controls"><button aria-label="Replay measurement animation" title="Replay animation" onClick={() => { commands.current.replay(); if (!playing) onTogglePlay(); }}><RotateCcw size={15}/></button><button aria-label={playing ? 'Pause measurement animation' : 'Play measurement animation'} title={playing ? 'Pause animation' : 'Play animation'} onClick={onTogglePlay}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button></div>
    </div>
    <div className="model-view-controls" aria-label="3D model controls"><button title="Fit the complete part" aria-label="Fit complete part" onClick={() => commands.current.fit()}><Scan size={14}/><span>Fit part</span></button><button title="Focus the selected measurement" aria-label="Focus selected feature" onClick={() => commands.current.focus()}><Crosshair size={14}/><span>Focus</span></button><button title="Top view" aria-label="Top model view" onClick={() => commands.current.top()}><Eye size={14}/><span>Top</span></button><button className={section ? 'selected' : ''} title="Show a cutaway of the part" aria-label="Section view" aria-pressed={section} onClick={() => setSection(value => !value)}><Layers3 size={14}/><span>Section</span></button><button className={callouts ? 'selected' : ''} title="Show selectable feature points" aria-label="Feature callouts" aria-pressed={callouts} onClick={() => setCallouts(value => !value)}><MapPin size={14}/></button></div>
    <div className="model-measurement-caption"><span/>{guide.description}</div>
    {guide.gauge && <div className="model-depth-convention">{feature.animationKey === 'thread-depth' ? <><i className="full-form-key"/>Full-form plane <i className="drill-floor-key"/>Drill floor<span>The gauge lead extends beyond the measured full-form plane. Follow the approved zero/lead correction.</span></> : 'Depth is referenced to the entry face. The illustrated contact plane follows the selected requirement.'}</div>}
    {expanded && candidates.length > 1 && onSelectFeature && <div className="model-feature-selector" aria-label="Select a model feature">{candidates.map(f => <button key={f.id} aria-pressed={f.id === feature.id} className={f.id === feature.id ? 'selected' : ''} onClick={() => select(f)}><span>{f.sketchRef}</span>{f.label}</button>)}</div>}
  </div>;
}
