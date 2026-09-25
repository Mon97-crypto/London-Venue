// Outreach tracking and photo cache storage.
// Uses Upstash Redis when its env vars are present (required on Vercel, whose
// filesystem is read-only), otherwise JSON files in data/ for local use.
import { Redis } from '@upstash/redis';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const storeKind = redis ? 'redis' : 'file';

if (!redis && process.env.VERCEL) {
  console.error('No Redis configured: add Upstash Redis in the Vercel dashboard so outreach tracking can be saved.');
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
