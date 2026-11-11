import type { Scene } from './model';
import { backgrounds, palettes } from '../design/library/manifest.json';

const sources = import.meta.glob('../design/library/backgrounds/**/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export type BackgroundPattern = 'circles' | 'corners';

type BackgroundSettings = Pick<Scene, 'background' | 'backgroundTexture' | 'backgroundPattern' | 'palette' | 'detail'>;

export function backgroundPattern(scene: Pick<Scene, 'backgroundPattern' | 'palette'>): BackgroundPattern {
  return scene.backgroundPattern ?? (scene.palette.key === 'peach' ? 'corners' : 'circles');
}

/** Source windows move with the canvas edges; their contents keep one scale. */
export function decorationFrames(width: number, height: number, nativeWidth: number, nativeHeight: number, pattern: BackgroundPattern) {
  const scale = Math.min(width / nativeWidth, height / nativeHeight);
  const regions = pattern === 'circles'
    ? [{ x: 0, y: 0, w: .5, h: .5, right: false, bottom: false }, { x: 0, y: .75, w: .25, h: .25, right: false, bottom: true }, { x: .5, y: .7, w: .5, h: .3, right: true, bottom: true }]
    : [{ x: 0, y: 0, w: 1, h: .5, right: true, bottom: false }, { x: 0, y: .65, w: 1, h: .35, right: true, bottom: true }];
  return regions.map(region => {
    const crop = { x: region.x * nativeWidth, y: region.y * nativeHeight, width: region.w * nativeWidth, height: region.h * nativeHeight };
    const frameWidth = crop.width * scale, frameHeight = crop.height * scale;
    return { crop, width: frameWidth, height: frameHeight, x: region.right ? width - frameWidth : 0, y: region.bottom ? height - frameHeight : 0 };
  });
}

export function backgroundArtwork(scene: BackgroundSettings & Pick<Scene, 'width' | 'height'>, id = 'scene-decoration') {
  if (!scene.background || !scene.backgroundTexture) return '';
  const pattern = backgroundPattern(scene);
  const family = pattern === 'corners' ? 'peach' : 'violet';
  const asset = backgrounds.find(a => a.size === scene.detail && a.key === `confetti-${family}`)!;
  const raw = sources[`../design/library/${asset.path}`];
  const base = palettes.find(p => p.key === family)!;
  const colors = new Map(base.background.map((color, i) => [color.toUpperCase(), scene.palette.background[i]]));
  const colored = raw.replace(/(fill|stroke|stop-color)="(#[\da-f]{6})"/gi, (_match, attribute: string, color: string) => `${attribute}="${colors.get(color.toUpperCase()) ?? color}"`);
  const box = raw.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  // Keep source paths and proportions, and isolate source IDs from object IDs.
  const isolated = colored.replace(/id="([^"]+)"/g, `id="${id}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`).replace(/href="#([^"]+)"/g, `href="#${id}-$1"`);
  const frames = decorationFrames(scene.width, scene.height, box[2], box[3], pattern);
  const windows = frames.map(frame => `<svg x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" viewBox="${frame.crop.x} ${frame.crop.y} ${frame.crop.width} ${frame.crop.height}" overflow="hidden"><use href="#${id}-source"/></svg>`).join('');
  return `<g id="${id}" pointer-events="none"><defs><g id="${id}-source">${isolated}</g></defs>${windows}</g>`;
}
