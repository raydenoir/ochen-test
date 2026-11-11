import { vi } from 'vitest';

// Serve the real SVG fixtures to Happy DOM without starting an HTTP server.
const sources = import.meta.glob('../design/library/assets/**/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://localhost:3000');
  const source = sources['..' + url.pathname];
  if (source === undefined) throw new Error(`Unexpected fixture request: ${url.pathname}`);
  return new Response(source, { headers: { 'Content-Type': 'image/svg+xml' } });
});
