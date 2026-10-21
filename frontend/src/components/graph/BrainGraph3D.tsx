import { Component, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { createBrainScaffold, layoutBrainNodes, scaffoldBuffers, type BrainLink, type BrainNode, type Point3 } from '@/lib/brain-layout';

export interface BrainGraphHandle { zoom: (direction: number) => void; reset: () => void; enter: () => void }
interface Props {
  nodes: BrainNode[];
  links: BrainLink[];
  selectedId: string | null;
  highlightedIds: Set<string> | null;
  showEdges: boolean;
  showLabels: boolean;
  inside: boolean;
  theme: string;
  unavailableText: string;
  scaffoldCount?: number;
  backgroundColor?: string;
  onSelect: (node: BrainNode) => void;
  onOpen: (node: BrainNode) => void;
  onClear: () => void;
}
interface Palette { node: string; muted: string; background: string }

// 3/4 lateral view: the angle where the brain is most recognisable.
const VIEW_DIRECTION = new THREE.Vector3(0.82, 0.14, 0.56).normalize();
const VIEW_TARGET = new THREE.Vector3(0, 0, 0);
const NODE_APPEARANCE = { widthSegments: 24, heightSegments: 16, pulseAmplitude: 0.035, pulsePeriod: 4 };

// The brain outline (a real cortex surface resampled in brain-layout.ts): one Points draw call + one LineSegments draw call, built
// once and cached in the layout module (no per-instance matrices, no O(n^2) work).
function Scaffold({ palette, inside, count }: { palette: Palette; inside: boolean; count: number }) {
  const { points, lines } = useMemo(() => scaffoldBuffers(createBrainScaffold(count)), [count]);
  return <group>
    <points raycast={() => null} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry>
      <pointsMaterial color={palette.node} size={inside ? 0.028 : 0.04} sizeAttenuation transparent opacity={inside ? 0.18 : 0.45} depthWrite={false} />
    </points>
    <lineSegments raycast={() => null} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[lines, 3]} /></bufferGeometry>
      <lineBasicMaterial color={palette.node} transparent opacity={inside ? 0.04 : 0.12} depthWrite={false} />
    </lineSegments>
  </group>;
}

function Network({ positions, palette, ...props }: Props & { positions: Map<string, Point3>; palette: Palette }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree(state => state.invalidate);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const pulse = useMemo(() => ({ time: { value: 0 }, amplitude: { value: 0 } }), []);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      pulse.amplitude.value = preference.matches ? 0 : NODE_APPEARANCE.pulseAmplitude;
      invalidate();
    };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, [pulse, invalidate]);
  useFrame((_, delta) => {
    if (!pulse.amplitude.value) return;
    pulse.time.value += Math.min(delta, 0.05);
    invalidate();
  });
  // Animate on the GPU: no per-frame instance rebuilds or React state updates.
  const animateMaterial = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uNodeTime = pulse.time;
    shader.uniforms.uNodeAmplitude = pulse.amplitude;
    shader.vertexShader = `uniform float uNodeTime;\nuniform float uNodeAmplitude;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = dot(instanceMatrix[3].xyz, vec3(1.7, 2.3, 0.9));
        transformed *= 1.0 + uNodeAmplitude * sin(uNodeTime * ${2 * Math.PI / NODE_APPEARANCE.pulsePeriod} + phase);
      #endif
    `);
  };
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => [new THREE.Color(palette.node), new THREE.Color(palette.muted)], [palette]);
  const indexById = useMemo(() => new Map(props.nodes.map((n, i) => [n.id, i])), [props.nodes]);
  const active = props.nodes.find(n => n.id === (hovered ?? props.selectedId));

  // Node radius by degree, computed once per graph (it used to be recomputed on every hover).
  const baseSize = useMemo(() => {
    const degree = new Uint32Array(props.nodes.length);
    props.links.forEach(l => {
      const a = indexById.get(l.source), b = indexById.get(l.target);
      if (a !== undefined) degree[a]++;
      if (b !== undefined) degree[b]++;
    });
    return Float32Array.from(degree, d => 0.038 + Math.min(0.045, d * 0.0055));
  }, [props.nodes, props.links, indexById]);

  const place = (index: number, isHover: boolean) => {
    const instances = mesh.current;
    const node = props.nodes[index];
    const point = node && positions.get(node.id);
    if (!instances || !point) return;
    const highlighted = !props.highlightedIds || props.highlightedIds.has(node.id);
    const selected = node.id === props.selectedId || isHover;
    dummy.position.set(point[0], point[1], point[2]);
    dummy.scale.setScalar(baseSize[index] * (selected ? 1.5 : highlighted ? 1 : 0.6));
    dummy.updateMatrix();
    instances.setMatrixAt(index, dummy.matrix);
    instances.setColorAt(index, colors[highlighted ? 0 : 1]);
  };

  // Full rebuild: only when the graph, selection, highlight or palette change.
  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    for (let i = 0; i < props.nodes.length; i++) place(i, props.nodes[i].id === hoveredRef.current);
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.nodes, props.selectedId, props.highlightedIds, positions, colors, baseSize]);

  // Hover touches only the two instances involved instead of rebuilding all of them.
  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const previous = hoveredRef.current;
    hoveredRef.current = hovered;
    for (const id of [previous, hovered]) {
      const index = id ? indexById.get(id) : undefined;
      if (index !== undefined) place(index, id === hovered);
    }
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered]);

  const edgePositions = useMemo(() => {
    const normal: number[] = [], focused: number[] = [];
    for (const link of props.links) {
      const a = positions.get(link.source), b = positions.get(link.target);
      if (!a || !b) continue;
      const target = props.selectedId && (link.source === props.selectedId || link.target === props.selectedId) ? focused : normal;
      target.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return [Float32Array.from(normal), Float32Array.from(focused)];
  }, [props.links, props.selectedId, positions]);

  // Many links add up to a white mass: fade them as the graph grows.
  const edgeOpacity = Math.min(0.4, Math.max(0.09, 14 / Math.sqrt(Math.max(1, props.links.length))));
  const nodeAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.instanceId === undefined ? undefined : props.nodes[e.instanceId];

  return <>
    {props.showEdges && edgePositions.map((array, index) => <lineSegments key={index} raycast={() => null} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[array, 3]} /></bufferGeometry>
      <lineBasicMaterial color={palette.node} transparent opacity={index === 1 ? 0.95 : props.selectedId ? 0.1 : edgeOpacity} depthWrite={false} />
    </lineSegments>)}
    <instancedMesh ref={mesh} args={[undefined, undefined, props.nodes.length]} frustumCulled={false}
      onClick={e => { if (e.delta > 5) return; const node = nodeAt(e); if (node) { e.stopPropagation(); props.onSelect(node); } }}
      onDoubleClick={e => { const node = nodeAt(e); if (node) { e.stopPropagation(); props.onOpen(node); } }}
      onPointerOver={e => { e.stopPropagation(); setHovered(nodeAt(e)?.id ?? null); }}
      onPointerMove={e => { if (e.pointerType === 'touch') return; e.stopPropagation(); setHovered(nodeAt(e)?.id ?? null); }}
      onPointerOut={() => setHovered(null)}>
      <sphereGeometry args={[1, NODE_APPEARANCE.widthSegments, NODE_APPEARANCE.heightSegments]} />
      <meshLambertMaterial onBeforeCompile={animateMaterial} customProgramCacheKey={() => 'brain-node-pulse-v1'} />
    </instancedMesh>
    {active && props.showLabels && <Html position={positions.get(active.id)} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="pointer-events-none -translate-y-8 max-w-48 truncate rounded-md border border-border/10 bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-md">{active.label}</div>
    </Html>}
  </>;
}

const CameraRig = forwardRef<BrainGraphHandle, { inside: boolean }>(function CameraRig({ inside }, ref) {
  const { camera, invalidate, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const reset = () => {
    // distance from the aspect ratio so the whole brain fits on portrait phones too
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);
    const aspect = size.width / Math.max(1, size.height);
    const distance = THREE.MathUtils.clamp(7.2 / (2 * Math.tan(fov / 2) * Math.min(aspect, 1.5)), 9.5, 28);
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance).add(VIEW_TARGET);
    controls.current?.target.copy(VIEW_TARGET);
    controls.current?.update(); invalidate();
  };
  const enter = () => {
    camera.position.set(0.1, 0.4, 1.3);
    controls.current?.target.set(0, 0.3, -0.6);
    controls.current?.update(); invalidate();
  };
  useEffect(() => { if (inside) enter(); else reset(); }, [inside, size.width, size.height]);
  useImperativeHandle(ref, () => ({
    reset, enter,
    zoom(direction) {
      const control = controls.current;
      if (!control) return;
      const offset = camera.position.clone().sub(control.target);
      const distance = THREE.MathUtils.clamp(offset.length() * (direction > 0 ? 0.72 : 1.38), 0.12, 34);
      camera.position.copy(control.target).add(offset.normalize().multiplyScalar(distance));
      control.update(); invalidate();
    },
  }));
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={0.12} maxDistance={34} zoomSpeed={0.85} rotateSpeed={0.65} enablePan />;
});

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export const BrainGraph3D = forwardRef<BrainGraphHandle, Props>(function BrainGraph3D(props, ref) {
  const [palette, setPalette] = useState<Palette | null>(null);
  const positions = useMemo(() => layoutBrainNodes(props.nodes, props.links), [props.nodes, props.links]);
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    setPalette({
      node: css.getPropertyValue('--graph-node').trim(),
      muted: css.getPropertyValue('--graph-muted').trim(),
      background: props.backgroundColor ?? css.getPropertyValue('--bg-base').trim(),
    });
  }, [props.backgroundColor, props.theme]);
  const fallback = <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted-foreground">{props.unavailableText}</div>;
  if (!palette) return null;
  return <SceneBoundary fallback={fallback}>
    <Canvas className="touch-none" frameloop="demand" dpr={[1, 2]}
      camera={{ position: [10, 2, 7], fov: 45, near: 0.015, far: 120 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      fallback={fallback} onPointerMissed={props.onClear}>
      <color attach="background" args={[palette.background]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[5, 8, 6]} intensity={2.2} />
      <directionalLight position={[-6, -3, -5]} intensity={0.6} />
      <Scaffold palette={palette} inside={props.inside} count={props.scaffoldCount ?? 2800} />
      {props.nodes.length > 0 && <Network {...props} positions={positions} palette={palette} />}
      <CameraRig ref={ref} inside={props.inside} />
    </Canvas>
  </SceneBoundary>;
});