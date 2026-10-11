import { BRAIN_SURFACE_B64 } from './brain-surface-data';

export interface BrainNode {
  id: string;
  label: string;
  type: string;
  createdAt?: string;
}

export interface BrainLink { source: string; target: string }
export type Point3 = [number, number, number];

// Axes: x = left/right, y = up/down, z = front(+)/back(-), centred on the origin,
// about 5.2 wide, 5.6 tall and 6.6 long.
//
// The brain outline is a real one: points resampled from the ICBM152 template
// surface (see brain-surface-data.ts for source and licence). They are ordered
// so that ANY prefix is evenly spread over the surface: the first n points are a
// good layout for n nodes, and a longer prefix is a denser outline.

// ---- real brain surface ---------------------------------------------------------

let surfaceCache: Point3[] | null = null;
function surface(): Point3[] {
  if (surfaceCache) return surfaceCache;
  const binary = atob(BRAIN_SURFACE_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const count = Math.floor(bytes.length / 6);
  const points: Point3[] = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = [view.getInt16(i * 6, true) / 1000, view.getInt16(i * 6 + 2, true) / 1000, view.getInt16(i * 6 + 4, true) / 1000];
  }
  surfaceCache = points;
  return points;
}

// `depth` < 1 pulls a surface point toward the centre of the brain.
export function brainPoint(index: number, _count?: number, depth = 1): Point3 {
  const points = surface();
  const p = points[((index % points.length) + points.length) % points.length];
  return [p[0] * depth, p[1] * depth, p[2] * depth];
}

// ---- scaffold -----------------------------------------------------------------

export interface BrainScaffold { points: Point3[]; links: [number, number][] }

// k-nearest links through a uniform grid (the old version sorted every point
// against every other one: O(n^2 log n) on each mount).
function nearestLinks(points: Point3[], k = 3): [number, number][] {
  const cell = 0.5;
  const grid = new Map<string, number[]>();
  const c = (v: number) => Math.floor(v / cell);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  points.forEach((p, i) => {
    const kk = key(c(p[0]), c(p[1]), c(p[2]));
    const bucket = grid.get(kk);
    if (bucket) bucket.push(i); else grid.set(kk, [i]);
  });
  const seen = new Set<number>();
  const links: [number, number][] = [];
  points.forEach((p, i) => {
    const cx = c(p[0]), cy = c(p[1]), cz = c(p[2]);
    let cand: number[] = [];
    for (let r = 1; r <= 3 && cand.length < k + 1; r++) {
      cand = [];
      for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
        const bucket = grid.get(key(x, y, z));
        if (bucket) for (const j of bucket) if (j !== i) cand.push(j);
      }
    }
    const near = cand
      .map(j => ({ j, d: (p[0] - points[j][0]) ** 2 + (p[1] - points[j][1]) ** 2 + (p[2] - points[j][2]) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const { j } of near) {
      const a = Math.min(i, j), b = Math.max(i, j);
      const id = a * points.length + b;
      if (!seen.has(id)) { seen.add(id); links.push([a, b]); }
    }
  });
  return links;
}

const scaffoldCache = new Map<number, BrainScaffold>();
export function createBrainScaffold(count = 2800): BrainScaffold {
  const size = Math.min(count, surface().length);
  const cached = scaffoldCache.get(size);
  if (cached) return cached;
  const points = surface().slice(0, size);
  const scaffold = { points, links: nearestLinks(points) };
  scaffoldCache.set(size, scaffold);
  return scaffold;
}

const bufferCache = new WeakMap<BrainScaffold, { points: Float32Array; lines: Float32Array }>();
export function scaffoldBuffers(scaffold: BrainScaffold) {
  const cached = bufferCache.get(scaffold);
  if (cached) return cached;
  const points = new Float32Array(scaffold.points.length * 3);
  scaffold.points.forEach((p, i) => points.set(p, i * 3));
  const lines = new Float32Array(scaffold.links.length * 6);
  scaffold.links.forEach(([a, b], i) => {
    lines.set(scaffold.points[a], i * 6);
    lines.set(scaffold.points[b], i * 6 + 3);
  });
  const buffers = { points, lines };
  bufferCache.set(scaffold, buffers);
  return buffers;
}

// ---- topology-aware node placement ---------------------------------------------

// Smooth, low-frequency coordinates of the graph (random-walk eigenvectors via
// power iteration). Linked nodes get similar coordinates.
function spectral(n: number, adj: number[][], dims = 3): Float64Array[] {
  const deg = adj.map(a => Math.max(1, a.length));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const vecs: Float64Array[] = [];
  for (let d = 0; d < dims; d++) {
    let v = Float64Array.from({ length: n }, () => rnd() - 0.5);
    for (let it = 0; it < 60; it++) {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const j of adj[i]) s += v[j];
        w[i] = 0.5 * v[i] + 0.5 * s / deg[i];
      }
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += deg[i] * w[i]; den += deg[i]; }
      const mean = num / den;
      for (let i = 0; i < n; i++) w[i] -= mean;
      for (const u of vecs) {
        let a = 0, b = 0;
        for (let i = 0; i < n; i++) { a += deg[i] * w[i] * u[i]; b += deg[i] * u[i] * u[i]; }
        const c = a / (b || 1);
        for (let i = 0; i < n; i++) w[i] -= c * u[i];
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < n; i++) w[i] /= norm;
      v = w;
    }
    vecs.push(v);
  }
  return vecs;
}

// Rank-preserving recursive bisection: nodes sorted by one spectral coordinate
// are matched to slots sorted by one spatial axis (z, then x, then y), halving
// each time. Every node gets its own slot, so nothing is stacked.
function match(items: number[], slotIds: number[], emb: Float64Array[], slots: Point3[], depth: number, out: number[]) {
  if (items.length === 0) return;
  if (items.length === 1) { out[items[0]] = slotIds[0]; return; }
  const k = depth % 3;
  const geo = [2, 0, 1][k];
  items.sort((a, b) => emb[k][a] - emb[k][b] || a - b);
  slotIds.sort((a, b) => slots[a][geo] - slots[b][geo] || a - b);
  const mid = items.length >> 1;
  match(items.slice(0, mid), slotIds.slice(0, mid), emb, slots, depth + 1, out);
  match(items.slice(mid), slotIds.slice(mid), emb, slots, depth + 1, out);
}

export function layoutBrainNodes(nodes: BrainNode[], links: BrainLink[] = []): Map<string, Point3> {
  const n = nodes.length;
  const positions = new Map<string, Point3>();
  if (!n) return positions;
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const available = surface().length;
  // Slot i = i-th surface point: the prefix is evenly spread, so nodes never stack and
  // keep a minimum spacing. Depth layers fill the volume; graphs larger than the
  // point set wrap around into slightly smaller concentric layers.
  const slots: Point3[] = sorted.map((_, i) => {
    const layer = Math.floor(i / available);
    const s = i % available;
    const h = (((s + layer * 7919) * 2654435761) >>> 0) % 100;
    const depth = (h < 8 ? 0.55 : h < 22 ? 0.8 : 0.98) * Math.pow(0.9, layer);
    return brainPoint(s, available, depth);
  });
  const index = new Map(sorted.map((nd, i) => [nd.id, i]));
  const adj: number[][] = sorted.map(() => []);
  for (const l of links) {
    const a = index.get(l.source), b = index.get(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  const emb = spectral(n, adj);
  const out: number[] = new Array(n);
  match(sorted.map((_, i) => i), slots.map((_, i) => i), emb, slots, 0, out);
  sorted.forEach((nd, i) => positions.set(nd.id, slots[out[i]]));
  return positions;
}

export function normalizeBrainLinks(nodes: BrainNode[], links: BrainLink[]): BrainLink[] {
  const ids = new Set(nodes.map(n => n.id));
  const seen = new Set<string>();
  return links.filter(link => {
    if (!ids.has(link.source) || !ids.has(link.target) || link.source === link.target) return false;
    const key = [link.source, link.target].sort().join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}