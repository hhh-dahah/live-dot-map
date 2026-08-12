/* 画布的轻量几何索引：不改变地图数据，只减少悬停/裁剪时的全表扫描。 */

function edgeKey(edge) {
  return `${String(edge?.from ?? '')}\u0000${String(edge?.to ?? '')}`;
}

export class ParallelIndex {
  constructor(edges = []) {
    this.groups = new Map();
    this.positions = new Map();
    this.rebuild(edges);
  }

  rebuild(edges = []) {
    this.groups.clear();
    this.positions.clear();
    for (const edge of edges) {
      if (!edge || edge.to === null || edge.to === undefined) continue;
      const key = edgeKey(edge);
      const group = this.groups.get(key) ?? [];
      group.push(edge);
      this.groups.set(key, group);
    }
    for (const group of this.groups.values()) {
      const sorted = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      sorted.forEach((edge, index) => this.positions.set(edge.id, { index, count: sorted.length }));
    }
    return this;
  }

  groupFor(edge) {
    return this.groups.get(edgeKey(edge)) ?? [];
  }

  offsetFor(edge, spacing = 46) {
    const position = this.positions.get(edge?.id);
    if (!position || position.count < 2) return 0;
    return (position.index - (position.count - 1) / 2) * spacing;
  }
}

function asPoint(node) {
  if (!node || !Number.isFinite(Number(node.x)) || !Number.isFinite(Number(node.y))) return null;
  return { x: Number(node.x), y: Number(node.y) };
}

function edgePoints(edge, nodesById, parallel, samples = 12) {
  const from = asPoint(nodesById?.get?.(edge.from) ?? nodesById?.[edge.from]);
  if (!from) return [];
  const to = edge.to === null || edge.to === undefined
    ? { x: from.x + Number(edge.dx ?? 160), y: from.y + Number(edge.dy ?? 0) }
    : asPoint(nodesById?.get?.(edge.to) ?? nodesById?.[edge.to]);
  if (!to) return [from];
  const count = Math.max(2, Math.min(64, Math.floor(samples)));
  const offset = parallel?.offsetFor(edge) ?? 0;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / distance * offset, y: dx / distance * offset };
  const control = {
    x: (from.x + to.x) / 2 + normal.x + Number(edge.cx ?? 0),
    y: (from.y + to.y) / 2 + normal.y + Number(edge.cy ?? 0),
  };
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
    });
  }
  return points;
}

function cellKey(x, y) { return `${x}:${y}`; }

function rangeFor(min, max, cellSize) {
  const first = Math.floor(min / cellSize);
  const last = Math.floor(max / cellSize);
  const output = [];
  for (let value = first; value <= last; value += 1) output.push(value);
  return output;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export class EdgeSpatialIndex {
  constructor(edges = [], nodesById = new Map(), options = {}) {
    this.cellSize = Math.max(16, Number(options.cellSize) || 160);
    this.samples = Math.max(2, Number(options.samples) || 12);
    this.cells = new Map();
    this.geometry = new Map();
    this.edges = new Map();
    this.parallel = options.parallelIndex ?? new ParallelIndex(edges);
    this.rebuild(edges, nodesById);
  }

  rebuild(edges = [], nodesById = new Map()) {
    this.cells.clear();
    this.geometry.clear();
    this.edges.clear();
    if (!(this.parallel instanceof ParallelIndex)) this.parallel = new ParallelIndex(edges);
    else this.parallel.rebuild(edges);
    for (const edge of edges) {
      if (!edge || edge.id === undefined) continue;
      const points = edgePoints(edge, nodesById, this.parallel, this.samples);
      if (points.length === 0) continue;
      this.edges.set(String(edge.id), edge);
      this.geometry.set(String(edge.id), points);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      for (const x of rangeFor(Math.min(...xs), Math.max(...xs), this.cellSize)) {
        for (const y of rangeFor(Math.min(...ys), Math.max(...ys), this.cellSize)) {
          const key = cellKey(x, y);
          const bucket = this.cells.get(key) ?? new Set();
          bucket.add(String(edge.id));
          this.cells.set(key, bucket);
        }
      }
    }
    return this;
  }

  queryRect(rect, options = {}) {
    const minX = Math.min(Number(rect?.x ?? 0), Number(rect?.x ?? 0) + Number(rect?.width ?? 0));
    const maxX = Math.max(Number(rect?.x ?? 0), Number(rect?.x ?? 0) + Number(rect?.width ?? 0));
    const minY = Math.min(Number(rect?.y ?? 0), Number(rect?.y ?? 0) + Number(rect?.height ?? 0));
    const maxY = Math.max(Number(rect?.y ?? 0), Number(rect?.y ?? 0) + Number(rect?.height ?? 0));
    const ids = new Set();
    for (const x of rangeFor(minX, maxX, this.cellSize)) {
      for (const y of rangeFor(minY, maxY, this.cellSize)) {
        for (const id of this.cells.get(cellKey(x, y)) ?? []) ids.add(id);
      }
    }
    const output = [];
    for (const id of ids) {
      const points = this.geometry.get(id) ?? [];
      if (points.some((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)) output.push(this.edges.get(id));
    }
    return output.filter(Boolean);
  }

  queryPoint(point, radius = 18) {
    const x = Number(point?.x ?? 0);
    const y = Number(point?.y ?? 0);
    const candidates = this.queryRect({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
    return candidates
      .map((edge) => {
        const points = this.geometry.get(String(edge.id)) ?? [];
        let distance = Infinity;
        for (let index = 1; index < points.length; index += 1) distance = Math.min(distance, distanceToSegment({ x, y }, points[index - 1], points[index]));
        return { edge, distance };
      })
      .filter((entry) => entry.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.edge);
  }
}

export function buildEdgeIndex(edges, nodes, options = {}) {
  const nodesById = nodes instanceof Map ? nodes : new Map((nodes ?? []).map((node) => [node.id, node]));
  return new EdgeSpatialIndex(edges ?? [], nodesById, options);
}

export function visibleWorldBounds(viewport, view = {}, padding = 240) {
  const width = Number(viewport?.width ?? viewport?.clientWidth ?? 0);
  const height = Number(viewport?.height ?? viewport?.clientHeight ?? 0);
  const k = Math.max(0.001, Number(view.k ?? 1));
  const x = Number(view.x ?? 0);
  const y = Number(view.y ?? 0);
  const pad = Number(padding) / k;
  return {
    x: (-x) / k - pad,
    y: (-y) / k - pad,
    width: width / k + pad * 2,
    height: height / k + pad * 2,
  };
}

export function cullPoints(points, bounds, padding = 0) {
  if (!Array.isArray(points)) return [];
  const left = Number(bounds?.x ?? 0) - padding;
  const top = Number(bounds?.y ?? 0) - padding;
  const right = left + Number(bounds?.width ?? 0) + padding * 2;
  const bottom = top + Number(bounds?.height ?? 0) + padding * 2;
  return points.filter((point) => point && point.x >= left && point.x <= right && point.y >= top && point.y <= bottom);
}
