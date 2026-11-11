import { excludedObjects, namedObjects } from '../server/prompt-objects.mjs';
import { DEFAULT_FORMAT, MAX_LAYER_POSITION, MAX_SCENE_SCALE, MIN_SCENE_SCALE, fitLayers, fitPlacedLayers, layerBounds, positionLayers, scaleLayers, type CompositionFormat } from './layout';

export type Detail = 'L' | 'S';
export type Role = 'main' | 'background';
export type Layout = 'balanced' | 'editorial' | 'diagonal' | 'cropped';
export type LayerColor = 'alternate';
export interface Layer { detail?: Detail; color?: LayerColor; id: string; key: string; role: Role; x: number; y: number; size: number; rotation: number }
export interface Palette { key: string; name: string; background: string[]; objects: string[] }
export interface Scene { scaleVersion?: 2; title: string; prompt: string; width: number; height: number; detail: Detail; palette: Palette; layout: Layout; background: boolean; backgroundTexture?: boolean; backgroundPattern?: 'circles' | 'corners'; layers: Layer[] }
export const OBJECTS = [
  { key: 'book', name: 'Книга', tags: 'книг чтени учеб образован знани обучен школ университет курс book read learn education' },
  { key: 'phone', name: 'Телефон', tags: 'телефон связ общен звон контакт цифров приложен мобильн коммуникац phone connect digital call' },
  { key: 'puzzle', name: 'Пазлы', tags: 'пазл команд вместе решен партнер сотруд стратег синерг объедин puzzle team together solution' },
  { key: 'coin', name: 'Монета', tags: 'монет деньг финанс инвести накоп доход прибыл ценност богат эконом бюджет coin money finance' },
  { key: 'headphones', name: 'Наушники', tags: 'наушник музык слуш подкаст отдых фокус звук headphone music listen focus' },
  { key: 'lamp', name: 'Лампа', tags: 'ламп иде свет озарен вдохнов креатив творче мысл инновац lamp idea light creative' },
  { key: 'flowers', name: 'Цветы', tags: 'цвет букет забот рост весн радост подар красот уют праздник благодар flower growth care gift' },
  { key: 'folder', name: 'Папка', tags: 'папк работ поряд документ проект офис организац дел карьер folder work project document' },
  { key: 'pen', name: 'Ручка', tags: 'ручк пис запис план договор текст автор заметк pen write plan' },
  { key: 'wallet', name: 'Кошелёк', tags: 'кошел покупк оплат трат расход сбереж магазин wallet pay save' },
] as const;
export const PALETTES: Palette[] = [
  { key: 'violet', name: 'Сиреневый день', background: ['#D7CDF5','#AA9BF0','#7864D7','#181817'], objects: ['#F9ECB0','#F9A3AA','#FFE3E1','#FFFFFF'] },
  { key: 'peach', name: 'Тёплый персик', background: ['#FDD7B9','#FAC896','#D27532','#181817'], objects: ['#F9ECB0','#80DADA','#BEEBEB','#FFFFFF'] },
  { key: 'mint', name: 'Мятная свежесть', background: ['#BEEBEB','#80DADA','#5ABEBE','#181817'], objects: ['#FFD4F2','#6D7BFC','#B6C6FE','#FFFFFF'] },
];
export const SAVINGS_EXAMPLE = 2;
export const EXAMPLES = [
  { title: 'Знания открывают двери', prompt: 'Знания открывают двери', keys: ['book','lamp','pen'], tag: 'Образование' },
  { title: 'Большие идеи — вместе', prompt: 'Большие идеи рождаются в команде', keys: ['puzzle','lamp','phone'], tag: 'Командная работа' },
  { title: 'Деньги на чёрный день', prompt: 'Деньги на чёрный день', keys: ['lamp','wallet','coin'], tag: 'Сбережения' },
];
export const EXAMPLE_FORMATS = [
  { name: 'education-album', width: 1200, height: 800, layout: 'cropped', detail: 'L' },
  { name: 'team-square', width: 1000, height: 1000, layout: 'diagonal', detail: 'L' },
  { name: 'savings-square', width: 1000, height: 1000, layout: 'cropped', detail: 'L' },
] as const;
const EXAMPLE_PLACEMENTS: { size: number; positions: Record<string, Pick<Layer, 'x' | 'y' | 'detail'>> }[] = [
  { size: 1.74, positions: {
    lamp: { x: .79, y: -.015 },
    book: { x: .42, y: .59 },
    pen: { x: .82, y: .79 },
  } },
  { size: 2.3, positions: {
    lamp: { x: .30, y: .37, detail: 'S' },
    puzzle: { x: .64, y: .65 },
    phone: { x: .29, y: .81, detail: 'S' },
  } },
];
export function exampleScene(index: number): Scene {
  const example = EXAMPLES[index], format = EXAMPLE_FORMATS[index];
  if (!example || !format) throw new Error('Такого примера нет.');
  const { name, ...settings } = format;
  const placement = EXAMPLE_PLACEMENTS[index];
  const choices = example.keys.map(key => ({ key, role: key === 'lamp' ? 'background' as const : 'main' as const }))
    .sort((a, b) => Number(a.role === 'main') - Number(b.role === 'main'));
  const layers = placement
    ? choices.map(choice => ({ ...choice, ...placement.positions[choice.key], size: placement.size, rotation: 0 }))
    : arrangeChoices(choices, settings.layout, 0, settings);
  return {
    scaleVersion: 2, ...settings, title: example.title, prompt: example.prompt, palette: PALETTES[index === 1 ? 1 : 0], background: true, backgroundTexture: true, backgroundPattern: index === 0 ? 'circles' : 'corners',
    layers: layers.map((layer, i) => ({
      ...layer,
      ...(index === SAVINGS_EXAMPLE && (layer.key === 'lamp' || layer.key === 'wallet') ? { color: 'alternate' as const } : {}),
      id: `${name}-${i + 1}`,
    })),
  };
}
export const uid = () => crypto.randomUUID();
const clean = (s: string) => s.toLowerCase().replaceAll('ё','е');
export function matchesSavingsExample(prompt: string) {
  return clean(prompt).trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trimEnd()
    === clean(EXAMPLES[SAVINGS_EXAMPLE].prompt);
}
const NAME_ALIASES: Record<string, readonly string[]> = {
  book: ['книга', 'книги'], phone: ['телефон', 'телефоны'],
  puzzle: ['пазл', 'пазлы'], coin: ['монета', 'монеты'],
  headphones: ['наушники'], lamp: ['лампа', 'лампы'],
  flowers: ['цветы', 'букет'], folder: ['папка', 'папки'],
  pen: ['ручка', 'ручки'], wallet: ['кошелек', 'кошельки'],
};
// Names are deliberately resolved separately from metaphor associations.
export function parseObjectNames(text: string) {
  const entries = text.split(/[,;\n]+/).map(input => input.trim()).filter(Boolean).map(input => {
    const normalized = clean(input).replace(/\s+/g, ' ');
    const role: Role = /\s*\(фон\)$/.test(normalized) ? 'background' : 'main';
    const name = normalized.replace(/\s*\(фон\)$/, '').trim();
    const object = OBJECTS.find(o => o.key === name || NAME_ALIASES[o.key].includes(name));
    return { input, key: object?.key, role };
  });
  return {
    entries,
    keys: entries.flatMap(e => e.key ? [e.key] : []),
    unknown: entries.filter(e => !e.key).map(e => e.input),
    tooMany: entries.length > 6,
  };
}
export function matchObjects(prompt: string) {
  const excluded = excludedObjects(prompt);
  const explicit = namedObjects(prompt).filter(key => !excluded.has(key));
  if (explicit.length) return explicit.flatMap(key => OBJECTS.filter(o => o.key === key).map(o => ({ key: o.key, name: o.name, score: 1 })));
  const words = clean(prompt).split(/[^a-zа-я]+/).filter(w => w.length > 2);
  return OBJECTS.map(o => ({ key: o.key, name: o.name, score: o.tags.split(' ').reduce((s,t) => s + words.filter(w => w.startsWith(t) || t.startsWith(w)).length, 0) }))
    .filter(o => o.score > 0 && !excluded.has(o.key)).sort((a,b) => b.score-a.score).slice(0,6);
}
export function arrange(keys: string[], layout: Layout, variant = 0, format: CompositionFormat = DEFAULT_FORMAT): Layer[] {
  return arrangeChoices(keys.filter(Boolean).map(key => ({ key, role: 'main' })), layout, variant, format);
}
export function arrangeChoices(choices: { key: string; role: Role }[], layout: Layout, variant = 0, format: CompositionFormat = DEFAULT_FORMAT): Layer[] {
  const layers: Layer[] = choices.map(({ key, role }) => ({ id: uid(), key, role, x: .5, y: .5, size: 1, rotation: 0 }));
  return fitLayers(layers, layout, format, variant);
}
export function newScene(): Scene {
  return { scaleVersion: 2, title: 'Знания открывают двери', prompt: 'Знания открывают двери', width:1200,height:800,detail:'L',palette:PALETTES[0],layout:'balanced',background:true,backgroundTexture:true,backgroundPattern:'circles',layers:arrange(['book','lamp','pen'],'balanced') };
}
// Reposition existing layers without replacing their identity or edited properties.
export function rearrange(layers: Layer[], layout: Layout, variant = 0, format: CompositionFormat = DEFAULT_FORMAT): Layer[] {
  return positionLayers(layers, layout, format, variant);
}
export function adaptScene(scene: Scene, patch: Partial<Pick<Scene, 'width' | 'height' | 'detail' | 'layout'>>, variant = 0): Scene {
  const next = { ...scene, ...patch };
  const formatChanged = next.width !== scene.width || next.height !== scene.height;
  if (!formatChanged && next.detail === scene.detail && next.layout === scene.layout) return scene;
  if (next.layout !== scene.layout) return { ...next, layers: fitLayers(scene.layers, next.layout, next, variant) };
  return next;
}
export function fitScene(scene: Scene): Scene {
  const layout = scene.layout === 'cropped' ? 'balanced' : scene.layout;
  let layers: Layer[];
  try { layers = fitPlacedLayers(scene.layers, scene, 'balanced'); }
  catch { layers = fitLayers(scene.layers, layout, scene); }
  return layers === scene.layers && layout === scene.layout ? scene : { ...scene, layout, layers };
}
export function placeNewLayer(scene: Scene, layer: Layer): Scene {
  if (scene.layout === 'cropped' && layer.role === 'background') {
    const placed = positionLayers([...scene.layers.filter(l => l.role === 'background'), layer], scene.layout, scene).at(-1)!;
    return { ...scene, layers: [placed, ...scene.layers] };
  }
  const anchor = scene.layers.find(l => l.role === 'main') ?? scene.layers[0];
  if (anchor) {
    const a = layerBounds(anchor, scene), b = layerBounds(layer, scene);
    const gap = Math.min(scene.width, scene.height) * .04;
    const side = (a.width + b.width) / 2 + gap;
    const below = (a.height + b.height) / 2 + gap;
    const candidates = [
      { x: anchor.x + side / scene.width, y: anchor.y },
      { x: anchor.x - side / scene.width, y: anchor.y },
      { x: anchor.x, y: anchor.y + below / scene.height },
      { x: anchor.x, y: anchor.y - below / scene.height },
    ];
    const at = layer.role === 'background' ? 0 : scene.layers.length;
    let best: Scene | undefined;
    for (const point of candidates) {
      try {
        const next = insertLayer(scene, { ...layer, ...point }, at);
        if (!best || next.layers[0].size > best.layers[0].size) best = next;
      } catch { /* Try the next side of the anchor. */ }
    }
    if (best) return best;
  }
  return insertLayer(scene, layer, layer.role === 'background' ? 0 : scene.layers.length);
}
export function insertLayer(scene: Scene, layer: Layer, at = scene.layers.length): Scene {
  const layers = [...scene.layers];
  layers.splice(at, 0, layer);
  return { ...scene, layers: fitPlacedLayers(layers, scene, scene.layout) };
}
export function scaleScene(scene: Scene, size: number): Scene {
  const layers = scaleLayers(scene.layers, size);
  return layers === scene.layers ? scene : { ...scene, layers };
}
export function parsePalette(text: string): Palette {
  const p = JSON.parse(text);
  if (!p || !['background','objects'].every(k => Array.isArray(p[k]) && p[k].length === 4 && p[k].every((c:unknown) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)))) {
    throw new Error('В палитре нужны background и objects — по 4 цвета в формате #RRGGBB.');
  }
  return { key: uid(), name: typeof p.name === 'string' ? p.name.slice(0,40) : 'Моя палитра', background:p.background, objects:p.objects };
}
export function migrateSceneScale(scene: Scene): Scene {
  if (scene.scaleVersion === 2) return scene;
  // Old S scenes applied a second multiplier to every layer, including overrides.
  const size = (scene.layers[0]?.size ?? 1) * 2;
  const layers = scene.detail === 'S' ? scene.layers.map(layer => ({ ...layer, size })) : scene.layers;
  return { ...scene, scaleVersion: 2, layers };
}
export function validateScene(value: unknown): value is Scene {
  if (!value || typeof value !== 'object') return false;
  const s = value as Scene;
  if (!s.palette || typeof s.palette.name !== 'string' || typeof s.palette.key !== 'string') return false;
  try { parsePalette(JSON.stringify(s.palette)); } catch { return false; }
  const maxScale = s.scaleVersion === 2 ? MAX_SCENE_SCALE : 6;
  return (s.scaleVersion === undefined || s.scaleVersion === 2)
    && typeof s.title === 'string' && typeof s.prompt === 'string' && typeof s.background === 'boolean'
    && (s.backgroundTexture === undefined || typeof s.backgroundTexture === 'boolean')
    && (s.backgroundPattern === undefined || ['circles','corners'].includes(s.backgroundPattern))
    && ['L','S'].includes(s.detail) && ['balanced','editorial','diagonal','cropped'].includes(s.layout)
    && Number.isFinite(s.width) && s.width >= 300 && s.width <= 4000 && Number.isFinite(s.height) && s.height >= 300 && s.height <= 4000
    && Array.isArray(s.layers) && s.layers.length <= 60 && new Set(s.layers.map(l=>l?.id)).size === s.layers.length
    && s.layers.every(l => l && (l.detail === undefined || l.detail === 'S' || l.detail === 'L') && (l.color === undefined || l.color === 'alternate') && typeof l.id === 'string' && /^[\w-]{1,80}$/.test(l.id) && OBJECTS.some(o=>o.key===l.key)
      && ['main','background'].includes(l.role) && [l.x,l.y,l.size,l.rotation].every(Number.isFinite)
      && l.size >= MIN_SCENE_SCALE && l.size <= maxScale && Math.abs(l.x) <= MAX_LAYER_POSITION && Math.abs(l.y) <= MAX_LAYER_POSITION && Math.abs(l.rotation)<=360)
    && (s.layers.length === 0 || s.layers.every(l=>Math.abs(l.size-s.layers[0].size)<.00001));
}
