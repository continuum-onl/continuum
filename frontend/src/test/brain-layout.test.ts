import { describe, expect, it } from 'vitest';
import { createBrainScaffold, layoutBrainNodes, normalizeBrainLinks } from '@/lib/brain-layout';

describe('brain network layout', () => {
  it('has volume, two hemispheres and a descending stem', () => {
    const { points, links } = createBrainScaffold();
    expect(points.every(p => p.every(Number.isFinite))).toBe(true);
    expect(Math.min(...points.map(p => p[0]))).toBeLessThan(-2.5);
    expect(Math.max(...points.map(p => p[0]))).toBeGreaterThan(2.5);
    expect(Math.min(...points.map(p => p[1]))).toBeLessThan(-3);
    expect(Math.max(...points.map(p => p[2])) - Math.min(...points.map(p => p[2]))).toBeGreaterThan(5);
    expect(links.length).toBeGreaterThan(600);
  });
  it('keeps node placement stable when data order changes', () => {
    const nodes = [{ id: 'a', label: 'A', type: 'NOTE' }, { id: 'b', label: 'B', type: 'TOPIC' }];
    expect(layoutBrainNodes(nodes)).toEqual(layoutBrainNodes([...nodes].reverse()));
  });
  it('never creates user connections or retains missing endpoints', () => {
    const nodes = [{ id: 'a', label: 'A', type: 'NOTE' }, { id: 'b', label: 'B', type: 'TOPIC' }];
    expect(normalizeBrainLinks(nodes, [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'a', target: 'missing' }])).toEqual([{ source: 'a', target: 'b' }]);
  });
});