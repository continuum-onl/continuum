import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { graphApi, entitiesApi } from "@/lib/api";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  Search,
  Settings,
  Eye,
  EyeOff,
  X,
  ArrowLeft,
} from "@/lib/heroicons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SideInspector } from "@/components/SideInspector";
import { useEntityStore } from "@/contexts/EntityContext";
import type { Entity, EntityType } from "@/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { queryClient } from "@/lib/query-client";
import { qk, STALE } from "@/lib/queries";
import { BrainGraph3D, type BrainGraphHandle } from "@/components/graph/BrainGraph3D";
import { normalizeBrainLinks, type BrainNode, type BrainLink } from "@/lib/brain-layout";

interface GraphNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  mass: number;
  recent?: boolean;
  createdAt?: string;
  periodKey?: string;
  periodX?: number;
  periodY?: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

// Paleta estilo Obsidian (Monocromática, limpa e com bom contraste)
const TYPE_COLORS: Record<string, string> = {
  NOTE: "hsl(0, 0%, 85%)",
  ACTIVITY: "hsl(0, 0%, 65%)",
  PERSON: "hsl(0, 0%, 60%)",
  PROJECT: "hsl(0, 0%, 75%)",
  TOPIC: "hsl(0, 0%, 50%)",
  ORGANIZATION: "hsl(0, 0%, 45%)",
};
const HIGHLIGHT_COLOR = "hsl(0, 0%, 100%)";

const TYPE_LABEL_KEYS: Record<string, string> = {
  NOTE: "gr_type_note",
  ACTIVITY: "gr_type_activity",
  PERSON: "gr_type_person",
  PROJECT: "gr_type_project",
  TOPIC: "gr_type_topic",
  ORGANIZATION: "gr_type_organization",
};

const BASE_RADIUS: Record<string, number> = {
  NOTE: 4, ACTIVITY: 5, PERSON: 5, PROJECT: 6, TOPIC: 5, ORGANIZATION: 6,
};

// ── Barnes-Hut quadtree otimizado (Massa baseada em conexões) ────────
interface QuadNode {
  x: number; y: number; w: number; h: number;
  cx: number; cy: number; mass: number;
  node: GraphNode | null;
  children: (QuadNode | null)[] | null;
}

function makeQuad(x: number, y: number, w: number, h: number): QuadNode {
  return { x, y, w, h, cx: 0, cy: 0, mass: 0, node: null, children: null };
}

function quadInsert(q: QuadNode, n: GraphNode, depth = 0) {
  if (depth > 16) return;
  if (q.mass === 0 && q.node === null) {
    q.node = n; q.cx = n.x; q.cy = n.y; q.mass = n.mass;
    return;
  }
  if (q.children === null) {
    const hw = q.w / 2, hh = q.h / 2;
    q.children = [
      makeQuad(q.x, q.y, hw, hh),
      makeQuad(q.x + hw, q.y, hw, hh),
      makeQuad(q.x, q.y + hh, hw, hh),
      makeQuad(q.x + hw, q.y + hh, hw, hh),
    ];
    if (q.node) {
      const old = q.node; q.node = null;
      const idx = (old.x >= q.x + hw ? 1 : 0) + (old.y >= q.y + hh ? 2 : 0);
      quadInsert(q.children[idx]!, old, depth + 1);
    }
  }
  q.cx = (q.cx * q.mass + n.x * n.mass) / (q.mass + n.mass);
  q.cy = (q.cy * q.mass + n.y * n.mass) / (q.mass + n.mass);
  q.mass += n.mass;
  const hw = q.w / 2, hh = q.h / 2;
  const idx = (n.x >= q.x + hw ? 1 : 0) + (n.y >= q.y + hh ? 2 : 0);
  quadInsert(q.children[idx]!, n, depth + 1);
}

function quadForce(q: QuadNode, n: GraphNode, theta: number, repulsion: number) {
  if (q.mass === 0) return;
  if (q.node === n) return;
  const dx = q.cx - n.x;
  const dy = q.cy - n.y;
  const d2 = dx * dx + dy * dy + 1; // +1 evita divisão por zero
  if (q.children === null || (q.w * q.w) / d2 < theta * theta) {
    const dist = Math.sqrt(d2);
    // Repulsão escala com a massa do cluster
    const force = (repulsion * q.mass) / d2;
    n.vx -= (dx / dist) * force;
    n.vy -= (dy / dist) * force;
    return;
  }
  for (const c of q.children) if (c) quadForce(c, n, theta, repulsion);
}

// ── Switch simples para o menu de opções (liga/desliga claro, sem libs extras) ──
function OptionSwitch({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-foreground/85" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
            checked ? "translate-x-4" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

export default function KnowledgeGraph() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const typeLabel = useCallback((type: string) => t(TYPE_LABEL_KEYS[type]) || type, [t]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const brainGraphRef = useRef<BrainGraphHandle>(null);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphStats, setGraphStats] = useState({ nodes: 0, edges: 0 });
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showLabels, setShowLabels] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [timeFilter, setTimeFilter] = useState<"all" | "7d" | "30d">("all");
  const [legendOpen, setLegendOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
  // Default false para formação orgânica estilo Obsidian
  const [clusterByPeriod, setClusterByPeriod] = useState(false);
  const [show3D, setShow3D] = useState(false);

  const { inspectorOpen, inspectorEntity, openInspector, closeInspector } = useEntityStore();
  const [allEntities, setAllEntities] = useState<Entity[]>([]);

  // Refs mutáveis para o loop de animação
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const adjRef = useRef<Map<string, Set<string>>>(new Map());
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const draggingRef = useRef<GraphNode | null>(null);
  const panningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);
  const alphaRef = useRef(1); // Temperatura da simulação

  const selectedRef = useRef<GraphNode | null>(null);
  const hoveredRef = useRef<GraphNode | null>(null);
  const filtersRef = useRef<Set<string>>(typeFilters);
  const searchRef = useRef<string>("");
  const showLabelsRef = useRef(true);
  const showEdgesRef = useRef(true);
  const timeFilterRef = useRef<"all" | "7d" | "30d">("all");
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const pinchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const tappedAtRef = useRef(0);
  const focusModeRef = useRef(false);
  const clusterRef = useRef(false);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const cancelPendingOpen = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    pressOriginRef.current = null;
  }, []);

  const schedulePanelOpen = useCallback((node: GraphNode) => {
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
    openTimeoutRef.current = setTimeout(() => {
      openTimeoutRef.current = null;
      pressOriginRef.current = null;
      // call focusNode via ref to avoid stale closure issues
      focusNodeRef.current?.(node);
    }, 700);
  }, []);

  const focusNodeRef = useRef<((n: GraphNode) => void) | null>(null);

  // Re-aquecer a simulação ao mudar seleções
  useEffect(() => { selectedRef.current = selectedNode; alphaRef.current = Math.max(alphaRef.current, 0.4); }, [selectedNode]);
  useEffect(() => { hoveredRef.current = hoveredNode; }, [hoveredNode]);
  useEffect(() => { filtersRef.current = typeFilters; alphaRef.current = 0.5; }, [typeFilters]);
  useEffect(() => { searchRef.current = search.trim().toLowerCase(); }, [search]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);
  useEffect(() => { showEdgesRef.current = showEdges; }, [showEdges]);
  useEffect(() => { timeFilterRef.current = timeFilter; alphaRef.current = 0.5; }, [timeFilter]);
  useEffect(() => { focusModeRef.current = focusMode; alphaRef.current = 0.5; }, [focusMode]);
  useEffect(() => { clusterRef.current = clusterByPeriod; alphaRef.current = 1; }, [clusterByPeriod]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const isNodeVisible = useCallback((n: GraphNode) => {
    const f = filtersRef.current;
    if (f.size > 0 && !f.has(n.type)) return false;
    const tf = timeFilterRef.current;
    if (tf !== "all" && n.createdAt) {
      const diff = Date.now() - new Date(n.createdAt).getTime();
      const limit = tf === "7d" ? 7 * 86400000 : 30 * 86400000;
      if (diff > limit) return false;
    } else if (tf !== "all" && !n.createdAt) {
      return false;
    }
    return true;
  }, []);

  const neighborIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const out = new Set<string>([selectedNode.id]);
    let frontier = [selectedNode.id];
    for (let d = 0; d < focusDepth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        adjRef.current.get(id)?.forEach(n => { if (!out.has(n)) { out.add(n); next.push(n); } });
      }
      frontier = next;
    }
    return out;
  }, [selectedNode, focusDepth]);

  const brainNodes = useMemo<BrainNode[]>(() => {
    const visible = nodesRef.current.filter(node => {
      if (typeFilters.size && !typeFilters.has(node.type)) return false;
      if (timeFilter !== "all") {
        if (!node.createdAt) return false;
        const diff = Date.now() - new Date(node.createdAt).getTime();
        const limit = timeFilter === "7d" ? 7 * 86400000 : 30 * 86400000;
        if (diff > limit) return false;
      }
      if (focusMode && selectedNode && !neighborIds.has(node.id)) return false;
      return true;
    });
    return visible.map(({ id, label, type, createdAt }) => ({ id, label, type, createdAt }));
  }, [graphStats, typeFilters, timeFilter, focusMode, selectedNode, neighborIds]);
  const brainLinks = useMemo<BrainLink[]>(() => {
    const visibleIds = new Set(brainNodes.map(node => node.id));
    return normalizeBrainLinks(brainNodes, edgesRef.current.filter(link =>
      visibleIds.has(link.source) && visibleIds.has(link.target)
    ));
  }, [brainNodes, graphStats]);
  const highlightedBrainNodes = useMemo(() => {
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      return new Set(brainNodes.filter(node => node.label.toLowerCase().includes(query)).map(node => node.id));
    }
    return selectedNode ? neighborIds : null;
  }, [search, brainNodes, selectedNode, neighborIds]);

  const neighborIdsRef = useRef(neighborIds);
  useEffect(() => { neighborIdsRef.current = neighborIds; }, [neighborIds]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: (sx - p.x) / z, y: (sy - p.y) / z };
  }, []);

  const findNodeAt = useCallback((sx: number, sy: number) => {
    const w = screenToWorld(sx, sy);
    const z = zoomRef.current;
    const nodes = nodesRef.current;
    const hitPad = (isMobile ? 12 : 6) / z;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!isNodeVisible(n)) continue;
      const r = (BASE_RADIUS[n.type] || 4) + Math.min(8, n.degree * 0.4) + hitPad;
      const dx = n.x - w.x;
      const dy = n.y - w.y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }, [screenToWorld, isMobile, isNodeVisible]);

  // ── Física de Simulação Profissional (Obsidian-like) ───────────────
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0 || alphaRef.current < 0.005) return;

    // Constantes aprimoradas
    const repulsion = nodes.length > 180 ? 280 : 450;
    const attraction = nodes.length > 180 ? 0.028 : 0.015;
    const damping = nodes.length > 120 ? 0.78 : 0.90; // Mais amortecimento em grafos maiores
    const centerForce = 0.02;
    const periodPull = clusterRef.current ? 0.03 : 0;
    const alpha = alphaRef.current;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const pad = 100;
    const w = Math.max(maxX - minX, maxY - minY, 300) + pad * 2;
    const root = makeQuad(minX - pad, minY - pad, w, w);
    for (const n of nodes) quadInsert(root, n);

    for (const n of nodes) {
      // Força para o centro ou período
      if (periodPull > 0 && n.periodX !== undefined && n.periodY !== undefined) {
        n.vx += (n.periodX - n.x) * periodPull;
        n.vy += (n.periodY - n.y) * periodPull;
      } else {
        n.vx -= n.x * centerForce;
        n.vy -= n.y * centerForce;
      }
      // Força de repulsão via quadtree
      quadForce(root, n, 0.85, repulsion);
    }

    // Força das Molas (Edges) com Distância Dinâmica
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Distância ideal baseada nos graus: Hubs ficam mais distantes
      const idealLen = 40 + (a.degree + b.degree) * 3;
      const force = (dist - idealLen) * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Passe de Colisão Rígida (Evita nós sobrepostos)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const rA = (BASE_RADIUS[a.type] || 4) + Math.min(8, a.degree * 0.4);
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const rB = (BASE_RADIUS[b.type] || 4) + Math.min(8, b.degree * 0.4);
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy;
        const minD = rA + rB + 6; // Raio + padding

        if (dist2 < minD * minD && dist2 > 0) {
          const dist = Math.sqrt(dist2);
          const force = (minD - dist) / dist * 0.3; // Resolver colisão
          const fx = dx * force;
          const fy = dy * force;
          // Nós com menos conexões cedem mais no impacto
          const massRatioA = b.mass / (a.mass + b.mass);
          const massRatioB = a.mass / (a.mass + b.mass);
          a.vx -= fx * massRatioA; a.vy -= fy * massRatioA;
          b.vx += fx * massRatioB; b.vy += fy * massRatioB;
        }
      }
    }

    const drag = draggingRef.current;
    for (const n of nodes) {
      if (n === drag) continue;
      n.vx *= damping;
      n.vy *= damping;

      const maxVel = 12;
      n.vx = Math.max(-maxVel, Math.min(maxVel, n.vx));
      n.vy = Math.max(-maxVel, Math.min(maxVel, n.vy));

      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
    }

    // Resfriamento logarítmico para parada suave
    alphaRef.current = Math.max(0.0, alphaRef.current * 0.93);
  }, []);

  // ── Renderização Avançada ────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Vinheta radial sutil para dar profundidade ao fundo preto
    const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, "hsla(0,0%,100%,0.035)");
    vignette.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    ctx.translate(panRef.current.x, panRef.current.y);
    ctx.scale(zoomRef.current, zoomRef.current);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const selected = selectedRef.current;
    const hovered = hoveredRef.current;
    const neighbors = neighborIdsRef.current;
    const hasSelection = selected !== null;
    const z = zoomRef.current;
    const sq = searchRef.current;
    const showL = showLabelsRef.current;
    const focusOn = focusModeRef.current && hasSelection;

    // Renderizar Arestas
    if (showEdgesRef.current) {
      ctx.lineCap = "round";
      for (const e of edges) {
        const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
        if (!a || !b) continue;
        if (!isNodeVisible(a) || !isNodeVisible(b)) continue;
        if (focusOn && !(neighbors.has(e.source) && neighbors.has(e.target))) continue;

        const isHighlighted = hasSelection && neighbors.has(e.source) && neighbors.has(e.target);
        const isHoveredEdge = hovered && (hovered.id === e.source || hovered.id === e.target);

        if (hasSelection && !isHighlighted) {
          ctx.strokeStyle = theme === "LIGHT" ? "hsla(40,10%,14%,0.12)" : "hsla(0,0%,100%,0.05)";
          ctx.lineWidth = (theme === "LIGHT" ? 0.8 : 0.6) / z;
        } else if (isHighlighted || isHoveredEdge) {
          ctx.strokeStyle = theme === "LIGHT" ? "hsla(40,10%,14%,0.8)" : "hsla(0,0%,100%,0.75)";
          ctx.lineWidth = (theme === "LIGHT" ? 2.4 : 2) / z;
        } else {
          ctx.strokeStyle = theme === "LIGHT" ? "hsla(40,10%,14%,0.42)" : "hsla(0,0%,100%,0.28)";
          ctx.lineWidth = Math.min(theme === "LIGHT" ? 2 : 1.6, (theme === "LIGHT" ? 1.2 : 0.9) + (a.degree + b.degree) * 0.02) / z;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Renderizar Nós
    for (const n of nodes) {
      if (focusOn && !neighbors.has(n.id)) continue;
      const visible = isNodeVisible(n);
      const r = (BASE_RADIUS[n.type] || 4) + Math.min(8, n.degree * 0.4);
      const color = TYPE_COLORS[n.type] || "hsl(0,0%,40%)";
      const isHovered = hovered?.id === n.id;
      const isSelected = selected?.id === n.id;
      const isNeighbor = hasSelection && neighbors.has(n.id);
      const matchesSearch = sq.length > 0 && n.label.toLowerCase().includes(sq);
      const dimmed = !visible || (hasSelection && !isNeighbor) || (sq.length > 0 && !matchesSearch);

      const drawRadius = isHovered || isSelected ? r + 2.5 : r;
      const nodeAlpha = dimmed ? 0.1 : 1;

      // Glow suave
      if (!dimmed && (isSelected || isHovered || isNeighbor || matchesSearch)) {
        ctx.save();
        ctx.globalAlpha = isSelected ? 0.6 : matchesSearch ? 0.5 : isHovered ? 0.4 : 0.15;
        ctx.beginPath();
        ctx.arc(n.x, n.y, drawRadius + 7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = nodeAlpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, drawRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Highlight sutil para dar volume (efeito de esfera)
      if (!dimmed) {
        ctx.globalAlpha = nodeAlpha * 0.45;
        ctx.beginPath();
        ctx.arc(n.x - drawRadius * 0.32, n.y - drawRadius * 0.32, drawRadius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(0,0%,100%,0.35)";
        ctx.fill();
        ctx.globalAlpha = nodeAlpha;
      }

      // Borda indicativa
      if (isSelected || matchesSearch) {
        ctx.strokeStyle = HIGHLIGHT_COLOR;
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();
      }

      // Lógica profissional para exibição de texto
      // No Obsidian, labels aparecem ao dar zoom ou em nós muito importantes
      const isImportantNode = n.degree >= 4;
      const labelable = !dimmed && showL && (
        isHovered || isSelected || isNeighbor || matchesSearch ||
        z > 1.8 || (z > 0.8 && isImportantNode) || (z > 0.4 && n.degree >= 10)
      );

      if (labelable) {
        const fontSize = Math.max(10, 11 / z);
        ctx.font = `${isSelected || isHovered ? "500" : "400"} ${fontSize}px Inter, sans-serif`;
        ctx.textAlign = "center";

        // Fundo sutil e arredondado para o texto facilitar a leitura nas linhas
        const text = n.label.length > 25 ? n.label.slice(0, 24) + "…" : n.label;
        const textY = n.y + drawRadius + fontSize + 3;
        const textWidth = ctx.measureText(text).width;
        const padX = 5, padY = 2;
        const chipX = n.x - textWidth / 2 - padX;
        const chipY = textY - fontSize - padY + 1;
        const chipW = textWidth + padX * 2;
        const chipH = fontSize + padY * 2;

        ctx.fillStyle = "hsla(0,0%,4%,0.65)";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(chipX, chipY, chipW, chipH, 6);
        } else {
          ctx.rect(chipX, chipY, chipW, chipH);
        }
        ctx.fill();

        ctx.fillStyle = isSelected || isHovered || matchesSearch
          ? "hsl(0,0%,100%)"
          : "hsla(0,0%,100%,0.75)";
        ctx.fillText(text, n.x, textY);
      }
      ctx.restore();
    }
  }, [isNodeVisible, theme]);

  const tick = useCallback(() => {
    simulate();
    draw();
    animFrameRef.current = requestAnimationFrame(tick);
  }, [simulate, draw]);

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    dprRef.current = dpr;
    sizeRef.current = { w, h };
    alphaRef.current = Math.max(alphaRef.current, 0.5);
  }, [isMobile]);

  // ── Load graph ──────────────────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const cached = await queryClient.fetchQuery({
        queryKey: qk.graph(),
        queryFn: async () => {
          const [graphRes, entitiesRes] = await Promise.all([graphApi.data(), entitiesApi.list()]);
          return { graph: graphRes.data, entities: Array.isArray(entitiesRes.data) ? entitiesRes.data : [] };
        },
        staleTime: STALE.list,
      });
      const data = cached.graph;
      const entities = cached.entities as Entity[];
      setAllEntities(entities);

      const rawNodes = Array.isArray(data?.nodes) ? data.nodes : [];
      const rawEdges = Array.isArray(data?.links) ? data.links : (Array.isArray((data as any)?.edges) ? (data as any).edges : []);

      if (rawNodes.length === 0) {
        setEmpty(true);
        setGraphStats({ nodes: 0, edges: 0 });
        return;
      }

      const degree = new Map<string, number>();
      const adj = new Map<string, Set<string>>();
      for (const e of rawEdges as GraphEdge[]) {
        degree.set(e.source, (degree.get(e.source) || 0) + 1);
        degree.set(e.target, (degree.get(e.target) || 0) + 1);
        if (!adj.has(e.source)) adj.set(e.source, new Set());
        if (!adj.has(e.target)) adj.set(e.target, new Set());
        adj.get(e.source)!.add(e.target);
        adj.get(e.target)!.add(e.source);
      }
      adjRef.current = adj;

      // Mantemos todas as arestas se possível, Obsidian suporta muitas.
      // Mas para performance purista, capamos apenas hubs extremamentes densos (ex: > 30)
      const MAX_EDGES_PER_NODE = 25;
      const keptCount = new Map<string, number>();
      const sortedEdges = [...(rawEdges as GraphEdge[])].sort((a, b) => {
        const da = (degree.get(a.source) || 0) + (degree.get(a.target) || 0);
        const db = (degree.get(b.source) || 0) + (degree.get(b.target) || 0);
        return db - da;
      });
      const prunedEdges: GraphEdge[] = [];
      for (const e of sortedEdges) {
        const s = keptCount.get(e.source) || 0;
        const t = keptCount.get(e.target) || 0;
        if (s >= MAX_EDGES_PER_NODE || t >= MAX_EDGES_PER_NODE) continue;
        keptCount.set(e.source, s + 1);
        keptCount.set(e.target, t + 1);
        prunedEdges.push(e);
      }

      const entityMap = new Map(entities.map(e => [e.id, e]));
      const recentLimit = Date.now() - 7 * 86400000;

      const monthOf = (iso?: string) => {
        if (!iso) return "unknown";
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "unknown";
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      };
      const allMonths = Array.from(new Set(rawNodes.map((n: any) => {
        const ent = entityMap.get(n.id);
        return monthOf(ent?.createdAt);
      }))).sort() as string[];
      const monthIndex = new Map<string, number>();
      allMonths.forEach((m: string, i: number) => monthIndex.set(m, i));
      const monthCount = Math.max(1, allMonths.length);
      const spacingX = 400;

      const nextNodes: GraphNode[] = rawNodes.map((n: any) => {
        const ent = entityMap.get(n.id);
        const createdAt = ent?.createdAt;
        const periodKey = monthOf(createdAt);
        const idx = monthIndex.get(periodKey) ?? 0;
        const periodX = (idx - (monthCount - 1) / 2) * spacingX;
        const periodY = 0;
        const deg = degree.get(n.id) || 0;

        return {
          id: n.id,
          label: n.label,
          type: String(n.type),
          // Dispersão inicial mais restrita para evitar explosões na abertura
          x: (Math.random() - 0.5) * 220,
          y: (Math.random() - 0.5) * 220,
          vx: 0,
          vy: 0,
          degree: deg,
          mass: 1 + deg * 0.5, // Hubs têm massa maior
          createdAt,
          periodKey,
          periodX,
          periodY,
          recent: createdAt ? new Date(createdAt).getTime() > recentLimit : false,
        };
      });

      nodesRef.current = nextNodes;
      edgesRef.current = prunedEdges;
      setGraphStats({ nodes: nextNodes.length, edges: prunedEdges.length });
      alphaRef.current = 0.6; // Simulação inicial menos agressiva

      requestAnimationFrame(() => {
        resizeCanvas();
        const { w, h } = sizeRef.current;
        panRef.current = { x: w / 2, y: h / 2 };
        zoomRef.current = 1;
      });
      setEmpty(false);
    } catch {
      setEmpty(true);
      setGraphStats({ nodes: 0, edges: 0 });
    } finally {
      setLoading(false);
    }
  }, [resizeCanvas]);

  useEffect(() => { void loadGraph(); }, [loadGraph]);

  useEffect(() => {
    if (loading || empty || show3D) return;
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [loading, empty, tick, show3D]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(container);
    resizeCanvas();
    return () => observer.disconnect();
  }, [resizeCanvas]);

  // ── Interação ───────────────────────────────────────────────────────
  const focusNode = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    const entity = allEntities.find(e => e.id === node.id);

    // Use the same entity data as the entity detail page; graph-only metadata
    // is kept separate so the inspector can refresh the canonical entity.
    if (entity) {
      openInspector({
        ...entity,
      } as any);
    } else {
      // Nodes can briefly exist before the entity list finishes resolving.
      openInspector({
        id: node.id,
        title: node.label,
        type: (node.type as EntityType) || "TOPIC",
        createdAt: node.createdAt || "",
        ownerId: "",
        description: "",
      } as any);
    }

    // Aguarda o render do DOM e depois centraliza o node
    requestAnimationFrame(() => {
      const { w, h } = sizeRef.current;
      if (w > 0 && h > 0) {
        const z = zoomRef.current;
        panRef.current = { x: w / 2 - node.x * z, y: h / 2 - node.y * z };
      }
    });
  }, [allEntities, openInspector]);

  // keep ref in sync so the delayed open uses the latest focusNode
  useEffect(() => { focusNodeRef.current = focusNode; }, [focusNode]);

  // clear any pending open timeout on unmount
  useEffect(() => () => cancelPendingOpen(), [cancelPendingOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    if (node) {
      draggingRef.current = node;
      alphaRef.current = Math.max(alphaRef.current, 0.5); // Acorda a simulação ao tocar
      pressOriginRef.current = { x: e.clientX, y: e.clientY };
      schedulePanelOpen(node);
    } else {
      cancelPendingOpen();
      panningRef.current = true;
      setSelectedNode(null);
      closeInspector();
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (draggingRef.current) {
      // Cancel pending panel open if user starts actually dragging
      if (pressOriginRef.current) {
        const ddx = e.clientX - pressOriginRef.current.x;
        const ddy = e.clientY - pressOriginRef.current.y;
        if (ddx * ddx + ddy * ddy > 36) cancelPendingOpen();
      }
      const w = screenToWorld(sx, sy);
      draggingRef.current.x = w.x;
      draggingRef.current.y = w.y;
      draggingRef.current.vx = 0;
      draggingRef.current.vy = 0;
      alphaRef.current = Math.max(alphaRef.current, 0.4);
    } else if (panningRef.current) {
      panRef.current.x += e.clientX - lastMouseRef.current.x;
      panRef.current.y += e.clientY - lastMouseRef.current.y;
    } else {
      const node = findNodeAt(sx, sy);
      setHoveredNode(node);
      setTooltipPos(node ? { x: sx, y: sy } : null);
      if (canvasRef.current) canvasRef.current.style.cursor = node ? "pointer" : "grab";
    }
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => { draggingRef.current = null; panningRef.current = false; };

  const handleWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const oldZ = zoomRef.current;
    // Permite zoomar mais de perto como no Obsidian (0.1 -> 8)
    const newZ = Math.max(0.1, Math.min(8, oldZ * (e.deltaY < 0 ? 1.15 : 0.85)));
    panRef.current.x = sx - (sx - panRef.current.x) * (newZ / oldZ);
    panRef.current.y = sy - (sy - panRef.current.y) * (newZ / oldZ);
    zoomRef.current = newZ;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    if (!node) return;
    if (node.type === "NOTE") navigate(`/notes/${node.id}`);
    else navigate(`/entities/${node.id}`);
  };

  const handleZoom = (dir: number) => {
    if (show3D) {
      brainGraphRef.current?.zoom(dir);
      return;
    }
    const { w, h } = sizeRef.current;
    const cx = w / 2, cy = h / 2;
    const oldZ = zoomRef.current;
    const newZ = Math.max(0.1, Math.min(8, oldZ * (dir > 0 ? 1.4 : 0.7)));
    panRef.current.x = cx - (cx - panRef.current.x) * (newZ / oldZ);
    panRef.current.y = cy - (cy - panRef.current.y) * (newZ / oldZ);
    zoomRef.current = newZ;
  };

  const handleReset = () => {
    const { w, h } = sizeRef.current;
    panRef.current = { x: w / 2, y: h / 2 };
    zoomRef.current = 1;
    setTypeFilters(new Set());
    setSearch("");
    setTimeFilter("all");
    setSelectedNode(null);
    closeInspector();
    alphaRef.current = 0.8; // Reorganiza
    brainGraphRef.current?.reset();
  };

  const handleShowAll = () => {
    setTypeFilters(new Set());
    setSearch("");
    setTimeFilter("all");
    setSelectedNode(null);
    closeInspector();
    alphaRef.current = 0.8;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      pinchRef.current = {
        dist: Math.sqrt(dx * dx + dy * dy),
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
      };
      draggingRef.current = null;
      panningRef.current = false;
      return;
    }
    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = touch.clientX - rect.left, sy = touch.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    const now = Date.now();
    if (node && now - tappedAtRef.current < 300) {
      if (node.type === "NOTE") navigate(`/notes/${node.id}`);
      else navigate(`/entities/${node.id}`);
      tappedAtRef.current = 0;
      return;
    }
    tappedAtRef.current = now;
    if (node) {
      draggingRef.current = node;
      alphaRef.current = Math.max(alphaRef.current, 0.5);
      pressOriginRef.current = { x: touch.clientX, y: touch.clientY };
      schedulePanelOpen(node);
    }
    else {
      cancelPendingOpen();
      panningRef.current = true; setSelectedNode(null); closeInspector();
    }
    lastMouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
      const cy = (t1.clientY + t2.clientY) / 2 - rect.top;
      const oldZ = zoomRef.current;
      const ratio = dist / pinchRef.current.dist;
      const newZ = Math.max(0.1, Math.min(8, oldZ * ratio));
      panRef.current.x = cx - (cx - panRef.current.x) * (newZ / oldZ);
      panRef.current.y = cy - (cy - panRef.current.y) * (newZ / oldZ);
      zoomRef.current = newZ;
      pinchRef.current.dist = dist;
      return;
    }
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = touch.clientX - rect.left, sy = touch.clientY - rect.top;
    if (draggingRef.current) {
      if (pressOriginRef.current) {
        const ddx = touch.clientX - pressOriginRef.current.x;
        const ddy = touch.clientY - pressOriginRef.current.y;
        if (ddx * ddx + ddy * ddy > 36) cancelPendingOpen();
      }
      const w = screenToWorld(sx, sy);
      draggingRef.current.x = w.x; draggingRef.current.y = w.y;
      draggingRef.current.vx = 0; draggingRef.current.vy = 0;
      alphaRef.current = Math.max(alphaRef.current, 0.4);
    } else if (panningRef.current) {
      panRef.current.x += touch.clientX - lastMouseRef.current.x;
      panRef.current.y += touch.clientY - lastMouseRef.current.y;
    }
    lastMouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) {
      draggingRef.current = null;
      panningRef.current = false;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prevent = (e: TouchEvent) => { if (e.touches.length >= 1) e.preventDefault(); };
    const wheel = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener("touchmove", prevent, { passive: false });
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("touchmove", prevent);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  const availableTypes = useMemo(() => {
    const nodes = nodesRef.current;
    const types = new Set(nodes.map(n => n.type));
    return Array.from(types).map(t => ({
      type: t,
      label: typeLabel(t),
      color: TYPE_COLORS[t] || "hsl(0,0%,40%)",
    }));
  }, [graphStats]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = () => setOptionsOpen(open => !open);
    window.addEventListener("graph-options-toggle", listener);
    return () => window.removeEventListener("graph-options-toggle", listener);
  }, []);

  const toggleTypeFilter = (type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const chipActiveClass = (active: boolean) =>
    active ? "bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary" : "";

  return (
    <AppLayout>
      <div className="flex h-dvh flex-col overflow-hidden">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!empty && (
            <div className="absolute right-4 top-4 z-30 flex flex-col items-center gap-1 rounded-2xl border border-border/10 bg-card/70 p-1.5 backdrop-blur-md">
              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => navigate(-1)}
                className="border-0 bg-transparent hover:bg-muted"
                aria-label={t("gr_back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div className="my-0.5 h-px w-6 bg-border/10" />

              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => handleZoom(1)}
                className="border-0 bg-transparent hover:bg-muted"
                aria-label={t("gr_zoom_in")}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => handleZoom(-1)}
                className="border-0 bg-transparent hover:bg-muted"
                aria-label={t("gr_zoom_out")}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => setFocusMode(f => !f)}
                className={`border-0 bg-transparent hover:bg-muted ${focusMode ? "bg-muted text-foreground" : ""}`}
                aria-label={t("gr_toggle_focus")}
                title={t("gr_focus_mode")}
              >
                {focusMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => setShow3D(value => !value)}
                className="h-9 w-9 border-0 bg-transparent text-xs font-semibold hover:bg-muted"
                aria-label={show3D ? t("gr_view_2d") : t("gr_view_3d")}
                title={show3D ? t("gr_view_2d") : t("gr_view_3d")}
              >
                {show3D ? "3D" : "2D"}
              </Button>
              {show3D && (
                <span className="-mt-1 rounded-full border border-border/20 px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground">
                  (beta)
                </span>
              )}

              <div className="my-0.5 h-px w-6 bg-border/10" />

              <Button
                type="button"
                variant="canvasIcon"
                size="icon"
                onClick={() => setOptionsOpen(true)}
                className="border-0 bg-transparent hover:bg-muted"
                aria-label={t("gr_open_options")}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          )}

          {optionsOpen && (
            <div
              className="fixed inset-0 z-50 flex justify-end bg-background/70 animate-in fade-in duration-200"
              onClick={() => setOptionsOpen(false)}
            >
              <Card
                onClick={(e) => e.stopPropagation()}
                className="flex h-full w-full flex-col overflow-y-auto rounded-none border-0 border-l border-border/10 bg-background/95 p-5 shadow-2xl shadow-black/40 animate-in slide-in-from-right duration-200 sm:w-96 sm:rounded-l-3xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{t("gr_options_title")}</p>
                    <p className="text-xs text-muted-foreground">{t("gr_options_subtitle")}</p>
                  </div>
                  <Button
                    type="button"
                    variant="canvasIcon"
                    size="icon"
                    onClick={() => setOptionsOpen(false)}
                    className="h-9 w-9 border-0 bg-muted/60 hover:bg-muted"
                    aria-label={t("gr_close_options")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-4 flex-1 space-y-4">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{t("gr_search_nodes_label")}</label>
                    <div className="mt-2 relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("gr_search_nodes_placeholder")}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <Card variant="subtle" className="rounded-3xl border-border/10 bg-card p-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t("gr_type_filters")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge
                        variant="chip"
                        onClick={() => setTypeFilters(new Set())}
                        className={chipActiveClass(typeFilters.size === 0)}
                      >
                        {t("gr_filter_all")}
                      </Badge>
                      {availableTypes.map(({ type, label, color }) => {
                        const active = typeFilters.has(type);
                        return (
                          <Badge
                            key={type}
                            variant="chip"
                            onClick={() => toggleTypeFilter(type)}
                            className={`gap-2 ${chipActiveClass(active)}`}
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                            {label}
                          </Badge>
                        );
                      })}
                    </div>
                  </Card>
                  <Card variant="subtle" className="rounded-3xl border-border/10 bg-card p-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t("gr_time_range")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["all", "7d", "30d"] as const).map(tf => (
                        <Badge
                          key={tf}
                          variant="chip"
                          onClick={() => setTimeFilter(tf)}
                          className={chipActiveClass(timeFilter === tf)}
                        >
                          {tf === "all" ? t("gr_time_anytime") : tf === "7d" ? t("gr_time_7d") : t("gr_time_30d")}
                        </Badge>
                      ))}
                    </div>
                  </Card>

                  <Card variant="subtle" className="rounded-3xl border-border/10 bg-card p-1">
                    <p className="px-2 pt-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t("gr_display_options")}</p>
                    <div className="mt-1 divide-y divide-border/10 px-1 pb-1">
                      <OptionSwitch
                        id="opt-edges"
                        checked={showEdges}
                        onChange={() => setShowEdges(v => !v)}
                        label={showEdges ? t("gr_edges_on") : t("gr_edges_off")}
                      />
                      <OptionSwitch
                        id="opt-labels"
                        checked={showLabels}
                        onChange={() => setShowLabels(v => !v)}
                        label={showLabels ? t("gr_labels_on") : t("gr_labels_off")}
                      />
                      <OptionSwitch
                        id="opt-legend"
                        checked={legendOpen}
                        onChange={() => setLegendOpen(v => !v)}
                        label={legendOpen ? t("gr_legend_on") : t("gr_legend_off")}
                      />
                      <OptionSwitch
                        id="opt-cluster"
                        checked={clusterByPeriod}
                        onChange={() => setClusterByPeriod(v => !v)}
                        label={clusterByPeriod ? t("gr_period_clusters_on") : t("gr_period_clusters_off")}
                      />
                      <OptionSwitch
                        id="opt-focus"
                        checked={focusMode}
                        onChange={() => setFocusMode(v => !v)}
                        label={focusMode ? t("gr_focus_on") : t("gr_focus_off")}
                      />
                      {focusMode && (
                        <div className="flex gap-2">
                          {([1, 2] as const).map(d => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setFocusDepth(d)}
                              className={`rounded-full px-3 py-1 text-xs transition-colors ${focusDepth === d ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                            >
                              {d}º
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="mt-4 grid gap-2 border-t border-border/10 pt-4 sm:grid-cols-2">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { handleShowAll(); setOptionsOpen(false); }}>
                    {t("gr_show_all")}
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={handleReset}>
                    {t("gr_reset_view")}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          <div ref={containerRef} className="flex-1 relative overflow-hidden min-h-0 touch-none">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">{t("gr_loading")}</p>
                </div>
              </div>
            )}

            {empty && !loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center space-y-4 max-w-xs px-6">
                  <div className="space-y-2">
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      {t("gr_empty_title")}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t("gr_empty_desc")}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/notes")}>{t("gr_empty_cta")}</Button>
                </div>
              </div>
            )}

            {!empty && (
              <canvas
                ref={canvasRef}
                className="select-none"
                style={{ display: show3D ? "none" : "block", touchAction: "none", backgroundColor: "var(--bg-base)" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              />
            )}
            {!empty && show3D && (
              <div className="absolute inset-0">
                <BrainGraph3D
                  ref={brainGraphRef}
                  nodes={brainNodes}
                  links={brainLinks}
                  selectedId={selectedNode?.id ?? null}
                  highlightedIds={highlightedBrainNodes}
                  showEdges={showEdges}
                  showLabels={showLabels}
                  inside={false}
                  theme={theme}
                  unavailableText={t("gr_3d_unavailable")}
                  onSelect={node => {
                    const graphNode = nodesRef.current.find(item => item.id === node.id);
                    if (graphNode) focusNode(graphNode);
                  }}
                  onOpen={node => navigate(node.type === "NOTE" ? `/notes/${node.id}` : `/entities/${node.id}`)}
                  onClear={() => {
                    setSelectedNode(null);
                    closeInspector();
                  }}
                />
              </div>
            )}

            {legendOpen && (
              <Card className="absolute left-4 top-4 z-20 rounded-3xl border border-border/10 bg-card/85 p-4 text-sm text-foreground backdrop-blur-md shadow-lg shadow-black/30">
                <p className="mb-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">{t("gr_legend")}</p>
                <div className="grid gap-2">
                  {availableTypes.map(({ label, color, type }) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm text-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {hoveredNode && tooltipPos && !selectedNode && !show3D && (
              <Card
                className="absolute z-20 pointer-events-none rounded-md border border-border/10 bg-card/95 px-2.5 py-1.5 shadow-lg"
                style={{
                  left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth || 300) - 180),
                  top: Math.max(8, tooltipPos.y - 40),
                }}
              >
                <p className="text-xs font-medium text-foreground truncate max-w-[160px]">{hoveredNode.label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {typeLabel(hoveredNode.type)} · {t("gr_link_count", { count: hoveredNode.degree, plural: hoveredNode.degree === 1 ? "" : "s" })}
                </p>
              </Card>
            )}
          </div>
          <SideInspector
            isOpen={inspectorOpen}
            entity={inspectorEntity}
            mobileBottomSheet
            onClose={() => { closeInspector(); setSelectedNode(null); }}
          />
        </div>
      </div>
    </AppLayout>
  );
}
