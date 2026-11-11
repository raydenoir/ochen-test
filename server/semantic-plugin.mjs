import { isIP } from 'node:net';
import { createInterpretProvider } from './providers.mjs';

function normalizeIp(value) {
  const ip = value?.trim().replace(/^::ffff:(?=\d+\.)/i, '');
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6 && !ip.includes('%')) return new URL(`http://[${ip}]`).hostname.slice(1, -1);
  return null;
}

export function semanticMiddleware(analyze = createInterpretProvider().interpret, { trustedProxyIps = '' } = {}) {
  const trusted = new Set(trustedProxyIps.split(',').map(value => {
    if (!value.trim()) return null;
    const ip = normalizeIp(value);
    if (!ip) throw new Error('TRUSTED_PROXY_IPS должен содержать IP-адреса через запятую.');
    return ip;
  }).filter(Boolean));

  function visitorAddress(req) {
    const peer = normalizeIp(req.socket.remoteAddress) ?? 'local';
    const forwarded = req.headers['x-forwarded-for'];
    if (!trusted.has(peer) || typeof forwarded !== 'string') return peer;
    // Stop at the first untrusted hop, counting from the server.
    for (const hop of forwarded.split(',').reverse()) {
      const ip = normalizeIp(hop);
      if (!ip) return peer;
      if (!trusted.has(ip)) return ip;
    }
    return peer;
  }

  const requests = new Map();
  return async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/interpret') return next();
    const send = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method !== 'POST') return send(405, { error: 'Используйте POST.' });
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Запрос с другого сайта отклонён.' });
    } catch { return send(403, { error: 'Некорректный адрес источника.' }); }
    let body = '';
    try {
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Запрос слишком большой.' });
      }
      let prompt;
      try { ({ prompt } = JSON.parse(body)); } catch { return send(400, { error: 'Не удалось прочитать запрос.' }); }
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200) return send(400, { error: 'Введите замысел длиной от 1 до 200 символов.' });
      const visitor = visitorAddress(req), now = Date.now();
      if (requests.size > 1000) requests.clear();
      const window = requests.get(visitor);
      if (window && window.until > now && window.count >= 20) return send(429, { error: 'Слишком много запросов. Попробуйте немного позже.' });
      requests.set(visitor, window && window.until > now ? { ...window, count: window.count + 1 } : { until: now + 60000, count: 1 });
      return send(200, await analyze(prompt));
    } catch {
      return send(503, { error: 'Смысловой анализ сейчас недоступен. Можно повторить попытку или собрать по названиям.' });
    }
  };
}

export default function semanticPlugin(config = process.env) {
  const provider = createInterpretProvider(config);
  return {
    name: 'semantic-library-search',
    configureServer(server) { server.middlewares.use(semanticMiddleware(provider.interpret)); },
    configurePreviewServer(server) { server.middlewares.use(semanticMiddleware(provider.interpret)); },
  };
}
