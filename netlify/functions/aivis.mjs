// Confidence Fly AI Visibility Tool: private proxy to the SE Ranking AI Search API.
// Needs two Netlify environment variables: SERANKING_API_KEY and AIVIS_PASSWORD.
const BASE = 'https://api.seranking.com';
const ENGINES = new Set(['chatgpt', 'ai-overview', 'ai-mode', 'gemini', 'perplexity']);
const SCOPES = new Set(['base_domain', 'domain', 'url']);

const out = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const isTarget = (s) => typeof s === 'string' && s.length < 300 && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(s);
const isBrand = (s) => s === undefined || s === '' || (typeof s === 'string' && s.length <= 100);
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')).toString();

export default async (req) => {
  if (req.method !== 'POST') return out({ error: 'POST only' }, 405);
  const key = process.env.SERANKING_API_KEY;
  const pw = process.env.AIVIS_PASSWORD;
  if (!key || !pw) return out({ error: 'Tool not configured. Add SERANKING_API_KEY and AIVIS_PASSWORD in Netlify, then redeploy.' }, 500);

  let b;
  try { b = await req.json(); } catch { return out({ error: 'Bad request' }, 400); }
  if (!safeEqual(b.password || '', pw)) {
    await new Promise((r) => setTimeout(r, 800));
    return out({ error: 'Wrong password' }, 401);
  }

  const p = b.params || {};
  const source = /^[a-z]{2}$/.test(p.source || '') ? p.source : 'us';
  const scope = SCOPES.has(p.scope) ? p.scope : 'base_domain';
  const headers = { Authorization: 'Token ' + key, Accept: 'application/json' };
  let path, init = { method: 'GET', headers };

  switch (b.action) {
    case 'ping':
      return out({ ok: true });
    case 'balance':
      path = '/v1/account/subscription';
      break;
    case 'discover':
      if (!isTarget(p.target)) return out({ error: 'Bad domain' }, 400);
      path = '/v1/ai-search/discover-brand?' + qs({ target: p.target, source, scope });
      break;
    case 'overview':
      if (!isTarget(p.target) || !ENGINES.has(p.engine) || !isBrand(p.brand)) return out({ error: 'Bad overview request' }, 400);
      path = '/v1/ai-search/overview/by-engine/time-series?' + qs({ target: p.target, engine: p.engine, source, scope, brand: p.brand });
      break;
    case 'prompts': {
      const limit = Math.max(1, Math.min(100, parseInt(p.limit, 10) || 10));
      if (!isTarget(p.target) || !ENGINES.has(p.engine)) return out({ error: 'Bad prompts request' }, 400);
      path = '/v1/ai-search/prompts-by-target?' + qs({ target: p.target, engine: p.engine, source, scope, sort: 'volume', sort_order: 'desc', limit, offset: 0 });
      break;
    }
    case 'leaderboard': {
      const comps = Array.isArray(p.competitors) ? p.competitors : [];
      const engines = Array.isArray(p.engines) ? p.engines.filter((e) => ENGINES.has(e)) : [];
      const primary = p.primary || {};
      if (!isTarget(primary.target) || !isBrand(primary.brand) || comps.length < 1 || comps.length > 10 || !engines.length ||
          !comps.every((c) => c && isTarget(c.target) && isBrand(c.brand))) return out({ error: 'Bad leaderboard request' }, 400);
      path = '/v1/ai-search/overview/leaderboard';
      const clean = (e) => (e.brand ? { target: e.target, brand: e.brand } : { target: e.target });
      init = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: clean(primary), competitors: comps.map(clean), scope, source, engines }) };
      break;
    }
    default:
      return out({ error: 'Unknown action' }, 400);
  }

  try {
    const r = await fetch(BASE + path, init);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return out({ status: r.status, data });
  } catch (e) {
    return out({ status: 0, data: { error: 'Could not reach SE Ranking' } }, 502);
  }
};

export const config = { path: '/api/aivis' };
