// Outreach tracking and photo cache storage.
// Uses Upstash Redis when its env vars are present (required on Vercel, whose
// filesystem is read-only), otherwise JSON files in data/ for local use.
import { Redis } from '@upstash/redis';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// Find the Redis REST credentials. Vercel names them KV_REST_API_URL/TOKEN by
// default, but a custom prefix (e.g. STORAGE_KV_REST_API_URL) or Upstash's own
// names are also common, so accept any of them. As a last resort, derive them
// from a rediss:// connection string (Upstash uses the same token for both).
function findRedisConfig(env = process.env) {
  const keys = Object.keys(env);
  for (const [urlSuffix, tokenSuffix] of [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ]) {
    for (const k of keys.filter((k) => k === urlSuffix || k.endsWith(`_${urlSuffix}`)).sort((a, b) => a.length - b.length)) {
      const tokenKey = k.slice(0, k.length - urlSuffix.length) + tokenSuffix;
      if (env[k] && env[tokenKey]) return { url: env[k], token: env[tokenKey], source: `${k} + ${tokenKey}` };
    }
  }
  for (const k of keys.filter((k) => k === 'REDIS_URL' || k === 'KV_URL' || k.endsWith('_REDIS_URL') || k.endsWith('_KV_URL'))) {
    try {
      const u = new URL(env[k]);
      if (u.hostname.endsWith('upstash.io') && u.password) {
        return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password), source: `${k} (connection string)` };
      }
    } catch { /* not a URL */ }
  }
  return null;
}

const config = findRedisConfig();
const redis = config ? new Redis({ url: config.url, token: config.token }) : null;

export const storeKind = redis ? 'redis' : 'file';

if (!redis && process.env.VERCEL) {
  console.error('No Redis configured: add Upstash Redis in the Vercel dashboard so outreach tracking can be saved.');
}

// Used by /api/health: which storage is in use, and does a real write work?
// Returns env var names only, never their values.
export async function storeHealth() {
  const envNames = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k)).sort();
  const info = { store: storeKind, source: config?.source ?? null, envNames, onVercel: Boolean(process.env.VERCEL) };
  try {
    if (redis) {
      const stamp = String(Date.now());
      await redis.set('healthcheck', stamp);
      if ((await redis.get('healthcheck'))?.toString() !== stamp) throw new Error('Redis read back a different value');
    } else {
      await writeJson('healthcheck.json', { at: Date.now() });
    }
    return { ...info, ok: true };
  } catch (err) {
    return { ...info, ok: false, error: err.message };
  }
}

/* ---------- File backend ---------- */

async function readJson(name) {
  const file = path.join(DATA_DIR, name);
  if (!existsSync(file)) return {};
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(name, data) {
  const file = path.join(DATA_DIR, name);
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
  await rename(`${file}.tmp`, file);
}

// Serialise file writes so concurrent requests can't clobber each other.
let writeChain = Promise.resolve();
function queued(fn) {
  const next = writeChain.then(fn);
  writeChain = next.catch(() => {});
  return next;
}

/* ---------- Outreach ---------- */

const OUTREACH_KEY = 'outreach';
const blank = () => ({ status: 'not_contacted', history: [] });

export async function getAllOutreach() {
  if (!redis) return readJson('outreach.json');
  return (await redis.hgetall(OUTREACH_KEY)) ?? {};
}

// Applies `mutator` to one venue's entry and saves it. Returns the entry.
export async function updateOutreach(id, mutator) {
  if (!redis) {
    return queued(async () => {
      const all = await readJson('outreach.json');
      all[id] ??= blank();
      mutator(all[id]);
      await writeJson('outreach.json', all);
      return all[id];
    });
  }
  const entry = (await redis.hget(OUTREACH_KEY, id)) ?? blank();
  mutator(entry);
  await redis.hset(OUTREACH_KEY, { [id]: entry });
  return entry;
}

/* ---------- Photo cache ---------- */

const PHOTOS_KEY = 'photos';

export async function getCachedPhotos(id) {
  if (!redis) return (await readJson('photos-cache.json'))[id] ?? null;
  return (await redis.hget(PHOTOS_KEY, id)) ?? null;
}

export async function setCachedPhotos(id, value) {
  if (!redis) {
    return queued(async () => {
      const all = await readJson('photos-cache.json');
      all[id] = value;
      await writeJson('photos-cache.json', all);
    });
  }
  await redis.hset(PHOTOS_KEY, { [id]: value });
}
