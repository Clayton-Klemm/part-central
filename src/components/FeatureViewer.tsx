import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Feature } from '../types';
import { GEAR, animationSample, featureGuide, makeDogGeometry, makeGearGeometry, ringGeometry } from '../lib/gear';
import './FeatureViewer.css';

type AnimatedFeature = Feature & { animationKey: string };
type Props = { feature: AnimatedFeature; playing: boolean; onTogglePlay: () => void; expanded?: boolean };
const TEAL = 0x087e73;

function Fallback({ feature }: { feature: AnimatedFeature }) {
  const key = feature.animationKey;
  const topView = ['bore-diameter', 'pitch-diameter', 'face-runout'].includes(key);
  const top = key === 'ramp-height' ? 140 : key === 'overall-thickness' ? 170 : 100;
  return <div className="feature-fallback"><svg viewBox="0 0 420 290" role="img" aria-label={`Simplified illustration of ${feature.label}. ${featureGuide(key).description}`}>
    <defs><linearGradient id="fallback-metal" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d2d9d7"/><stop offset=".5" stopColor="#f4f5f3"/><stop offset="1" stopColor="#a0adaa"/></linearGradient><marker id="fallback-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto-start-reverse"><path d="M7 0L0 3.5 7 7" fill="none" stroke="#087e73"/></marker></defs>
    {topView ? <><circle cx="210" cy="145" r="96" fill="url(#fallback-metal)" stroke="#81908b" strokeWidth="2"/><circle cx="210" cy="145" r="32" fill="#edf2eb" stroke="#81908b"/>{Array.from({ length: 6 }, (_, i) => <rect key={i} x="198" y="72" width="24" height="29" rx="2" fill="#bbc9c0" stroke="#82958a" transform={`rotate(${i * 60} 210 145)`}/>) }
      {key === 'bore-diameter' ? <><circle cx="210" cy="145" r="32" stroke="#087e73" strokeWidth="4" fill="none"/><path d="M178 145H242" markerStart="url(#fallback-arrow)" markerEnd="url(#fallback-arrow)" stroke="#087e73"/></> : key === 'pitch-diameter' ? <><circle cx="210" cy="145" r="82" stroke="#087e73" strokeWidth="2" strokeDasharray="6 4" fill="none"/><path d="M128 145H292" markerStart="url(#fallback-arrow)" markerEnd="url(#fallback-arrow)" stroke="#087e73"/></> : <><circle cx="210" cy="145" r="86" stroke="#087e73" strokeWidth="7" strokeOpacity=".4" fill="none"/><path d="M296 145H331V110" stroke="#087e73" fill="none"/><circle cx="331" cy="98" r="14" stroke="#087e73" fill="#f6fff9"/><path d="M331 98l6-7" stroke="#087e73"/></>}
    </> : <><path d="M65 210H350" stroke="#9aa99d" strokeDasharray="5 4"/><path d="M80 170H330V210H80Z" fill="url(#fallback-metal)" stroke="#81908b"/><path d="M150 170V140L210 100H270V170Z" fill="url(#fallback-metal)" stroke="#81908b"/><text x="65" y="229" fill="#6c8072" fontSize="11">A</text>
      {key === 'ramp-angle' ? <><path d="M150 140L210 100M150 140H225M190 140A40 40 0 0 0 183 118" stroke="#087e73" strokeWidth="2" fill="none"/></> : key === 'dog-width' ? <><path d="M210 100V74M270 100V74M210 82H270" stroke="#087e73" fill="none"/><path d="M210 100H270" stroke="#087e73" strokeWidth="5"/></> : <><path d={`M${key === 'ramp-height' ? 150 : 270} ${top}H350M330 210H350M342 ${top}V210`} stroke="#087e73" strokeWidth="1.5" fill="none"/><path d={key === 'ramp-height' ? 'M150 140L210 100' : key === 'overall-thickness' ? 'M80 170H150' : 'M210 100H270'} stroke="#087e73" strokeWidth="5"/></>}
    </>}
    <text x="210" y="263" textAnchor="middle" fill="#63746b" fontSize="10">{featureGuide(key).description}</text>
  </svg><span className="feature-fallback-note">Simplified guide · 3D unavailable on this device</span></div>;
}

export default function FeatureViewer({ feature, playing, onTogglePlay, expanded = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ playing, feature });
  live.current = { playing, feature };
  const resetCamera = useRef<() => void>(() => {});
  const replayAnimation = useRef<() => void>(() => {});
  const [unavailable, setUnavailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(preference.matches);
    const listener = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', listener);
    return () => preference.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf2f5f1, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', `Interactive dog clutch model. ${featureGuide(feature.animationKey).description}. Drag to rotate, scroll to zoom.`);
    renderer.domElement.setAttribute('role', 'img');
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 70);
    const controls = new OrbitControls(camera, renderer.domElement);
    let needsRender = true;
    let inView = true;
    const changed = () => { needsRender = true; };
    controls.addEventListener('change', changed);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 22;
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    const home = () => { camera.position.set(8.7, 9.4, 10.8); controls.target.set(0.18, 0.42, 0); controls.update(); };
    home();
    resetCamera.current = home;

    scene.add(new THREE.HemisphereLight(0xf3f9ff, 0xa1aaa0, 3.3));
    const keyLight = new THREE.DirectionalLight(0xfffbef, 4.7);
    keyLight.position.set(-3, 9, 6); keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -5; keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5; keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.normalBias = 0.03; keyLight.shadow.bias = -0.0001;
    scene.add(keyLight);
    const fill = new THREE.DirectionalLight(0xd7e5ed, 2.5); fill.position.set(6, 4, -5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 3.5); rim.position.set(-6, 3, -3); scene.add(rim);

    const material = new THREE.MeshStandardMaterial({ color: 0x9caaa8, roughness: 0.32, metalness: 0.72 });
    const dogMaterial = new THREE.MeshStandardMaterial({ color: 0xb7c1bd, roughness: 0.3, metalness: 0.68 });
    const gear = new THREE.Mesh(makeGearGeometry(), material); gear.castShadow = true; gear.receiveShadow = true; scene.add(gear);
    const gearEdges = new THREE.LineSegments(new THREE.EdgesGeometry(gear.geometry, 32), new THREE.LineBasicMaterial({ color: 0x586963, transparent: true, opacity: 0.23 })); scene.add(gearEdges);
    const machining = new THREE.MeshBasicMaterial({ color: 0x697e73, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    for (const radius of [1.11, 1.16, 1.39, 1.45, 2.69, 2.74, 2.81, 2.88]) scene.add(new THREE.Mesh(ringGeometry(radius, radius + 0.007, GEAR.deck + 0.002), machining));
    for (let index = 0; index < 6; index++) {
      const dog = new THREE.Mesh(makeDogGeometry(GEAR.dogAngle + index * Math.PI / 3), dogMaterial); dog.castShadow = true; dog.receiveShadow = true; scene.add(dog);
      scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(dog.geometry, 27), new THREE.LineBasicMaterial({ color: 0x566b61, transparent: true, opacity: 0.28 })));
    }

    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.13 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = -0.045; shadowPlane.receiveShadow = true; scene.add(shadowPlane);
    const grid = new THREE.GridHelper(13, 26, 0xcdd8d0, 0xdde5dd); grid.position.y = -0.05; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.34; scene.add(grid);

    let guideGroup = new THREE.Group(); scene.add(guideGroup);
    let lastKey = '';
    let pathPoints: THREE.Vector3[] = [];
    let line: THREE.Line | null = null;
    let tracer: THREE.Mesh | null = null;
    let highlight: THREE.Mesh | null = null;
    let progress = 0;
    const disposeObject = (object: THREE.Object3D) => {
      object.traverse(child => {
        const item = child as THREE.Mesh;
        item.geometry?.dispose();
        if (Array.isArray(item.material)) item.material.forEach(m => m.dispose());
        else item.material?.dispose();
      });
    };
    const buildGuide = () => {
      needsRender = true;
      scene.remove(guideGroup); disposeObject(guideGroup); guideGroup = new THREE.Group(); scene.add(guideGroup);
      const guide = featureGuide(live.current.feature.animationKey);
      pathPoints = guide.points;
      const geometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: TEAL, depthTest: false })); line.renderOrder = 10; guideGroup.add(line);
      for (const points of guide.extensions) {
        const extension = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: TEAL, dashSize: 0.12, gapSize: 0.07, transparent: true, opacity: 0.75, depthTest: false }));
        extension.computeLineDistances(); extension.renderOrder = 9; guideGroup.add(extension);
      }
      if (!['ramp-angle', 'pitch-diameter', 'face-runout'].includes(live.current.feature.animationKey)) {
        const start = pathPoints[0], end = pathPoints[pathPoints.length - 1];
        const direction = end.clone().sub(start).normalize();
        for (const [point, sign] of [[start, 1], [end, -1]] as const) {
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.17, 12), new THREE.MeshBasicMaterial({ color: TEAL, depthTest: false }));
          arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().multiplyScalar(sign));
          arrow.position.copy(point).addScaledVector(direction, sign * 0.085); arrow.renderOrder = 11; guideGroup.add(arrow);
        }
      }
      tracer = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 12), new THREE.MeshBasicMaterial({ color: TEAL, depthTest: false })); tracer.renderOrder = 11; guideGroup.add(tracer);
      const patchMaterial = new THREE.MeshStandardMaterial({ color: 0x169980, emissive: 0x064d3c, emissiveIntensity: 0.3, transparent: true, opacity: 0.83, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide });
      if (guide.highlight === 'top' || guide.highlight === 'ramp') highlight = new THREE.Mesh(makeDogGeometry(GEAR.dogAngle, guide.highlight), patchMaterial);
      else if (guide.highlight === 'bore') {
        const geometry = new THREE.CylinderGeometry(GEAR.bore - 0.004, GEAR.bore - 0.004, GEAR.deck - 0.03, 90, 1, true);
        highlight = new THREE.Mesh(geometry, patchMaterial); highlight.position.y = GEAR.deck / 2;
        guideGroup.add(new THREE.Mesh(ringGeometry(GEAR.bore, GEAR.bore + 0.06, GEAR.deck + 0.006), patchMaterial));
      } else if (guide.highlight === 'face') highlight = new THREE.Mesh(ringGeometry(2.7, 2.86, GEAR.deck + 0.008), patchMaterial);
      else if (guide.highlight === 'pitch') highlight = new THREE.Mesh(ringGeometry(GEAR.pitch - 0.025, GEAR.pitch + 0.025, GEAR.deck + 0.03), patchMaterial);
      else highlight = new THREE.Mesh(ringGeometry(GEAR.bore + 0.08, GEAR.dogInner - 0.07, GEAR.deck + 0.006), patchMaterial);
      if (highlight) guideGroup.add(highlight);
      progress = reducedMotion ? 1 : 0;
      lastKey = live.current.feature.id;
      renderer.domElement.setAttribute('aria-label', `Interactive dog clutch model. ${guide.description}. Drag to rotate, scroll to zoom.`);
    };
    replayAnimation.current = () => { progress = 0; };

    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
      needsRender = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const visibility = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? true; needsRender = true; });
    visibility.observe(element);
    let frame = 0;
    let previous: number | null = null;
    let contextLost = false;
    const lostContext = (event: Event) => { event.preventDefault(); contextLost = true; setUnavailable(true); };
    renderer.domElement.addEventListener('webglcontextlost', lostContext);
    const animate = (time: number) => {
      if (contextLost) return;
      if (!inView || document.hidden) { previous = time; frame = requestAnimationFrame(animate); return; }
      // RAF timestamps can precede setup's performance.now() within the first frame.
      const delta = previous === null ? 0 : Math.max(0, Math.min((time - previous) / 1000, 0.08)); previous = time;
      if (lastKey !== live.current.feature.id) buildGuide();
      if (reducedMotion) progress = 1;
      else if (live.current.playing) { progress += delta / 3.5; if (progress > 1.65) progress = 0; }
      const { portion, drawCount, pointIndex } = animationSample(progress, pathPoints.length);
      line?.geometry.setDrawRange(0, drawCount);
      const tracePoint = pathPoints[pointIndex];
      if (tracer && tracePoint) { tracer.position.copy(tracePoint); tracer.visible = portion < 1; }
      controls.update();
      if (needsRender || (live.current.playing && !reducedMotion)) {
      renderer.render(scene, camera);
      needsRender = false;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); controls.removeEventListener('change', changed); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lostContext);
      disposeObject(scene); renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [reducedMotion]);

  const guide = featureGuide(feature.animationKey);
  return <div className={`feature-viewer ${expanded ? 'feature-viewer-expanded' : ''}`}>
    <div className="feature-viewer-stage" ref={host}>
      {unavailable && <Fallback feature={feature} />}
      {!unavailable && <><span className="feature-viewer-view">ISOMETRIC <span> / </span> FEATURE {String(feature.number).padStart(2, '0')}</span><div className="feature-viewer-axis" aria-hidden="true"><svg viewBox="0 0 52 46"><path d="M24 25V3M24 25L5 36M24 25L44 36" stroke="#aab5ad" strokeWidth="1.4" fill="none"/><path d="M24 25V8" stroke="#7e8f83" strokeWidth="1.5"/><text x="20" y="8">Z</text><text x="1" y="43">X</text><text x="43" y="43">Y</text></svg></div></>}
      <div className="feature-viewer-controls"><button type="button" onClick={() => { replayAnimation.current(); if (!playing) onTogglePlay(); }} aria-label="Replay measurement animation" title="Replay animation"><svg viewBox="0 0 20 20"><path d="M5 5.5A6 6 0 1 1 4 12M5 2v4H1"/></svg></button><button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause measurement animation' : 'Play measurement animation'} title={playing ? 'Pause animation' : 'Play animation'}>{playing ? <svg viewBox="0 0 20 20"><path d="M7 5v10M13 5v10"/></svg> : <svg viewBox="0 0 20 20"><path d="M7 4l8 6-8 6Z"/></svg>}</button><button type="button" onClick={() => resetCamera.current()} aria-label="Reset model view" title="Reset view"><svg viewBox="0 0 20 20"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg></button></div>
    </div>
    <div className="feature-viewer-caption"><span className="feature-viewer-caption-dot"/>{guide.description}<span className="feature-viewer-drag">Drag to orbit</span></div>
  </div>;
}
