import { assets as catalog } from '../design/library/manifest.json';
import type { Detail, Scene } from './model';

const sourceURLs = import.meta.glob('../design/library/assets/**/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
// CLI exports use Vite's file loader; the browser reuses the thumbnail URLs.
const rawLoaders = import.meta.env.SSR
  ? import.meta.glob('../design/library/assets/**/*.svg', { query: '?raw', import: 'default' })
  : createURLLoaders(sourceURLs);
type Loader = () => Promise<string>;
type AssetScene = Pick<Scene, 'detail' | 'layers'>;
const sourcePath = (key: string, detail: Detail, role: string) => `../design/library/assets/${detail}/${role}/${key}.svg`;
const dimensions = new Map<string, { width: number; height: number }>(catalog.map(asset => {
  const [,, width, height] = asset.svgGeometry.viewBox.split(/\s+/).map(Number);
  return [`../design/library/${asset.path}`, { width, height }] as const;
}));

export function createURLLoaders(urls: Record<string, string>, request: typeof fetch = fetch): Record<string, Loader> {
  return Object.fromEntries(Object.entries(urls).map(([path, url]) => [path, async () => {
    const response = await request(url);
    if (!response.ok) throw new Error('Не удалось получить исходный SVG.');
    return response.text();
  }]));
}

export function getAssetGeometry(key: string, detail: Detail, role: string) {
  const value = dimensions.get(sourcePath(key, detail, role));
  if (!value) throw new Error(`Не найден исходный объект: ${key}/${detail}/${role}`);
  return value;
}

export function getAssetURL(key: string, detail: Detail, role: string) {
  const url = sourceURLs[sourcePath(key, detail, role)];
  if (!url) throw new Error('Не найдена миниатюра объекта.');
  return url;
}

export function createAssetStore(loaders: Record<string, Loader>) {
  const loaded = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();
  function loadAsset(key: string, detail: Detail, role: string): Promise<void> {
    const path = sourcePath(key, detail, role);
    if (loaded.has(path)) return Promise.resolve();
    const existing = pending.get(path); if (existing) return existing;
    const loader = loaders[path];
    if (!loader) return Promise.reject(new Error('Не найден исходный SVG объекта.'));
    const request = Promise.resolve().then(loader).then(raw => {
      const box = raw.match(/viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)"/);
      const expected = getAssetGeometry(key, detail, role);
      if (!box || +box[1] !== expected.width || +box[2] !== expected.height) throw new Error('Размеры SVG не совпадают с исходной библиотекой.');
      loaded.set(path, raw);
    }).finally(() => pending.delete(path));
    pending.set(path, request);
    return request;
  }
  const assetReady = (key: string, detail: Detail, role: string) => loaded.has(sourcePath(key, detail, role));
  return {
    loadAsset,
    assetReady,
    getAsset(key: string, detail: Detail, role: string) {
      const raw = loaded.get(sourcePath(key, detail, role));
      if (!raw) throw new Error('Исходный SVG ещё загружается. Подождите и повторите попытку.');
      return { raw, ...getAssetGeometry(key, detail, role) };
    },
    sceneAssetsReady(scene: AssetScene) { return scene.layers.every(l => assetReady(l.key, l.detail ?? scene.detail, l.role)); },
    async loadSceneAssets(scene: AssetScene, onAssetReady?: () => void) {
      const sources = new Map(scene.layers.map(layer => [sourcePath(layer.key, layer.detail ?? scene.detail, layer.role), layer]));
      await Promise.all([...sources.values()].map(layer => loadAsset(layer.key, layer.detail ?? scene.detail, layer.role).then(onAssetReady)));
    },
  };
}

export const { loadAsset, getAsset, assetReady, sceneAssetsReady, loadSceneAssets } = createAssetStore(rawLoaders as Record<string, Loader>);
