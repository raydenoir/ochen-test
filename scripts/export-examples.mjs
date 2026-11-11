import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../examples/', import.meta.url);
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { EXAMPLE_FORMATS, exampleScene } = await server.ssrLoadModule('/src/model.ts');
  const { exportSVG } = await server.ssrLoadModule('/src/svg.ts');
  const { loadSceneAssets } = await server.ssrLoadModule('/src/assets.ts');
  await mkdir(output, { recursive: true });
  for (const [i, { name }] of EXAMPLE_FORMATS.entries()) {
    const scene = exampleScene(i);
    await loadSceneAssets(scene);
    await writeFile(new URL(`${name}.svg`, output), exportSVG(scene) + '\n');
    await writeFile(new URL(`${name}.json`, output), JSON.stringify(scene, null, 2) + '\n');
    console.log(`${name}.svg + ${name}.json`);
  }
} finally {
  await server.close();
}
