type DiagramNode = {
  id: string;
  label: string;
  file?: string;
  kind?: 'added' | 'modified' | 'deleted' | 'renamed';
};
type DiagramEdge = { from: string; to: string; label?: string };
type DiagramGraph = { nodes: DiagramNode[]; edges: DiagramEdge[] };
export type WalkthroughDiagram =
  | ({ type: 'flow'; title: string } & DiagramGraph)
  | { type: 'comparison'; title: string; before: DiagramGraph; after: DiagramGraph };
type DiagramLabels = Record<
  'before' | 'after' | 'added' | 'modified' | 'deleted' | 'renamed' | 'diagramHint',
  string
>;

const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('walkthrough diagram must be an object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('walkthrough diagram fields must be non-empty text');
  return value;
}
function ranks(graph: DiagramGraph): number[] {
  const result: number[] = [];
  for (const node of graph.nodes)
    result.push(
      Math.max(
        0,
        ...graph.edges
          .filter((edge) => edge.to === node.id)
          .map((edge) => result[graph.nodes.findIndex((node) => node.id === edge.from)]! + 1),
      ),
    );
  return result;
}
function graph(value: unknown, files: ReadonlySet<string>): DiagramGraph {
  const data = object(value);
  if (
    !Array.isArray(data.nodes) ||
    data.nodes.length < 2 ||
    data.nodes.length > 6 ||
    !Array.isArray(data.edges) ||
    !data.edges.length ||
    data.edges.length > 8
  ) {
    throw new Error(
      'walkthrough short diagrams need 2–6 nodes and 1–8 edges; split larger diagrams',
    );
  }
  const nodes = data.nodes.map((value) => {
    const node = object(value);
    const file = node.file === undefined ? undefined : text(node.file);
    if (file && !files.has(file))
      throw new Error(`walkthrough diagram file is not in changes.files: ${file}`);
    if (
      node.kind !== undefined &&
      !['added', 'modified', 'deleted', 'renamed'].includes(String(node.kind))
    )
      throw new Error('Invalid walkthrough diagram node kind');
    return {
      id: text(node.id),
      label: text(node.label),
      ...(file ? { file } : {}),
      ...(node.kind === undefined ? {} : { kind: node.kind as DiagramNode['kind'] }),
    };
  });
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new Error('walkthrough diagram node IDs must be unique');
  const edges = data.edges.map((value) => {
    const edge = object(value);
    const from = text(edge.from),
      to = text(edge.to);
    const source = nodes.findIndex((node) => node.id === from),
      target = nodes.findIndex((node) => node.id === to);
    if (source < 0 || target <= source)
      throw new Error('walkthrough diagram edges must connect existing nodes in forward order');
    return { from, to, ...(edge.label === undefined ? {} : { label: text(edge.label) }) };
  });
  if (new Set(edges.map((edge) => JSON.stringify([edge.from, edge.to]))).size !== edges.length)
    throw new Error('walkthrough diagram edges must be unique');
  const result = { nodes, edges };
  const levels = ranks(result);
  if (levels.some((level) => levels.filter((value) => value === level).length > 2))
    throw new Error(
      'walkthrough short diagrams support at most two nodes per level; split the diagram',
    );
  return result;
}

export function normalizeWalkthroughDiagrams(
  value: unknown,
  files: ReadonlySet<string>,
): WalkthroughDiagram[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('walkthrough diagrams must be an array');
  return value.map((value) => {
    const diagram = object(value),
      title = text(diagram.title);
    if (diagram.type === 'flow') return { type: 'flow', title, ...graph(diagram, files) };
    if (diagram.type === 'comparison')
      return {
        type: 'comparison',
        title,
        before: graph(diagram.before, files),
        after: graph(diagram.after, files),
      };
    throw new Error('walkthrough diagram type must be flow or comparison');
  });
}

function width(value: string): number {
  return Array.from(value).reduce((sum, c) => sum + (c.codePointAt(0)! > 255 ? 13 : 7), 0);
}
function lines(value: string, maxWidth: number): string[] {
  const result: string[] = [];
  let line = '';
  for (const c of value) {
    if (c === '\n' || (line && width(line + c) > maxWidth)) {
      const space = c === '\n' ? -1 : line.lastIndexOf(' ');
      result.push(space > 0 ? line.slice(0, space) : line);
      line = space > 0 ? line.slice(space + 1) : '';
    }
    if (c !== '\n') line += c;
  }
  if (line) result.push(line);
  return result;
}
function svg(
  graph: DiagramGraph,
  title: string,
  id: string,
  compact: boolean,
  files: ReadonlyMap<string, string>,
  labels: DiagramLabels,
): { html: string; width: number } {
  const levels = ranks(graph),
    levelCount = Math.max(...levels) + 1;
  const skipped = graph.edges.filter(
    (edge) =>
      levels[graph.nodes.findIndex((node) => node.id === edge.to)]! -
        levels[graph.nodes.findIndex((node) => node.id === edge.from)]! >
      1,
  );
  const railSpace = skipped.length ? skipped.length * 8 + 12 : 0;
  const nodeWidth = compact ? (272 - 24 - 24 - railSpace) / 2 : 120;
  const nodeLines = graph.nodes.map((node) => lines(node.label, nodeWidth - 24));
  const nodeHeight = Math.max(
    52,
    ...nodeLines.map((value, i) => value.length * 18 + 24 + (graph.nodes[i]!.kind ? 16 : 0)),
  );
  const edgeLines = graph.edges.map((edge) => lines(edge.label ?? '', compact ? 96 : 104));
  const gap = compact
    ? Math.max(36, ...edgeLines.map((value) => value.length * 16 + 20))
    : Math.max(40, ...edgeLines.flatMap((value) => value.map((line) => width(line) + 16)));
  const maxPeers = Math.max(
    ...levels.map((level) => levels.filter((value) => value === level).length),
  );
  const chartWidth = compact ? 272 : 24 + levelCount * nodeWidth + (levelCount - 1) * gap;
  const chartHeight = compact
    ? 24 + levelCount * nodeHeight + (levelCount - 1) * gap
    : 24 + railSpace + maxPeers * nodeHeight + (maxPeers - 1) * 32;
  const points = graph.nodes.map((_, index) => {
    const peers = levels
        .map((level, i) => (level === levels[index] ? i : -1))
        .filter((i) => i >= 0),
      ordinal = peers.indexOf(index);
    return compact
      ? {
          x:
            12 +
            (272 - 24 - railSpace - peers.length * nodeWidth - (peers.length - 1) * 24) / 2 +
            ordinal * (nodeWidth + 24),
          y: 12 + levels[index]! * (nodeHeight + gap),
        }
      : {
          x: 12 + levels[index]! * (nodeWidth + gap),
          y:
            12 +
            railSpace +
            (chartHeight - 24 - railSpace - peers.length * nodeHeight - (peers.length - 1) * 32) /
              2 +
            ordinal * (nodeHeight + 32),
        };
  });
  const textLines = (value: string[], x: number, y: number, className = '') =>
    `<text class="${className}" x="${x}" y="${y}" text-anchor="middle">${value.map((line, i) => `<tspan x="${x}" dy="${i ? 18 : 0}">${escape(line)}</tspan>`).join('')}</text>`;
  const arrows = graph.edges
    .map((edge, index) => {
      const source = points[graph.nodes.findIndex((node) => node.id === edge.from)]!,
        target = points[graph.nodes.findIndex((node) => node.id === edge.to)]!;
      const sx = source.x + (compact ? nodeWidth / 2 : nodeWidth),
        sy = source.y + (compact ? nodeHeight : nodeHeight / 2);
      const tx = target.x + (compact ? nodeWidth / 2 : 0),
        ty = target.y + (compact ? 0 : nodeHeight / 2);
      const skip = skipped.indexOf(edge);
      let d: string,
        lx = (sx + tx) / 2,
        ly = (sy + ty) / 2;
      if (skip >= 0 && compact) {
        const rail = 272 - 8 - skip * 8;
        d = `M ${sx} ${sy} V ${sy + gap / 2} H ${rail} V ${ty - 12} H ${tx} V ${ty - 3}`;
        lx = (sx + rail) / 2;
        ly = sy + gap / 2;
      } else if (skip >= 0) {
        const rail = 8 + skip * 8;
        d = `M ${sx} ${sy} H ${sx + 12} V ${rail} H ${tx - 12} V ${ty} H ${tx - 3}`;
        ly = rail;
      } else
        d = compact
          ? `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2}, ${tx} ${(sy + ty) / 2}, ${tx} ${ty - 3}`
          : `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy}, ${(sx + tx) / 2} ${ty}, ${tx - 3} ${ty}`;
      const caption = edgeLines[index]!;
      const captionWidth = Math.max(0, ...caption.map(width)) + 8,
        captionHeight = caption.length * 18;
      lx = Math.max(captionWidth / 2, Math.min(chartWidth - captionWidth / 2, lx));
      return `<path class="diagram-edge" d="${d}" marker-end="url(#${id}-arrow)"/>${caption.length ? `<rect class="diagram-edge-label" x="${lx - captionWidth / 2}" y="${ly - captionHeight / 2 - 2}" width="${captionWidth}" height="${captionHeight + 4}"/>${textLines(caption, lx, ly - captionHeight / 2 + 13, 'diagram-edge-text')}` : ''}`;
    })
    .join('');
  const nodes = graph.nodes
    .map((node, index) => {
      const point = points[index]!,
        caption = nodeLines[index]!;
      const inside = `<rect x="${point.x}" y="${point.y}" width="${nodeWidth}" height="${nodeHeight}" rx="5"/>${node.kind ? textLines([labels[node.kind]], point.x + nodeWidth / 2, point.y + 17, 'diagram-kind') : ''}${textLines(caption, point.x + nodeWidth / 2, point.y + (node.kind ? 35 : (nodeHeight - caption.length * 18) / 2 + 13))}`;
      const target = node.file ? files.get(node.file) : undefined;
      return target
        ? `<a class="diagram-node ${node.kind ?? ''}" href="#${target}" aria-label="${escape(node.label + ' · ' + node.file)}">${inside}</a>`
        : `<g class="diagram-node ${node.kind ?? ''}">${inside}</g>`;
    })
    .join('');
  const description = graph.edges
    .map(
      (edge) =>
        `${graph.nodes.find((node) => node.id === edge.from)!.label} → ${graph.nodes.find((node) => node.id === edge.to)!.label}${edge.label ? ' (' + edge.label + ')' : ''}`,
    )
    .join('; ');
  return {
    width: chartWidth,
    html: `<svg class="diagram-svg" width="${chartWidth}" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" role="group" aria-labelledby="${id}-title ${id}-description"><title id="${id}-title">${escape(title)}</title><desc id="${id}-description">${escape(description)}</desc><defs><marker id="${id}-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker></defs>${arrows}${nodes}</svg>`,
  };
}

export function renderWalkthroughDiagrams(
  diagrams: readonly WalkthroughDiagram[] | undefined,
  files: ReadonlyMap<string, string>,
  labels: DiagramLabels,
): string {
  return (diagrams ?? [])
    .map((diagram, index) => {
      const id = `walkthrough-diagram-${index}`;
      let body: string;
      if (diagram.type === 'comparison')
        body = `<div class="diagram-comparison"><section><h3>${labels.before}</h3>${svg(diagram.before, diagram.title + ' · ' + labels.before, id + '-before', true, files, labels).html}</section><section><h3>${labels.after}</h3>${svg(diagram.after, diagram.title + ' · ' + labels.after, id + '-after', true, files, labels).html}</section></div>`;
      else {
        const wide = svg(diagram, diagram.title, id + '-wide', false, files, labels);
        const compact = svg(diagram, diagram.title, id + '-compact', true, files, labels);
        body =
          wide.width <= 904
            ? `<div class="diagram-wide">${wide.html}</div><div class="diagram-compact">${compact.html}</div>`
            : compact.html;
      }
      return `<figure class="diagram"><figcaption>${escape(diagram.title)}</figcaption>${body}${(diagram.type === 'flow' ? diagram.nodes : [...diagram.before.nodes, ...diagram.after.nodes]).some((node) => node.file) ? `<p class="diagram-hint">${labels.diagramHint}</p>` : ''}</figure>`;
    })
    .join('');
}
