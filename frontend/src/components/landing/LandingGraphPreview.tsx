import { useMemo, useState } from "react";
import { BrainGraph3D } from "@/components/graph/BrainGraph3D";
import type { BrainLink, BrainNode } from "@/lib/brain-layout";

const MOCK_NODE_COUNT = 34;

function createMockGraph() {
  const nodes: BrainNode[] = Array.from({ length: MOCK_NODE_COUNT }, (_, index) => ({
    id: `preview-node-${index}`,
    label: "",
    type: index % 3 === 0 ? "NOTE" : "TOPIC",
  }));
  const links: BrainLink[] = nodes.flatMap((node, index) => [
    { source: node.id, target: nodes[(index + 1) % nodes.length].id },
    { source: node.id, target: nodes[(index + 5) % nodes.length].id },
  ]);
  return { nodes, links };
}

export default function LandingGraphPreview() {
  const { nodes, links } = useMemo(createMockGraph, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#090d0e]">
      <BrainGraph3D
        nodes={nodes}
        links={links}
        selectedId={selectedId}
        highlightedIds={null}
        showEdges
        showLabels={false}
        inside={false}
        theme="landing-preview"
        unavailableText="Interactive graph preview is unavailable."
        scaffoldCount={420}
        backgroundColor="#090d0e"
        onSelect={(node) => setSelectedId((current) => current === node.id ? null : node.id)}
        onOpen={() => undefined}
        onClear={() => setSelectedId(null)}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_28%,rgba(0,0,0,0.65)_100%)]"
      />
    </div>
  );
}
