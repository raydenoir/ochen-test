import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concepts, objectNames, literalInterpretation } from './concepts.mjs';
import { excludedObjects } from './prompt-objects.mjs';
export { excludedObjects, namedObjects } from './prompt-objects.mjs';

export const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

async function hasModelSnapshot(directory) {
  try {
    const files = await Promise.all(MODEL_FILES.map(name => stat(join(directory, name))));
    return files.every(file => file.isFile() && file.size > 0);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export function createLocalEncoder(cacheDir) {
  const cache = cacheDir ? resolve(cacheDir) : fileURLToPath(new URL('../.cache/models/', import.meta.url));
  const snapshot = join(cache, MODEL, MODEL_REVISION);
  let encoder;
  return async texts => {
    if (!encoder) encoder = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const options = { dtype: 'q8', device: 'cpu', cache_dir: cache };
      if (await hasModelSnapshot(snapshot)) {
        // A disk path keeps the library's preliminary file discovery offline as well.
        return pipeline('feature-extraction', snapshot.replaceAll('\\', '/'), { ...options, local_files_only: true });
      }
      return pipeline('feature-extraction', MODEL, { ...options, revision: MODEL_REVISION });
    })().catch(error => { encoder = undefined; throw error; });
    const pipe = await encoder;
    const result = await pipe(texts, { pooling: 'mean', normalize: true });
    return result.tolist();
  };
}
export const encode = createLocalEncoder(process.env.MODEL_CACHE_DIR);

export function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function createInterpreter(embedding = encode) {
  const anchors = concepts.flatMap(c => c.phrases.map(text => ({ concept: c, text })));
  let vectors;
  const cache = new Map();
  let queue = Promise.resolve();
  async function rank(prompt) {
    if (!vectors) vectors = embedding(anchors.map(a => a.text)).catch(error => { vectors = undefined; throw error; });
    const reference = await vectors;
    const [query] = await embedding([prompt]);
    const best = new Map();
    anchors.forEach((anchor, i) => {
      const score = cosine(query, reference[i]);
      if (!best.has(anchor.concept.key) || best.get(anchor.concept.key).score < score) {
        best.set(anchor.concept.key, { key: anchor.concept.key, score, concept: anchor.concept });
      }
    });
    return [...best.values()].sort((a, b) => b.score - a.score);
  }
  async function run(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200) throw new Error('Введите замысел длиной от 1 до 200 символов.');
    const text = prompt.trim();
    if (cache.has(text)) return cache.get(text);
    const excluded = excludedObjects(text);
    const literal = literalInterpretation(text, excluded);
    if (literal) return literal;
    const ranked = (await rank(text)).filter(r => !excluded.has(r.key));
    const first = ranked[0];
    if (!first) return { source: 'semantic', confidence: 'tentative', matches: [] };
    const matches = first.score < .42 ? [] : ranked.filter(r => r.score >= Math.max(first.score >= .5 ? .48 : .42, first.score * .78)).slice(0, 2).map(r => ({
      key: r.key, name: objectNames[r.key], role: 'main', score: r.score, reason: `Образ «${r.concept.label}».`, supporting: false,
    }));
    if (first.score >= .52 && matches.length < 3) for (const companion of first.concept.support) {
      if (excluded.has(companion.key) || matches.some(m => m.key === companion.key)) continue;
      matches.push({ key: companion.key, name: objectNames[companion.key], role: companion.role ?? 'main', score: null, reason: companion.reason, supporting: true });
      if (matches.length === 3) break;
    }
    const result = { source: 'semantic', confidence: first.score >= .55 ? 'confident' : 'tentative', matches };
    if (cache.size >= 100) cache.clear();
    cache.set(text, result);
    return result;
  }
  return {
    rank,
    interpret(prompt) {
      // Keep CPU inference serial so simultaneous clicks do not multiply memory use.
      const next = queue.then(() => run(prompt));
      queue = next.catch(() => {});
      return next;
    },
  };
}

export const interpreter = createInterpreter();
