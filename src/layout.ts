import type { Layer, Layout, Scene } from './model';
import { getAssetGeometry } from './assets';

export type CompositionFormat = Pick<Scene, 'width' | 'height' | 'detail'>;
export const MIN_SCENE_SCALE = .3;
export const MAX_SCENE_SCALE = 12;
export const MAX_LAYER_POSITION = 3;
export const DEFAULT_FORMAT: CompositionFormat = { width: 1200, height: 800, detail: 'L' };
type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Region = { left: number; top: number; right: number; bottom: number };

export function geometry(layer: Layer, scene: CompositionFormat) {
  const asset = getAssetGeometry(layer.key, layer.detail ?? scene.detail, layer.role);
  const width = asset.width * Math.min(scene.width, scene.height) / 2300 * layer.size;
  return { width, height: width * asset.height / asset.width, scale: width / asset.width };
}

/** Axis-aligned envelope of the whole rotated source object, in canvas pixels. */
export function layerBounds(layer: Layer, format: CompositionFormat): Box {
  const g = geometry(layer, format);
  const angle = layer.rotation * Math.PI / 180;
  const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  return {
    x: layer.x * format.width, y: layer.y * format.height,
    width: g.width * c + g.height * s,
    height: g.width * s + g.height * c,
  };
}

// The stand and shadow occupy the lower third of both original lamp variants.
// Its envelope is a placement constraint, not a modification of the source SVG.
function lampBase(layer: Layer, format: CompositionFormat): Box {
  const g = geometry(layer, format), angle = layer.rotation * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle), offset = g.height / 3;
  return {
    x: -s * offset, y: c * offset,
    width: g.width * Math.abs(c) + g.height / 3 * Math.abs(s),
    height: g.width * Math.abs(s) + g.height / 3 * Math.abs(c),
  };
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function target(index: number, layout: Layout, variant: number): Point {
  const slots = layout === 'diagonal'
    ? [[.5,.5],[.73,.27],[.27,.73],[.75,.62],[.35,.24],[.55,.8]]
    : [[.5,.52],[.72,.34],[.3,.69],[.72,.72],[.3,.3],[.52,.24]];
  let [x, y] = slots[index % slots.length];
  if (variant % 2) x = 1 - x;
  if (Math.floor(variant / 2) % 2) y = 1 - y;
  return { x, y };
}

/**
 * Search positions using real rotated source bounds. Geometry, stacking and scale
 * remain intact. Overlap is penalized relative to the smaller object so that a
 * small accent cannot disappear behind a larger object without a high cost.
 */
export function positionLayers(layers: Layer[], layout: Layout, format: CompositionFormat, variant = 0): Layer[] {
  if (!layers.length) return [];
  const pad = Math.min(format.width, format.height) * .04;
  const gap = pad * .4;
  if (layout === 'cropped' && layers.some(l => l.role === 'background')) return positionCropped(layers, format);
  const boxes = layers.map(l => layerBounds(l, format));
  const bases = layers.map(l => l.key === 'lamp' ? lampBase(l, format) : null);
  const region: Region = { left: pad, top: pad, right: format.width - pad, bottom: format.height - pad };
  if (boxes.some(b => b.width > region.right - region.left || b.height > region.bottom - region.top)) {
    throw new Error('Объект не помещается в формат с полями. Нажмите «Подогнать» или уменьшите поворот и повторите раскладку.');
  }
  // Reserve the left third on wide canvases, the upper third on tall canvases.
  // At large manual scales, leave as much title room as the largest object allows.
  if (layout === 'editorial') {
    if (format.width >= format.height) region.left = Math.min(format.width * .3, region.right - Math.max(...boxes.map(b => b.width)));
    else region.top = Math.min(format.height * .3, region.bottom - Math.max(...boxes.map(b => b.height)));
  }
  const spanX = region.right - region.left, spanY = region.bottom - region.top;
  const order = layers.map((_, i) => i).sort((a, b) =>
    Number(layers[a].role === 'background') - Number(layers[b].role === 'background')
    || boxes[b].width * boxes[b].height - boxes[a].width * boxes[a].height || a - b);
  const rank = new Map(order.map((i, r) => [i, r]));
  const targets = boxes.map((b, i) => {
    const preferred = target(rank.get(i)!, layout, variant);
    return {
      x: clamp(region.left + preferred.x * spanX, region.left + b.width / 2, region.right - b.width / 2),
      y: clamp(region.top + preferred.y * spanY, region.top + b.height / 2, region.bottom - b.height / 2),
    };
  });
  function cost(i: number, p: Point, placed: Map<number, Point>) {
    const box = boxes[i];
    let value = .16 * (((p.x - targets[i].x) / spanX) ** 2 + ((p.y - targets[i].y) / spanY) ** 2);
    for (const [j, other] of placed) {
      if (i === j) continue;
      const b = boxes[j];
      const overlapX = Math.max(0, (box.width + b.width) / 2 + gap - Math.abs(p.x - other.x));
      const overlapY = Math.max(0, (box.height + b.height) / 2 + gap - Math.abs(p.y - other.y));
      const ratio = overlapX * overlapY / Math.min(box.width * box.height, b.width * b.height);
      const backgroundPair = layers[i].role === 'background' || layers[j].role === 'background';
      const excess = Math.max(0, ratio - (backgroundPair ? .25 : .1));
      value += (backgroundPair ? 3 : 6) * excess * excess;
      const lampAndPhone = (layers[i].key === 'lamp' && layers[j].key === 'phone')
        || (layers[i].key === 'phone' && layers[j].key === 'lamp');
      if (lampAndPhone) value += 8 * ratio;
      // A foreground lamp must not appear to stand on a foreground book.
      // Ordinary envelope overlap is allowed elsewhere, but not at this support.
      if (!backgroundPair && ((layers[i].key === 'lamp' && layers[j].key === 'book') || (layers[j].key === 'lamp' && layers[i].key === 'book'))) {
        const lamp = bases[i] ?? bases[j]!;
        const lampPoint = bases[i] ? p : other;
        const bookPoint = bases[i] ? other : p;
        const book = bases[i] ? b : box;
        const ox = Math.max(0, (lamp.width + book.width) / 2 + gap - Math.abs(lampPoint.x + lamp.x - bookPoint.x));
        const oy = Math.max(0, (lamp.height + book.height) / 2 + gap - Math.abs(lampPoint.y + lamp.y - bookPoint.y));
        if (ox && oy) value += 100 + 1000 * ox * oy / Math.min(lamp.width * lamp.height, book.width * book.height);
      }
    }
    return value;
  }
  const placed = new Map<number, Point>();
  function place(i: number) {
    const box = boxes[i];
    const left = region.left + box.width / 2, right = region.right - box.width / 2;
    const top = region.top + box.height / 2, bottom = region.bottom - box.height / 2;
    let best = placed.get(i) ?? targets[i], bestCost = cost(i, best, placed);
    const consider = (x: number, y: number) => {
      const p = { x: clamp(x, left, right), y: clamp(y, top, bottom) };
      const score = cost(i, p, placed);
      if (score < bestCost - 1e-12) { best = p; bestCost = score; }
    };
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) {
      consider(left + (right - left) * x / 10, top + (bottom - top) * y / 10);
    }
    // Include exact object edges; a coarse grid alone can miss a narrow free gap.
    const neighbors = placed.size > 16
      ? [...placed].filter(([j]) => i !== j).sort(([, a], [, b]) =>
        Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y)).slice(0, 8)
      : placed;
    for (const [j, other] of neighbors) {
      if (i === j) continue;
      const dx = (box.width + boxes[j].width) / 2 + gap;
      const dy = (box.height + boxes[j].height) / 2 + gap;
      for (const x of [other.x - dx, other.x, other.x + dx]) {
        for (const y of [other.y - dy, other.y, other.y + dy]) consider(x, y);
      }
    }
    for (const step of [.04, .015, .005]) {
      const origin = best;
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        consider(origin.x + dx * spanX * step, origin.y + dy * spanY * step);
      }
    }
    placed.set(i, best);
  }
  for (const i of order) place(i);
  // Let the primary object move too: freezing the book at the center can force
  // the later lamp onto its pages even when a clear arrangement fits the canvas.
  for (let pass = 0; pass < 2; pass++) for (const i of order) place(i);
  return layers.map((layer, i) => ({ ...layer, x: placed.get(i)!.x / format.width, y: placed.get(i)!.y / format.height }));
}

function positionCropped(layers: Layer[], format: CompositionFormat): Layer[] {
  const front = layers.filter(l => l.role === 'main');
  const back = layers.filter(l => l.role === 'background');
  const { width, height } = format;
  const pad = Math.min(width, height) * .04;
  const backdrop = layerBounds(back[0], format);
  const broadBackdrop = backdrop.width > backdrop.height * 1.2;
  const firstSlot = broadBackdrop ? [.60, .256] : front.length === 1 ? [.263, 0] : [.385, -.041];
  const backgroundSlots = [firstSlot, [.94, .4], [.2, .97]];
  const placed = new Map(back.map((layer, i) => {
    const box = layerBounds(layer, format);
    const [x, y] = backgroundSlots[i % backgroundSlots.length];
    return [layer.id, {
      ...layer,
      x: clamp(x, -box.width * .08 / width, 1 + box.width * .08 / width),
      y: clamp(y, -box.height * .08 / height, 1 + box.height * .08 / height),
    }];
  }));
  if (front.length > 2) {
    for (const layer of positionLayers(front, 'diagonal', format)) placed.set(layer.id, layer);
  } else {
    const order = [...front].sort((a, b) => {
      const aa = layerBounds(a, format), bb = layerBounds(b, format);
      return bb.width * bb.height - aa.width * aa.height;
    });
    const slots = front.length === 1 ? [[.64, .64]]
      : broadBackdrop ? [[.34, .27], [.35, .80]] : [[.45, .742], [.75, .532]];
    for (const [i, layer] of order.entries()) {
      const box = layerBounds(layer, format);
      placed.set(layer.id, { ...layer,
        x: clamp(slots[i][0], (pad + box.width / 2) / width, 1 - (pad + box.width / 2) / width),
        y: clamp(slots[i][1], (pad + box.height / 2) / height, 1 - (pad + box.height / 2) / height),
      });
    }
  }
  return layers.map(layer => placed.get(layer.id)!);
}

export function fitLayers(layers: Layer[], layout: Layout, format: CompositionFormat, variant = 0): Layer[] {
  if (!layers.length) return [];
  const pad = Math.min(format.width, format.height) * .04;
  const width = format.width - pad - (layout === 'editorial' && format.width >= format.height ? format.width * .3 : pad);
  const height = format.height - pad - (layout === 'editorial' && format.width < format.height ? format.height * .3 : pad);
  const native = layers.map(l => layerBounds({ ...l, size: 1 }, format));
  if (layout === 'cropped' && layers.some(layer => layer.role === 'background')) {
    const foreground = native.filter((_, i) => layers[i].role === 'main');
    const area = foreground.reduce((sum, b) => sum + b.width * b.height, 0);
    const largestFit = Math.min(...native.map((b, i) => {
      const allowance = layers[i].role === 'background' ? 1.55 : .92;
      return allowance * Math.min(width / b.width, height / b.height);
    }));
    const size = Math.max(MIN_SCENE_SCALE, Math.min(MAX_SCENE_SCALE, largestFit, Math.sqrt(width * height * (foreground.length === 1 ? .59 : .36) / area)));
    return positionCropped(layers.map(layer => ({ ...layer, size })), format);
  }
  const area = native.reduce((sum, b) => sum + b.width * b.height, 0);
  const largestFit = Math.min(...native.map(b => Math.min(width / b.width, height / b.height))) * .92;
  const size = Math.max(MIN_SCENE_SCALE, Math.min(MAX_SCENE_SCALE, largestFit, Math.sqrt(width * height * .55 / area)));
  return positionLayers(layers.map(l => ({ ...l, size })), layout, format, variant);
}

export function compositionBounds(layers: Layer[], format: CompositionFormat) {
  const boxes = layers.map(l => layerBounds(l, format));
  const left = Math.min(...boxes.map(b => b.x - b.width / 2));
  const top = Math.min(...boxes.map(b => b.y - b.height / 2));
  const right = Math.max(...boxes.map(b => b.x + b.width / 2));
  const bottom = Math.max(...boxes.map(b => b.y + b.height / 2));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function fitPlacedLayers(layers: Layer[], format: CompositionFormat, layout: Layout): Layer[] {
  const visible = layout === 'cropped' ? layers.filter(l => l.role === 'main') : layers;
  if (!visible.length) return layers;
  const box = compositionBounds(visible, format);
  const pad = Math.min(format.width, format.height) * .04;
  if (box.left >= pad && box.top >= pad && box.right <= format.width - pad && box.bottom <= format.height - pad) return layers;
  const factor = Math.min(1, (format.width - 2 * pad) / box.width, (format.height - 2 * pad) / box.height);
  if (layers[0].size * factor < MIN_SCENE_SCALE) throw new Error('Группа не помещается с сохранением расстановки. Нажмите «Подогнать» и повторите действие.');
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const x = clamp(cx, pad + box.width * factor / 2, format.width - pad - box.width * factor / 2);
  const y = clamp(cy, pad + box.height * factor / 2, format.height - pad - box.height * factor / 2);
  return layers.map(l => ({ ...l, size: l.size * factor,
    x: (x + (l.x * format.width - cx) * factor) / format.width,
    y: (y + (l.y * format.height - cy) * factor) / format.height,
  }));
}

export function scaleLayers(layers: Layer[], size: number): Layer[] {
  if (!Number.isFinite(size) || size < MIN_SCENE_SCALE || size > MAX_SCENE_SCALE) {
    throw new Error(`Общий масштаб должен быть от ${MIN_SCENE_SCALE * 100} до ${MAX_SCENE_SCALE * 100}%.`);
  }
  if (!layers.length || size === layers[0].size) return layers;
  const factor = size / layers[0].size;
  const scaled = layers.map(layer => ({
    ...layer,
    size,
    x: .5 + (layer.x - .5) * factor,
    y: .5 + (layer.y - .5) * factor,
  }));
  if (scaled.some(layer => Math.abs(layer.x) > MAX_LAYER_POSITION || Math.abs(layer.y) > MAX_LAYER_POSITION)) {
    throw new Error('Объекты слишком далеко от центра холста. Нажмите «Подогнать» и повторите увеличение.');
  }
  return scaled;
}
