// The API. Mounted by server.js locally and by api/index.js on Vercel.
import express from 'express';
import venues from '../data/venues.json' with { type: 'json' };
import { getAllOutreach, updateOutreach, getCachedPhotos, setCachedPhotos, storeHealth } from './store.js';

const STATUSES = ['not_contacted', 'contacted', 'replied', 'shortlisted', 'declined', 'booked'];
const findVenue = (id) => venues.find((v) => v.id === id);

/* ---------- Photos ---------- */
// When a venue has no image URLs in venues.json, read them from its own
// website (og:image plus large <img> tags) and cache the result for a week.

function absolutise(src, base) {
  try {
    const u = new URL(src.replace(/&amp;/g, '&'), base);
    return u.protocol.startsWith('http') ? u.href : null;
  } catch {
    return null;
  }
}

// Images that are never a good cover: maps, plans, logos, icons, awards.
const SKIP = /map|location|directions|find-us|floor-?plan|plan[-_.]|logo|icon|sprite|favicon|badge|michelin|award|guide|rosette|signature|placeholder|blank|spacer|arrow|button|social|instagram|facebook|twitter|tripadvisor|opentable|payment|qr/i;
// Words that suggest a photo of the room, the food or the venue.
const GOOD = /dining|room|interior|restaurant|table|private|salon|terrace|chef|dish|food|menu|hero|gallery|banner|header|slide|venue|bar|kitchen/i;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // Many restaurant sites reject obvious bots, so present as a normal browser.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), base: res.url };
}

// Returns candidate photos from one page, each with a score (higher = better cover).
async function scrapePhotos(url, bonus = 0) {
  const { html, base } = await fetchHtml(url);
  const found = [];
  const add = (src, score, alt = '') => {
    const abs = absolutise(src, base);
    if (!abs || SKIP.test(abs) || SKIP.test(alt) || /\.svg(\?|$)/i.test(abs)) return;
    found.push({ url: abs, score: score + bonus + (GOOD.test(abs) || GOOD.test(alt) ? 2 : 0) });
  };
  for (const [tag] of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::url)?["'][^>]*>/gi)) {
    const m = tag.match(/content=["']([^"']+)["']/i);
    if (m) add(m[1], 3);
  }
  for (const [tag] of html.matchAll(/<img[^>]+>/gi)) {
    const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1] ?? '';
    // Prefer the largest candidate in srcset, then data-src (lazy loading), then src.
    const srcset = tag.match(/(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    const fromSet = srcset?.split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).at(-1);
    const src = fromSet || tag.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:jpe?g|webp|png|avif)[^"']*)["']/i)?.[1];
    if (src) add(src, 1, alt);
  }
  // Background images in inline styles are common for hero banners.
  for (const [, src] of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+\.(?:jpe?g|webp|png|avif)[^'")]*)/gi)) add(src, 2);
  return found;
}

// Reads the home page plus the private dining page (from email_sources), ranks
// the photos and drops duplicates.
async function collectPhotos(venue) {
  const pages = [
    [venue.website, 0],
    ...(venue.email_sources ?? []).filter((u) => /private|event|dining|group/i.test(u)).slice(0, 1).map((u) => [u, 1]),
  ];
  const results = await Promise.allSettled(pages.map(([u, bonus]) => scrapePhotos(u, bonus)));
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!all.length) {
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const best = new Map();
  for (const p of all) if (!best.has(p.url) || best.get(p.url) < p.score) best.set(p.url, p.score);
  return [...best].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 10);
}

const inflight = new Map();
const PHOTO_VERSION = 2; // bump to ignore photos cached by an older picker

async function photosFor(venue) {
  const curated = [venue.cover_image, ...(venue.photos ?? [])].filter(Boolean);
  if (curated.length) return curated;
  const cached = await getCachedPhotos(venue.id).catch(() => null);
  if (cached?.v === PHOTO_VERSION && Date.now() - cached.at < 7 * 864e5) return cached.photos;
  if (!venue.website) return [];
  if (!inflight.has(venue.id)) {
    inflight.set(
      venue.id,
      collectPhotos(venue)
        .then(async (photos) => {
          // A failed cache write (e.g. no Redis on Vercel) must not lose the photos.
          if (photos.length) {
            await setCachedPhotos(venue.id, { v: PHOTO_VERSION, at: Date.now(), photos }).catch((err) =>
              console.warn(`Could not cache photos for ${venue.name}: ${err.message}`),
            );
          }
          return photos;
        })
        .catch((err) => {
          // Not cached, so the next page load tries again.
          console.warn(`Could not read photos for ${venue.name}: ${err.message}`);
          return [];
        })
        .finally(() => inflight.delete(venue.id)),
    );
  }
  return inflight.get(venue.id);
}

/* ---------- Routes ---------- */

const app = express();
app.use(express.json({ limit: '200kb' }));

// Diagnostics: open /api/health in a browser to see whether tracking can be saved.
app.get('/api/health', async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ...(await storeHealth()),
    deployment: {
      env: process.env.VERCEL_ENV ?? 'local',
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
  });
});

app.get('/api/venues', async (_req, res, next) => {
  try {
    const outreach = await getAllOutreach();
    res.json(
      venues.map((v) => ({
        ...v,
        outreach: outreach[v.id] ?? { status: 'not_contacted', history: [] },
      })),
    );
  } catch (err) {
    next(err);
  }
});

app.get('/api/photos/:id', async (req, res, next) => {
  try {
    const venue = findVenue(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Unknown venue' });
    res.set('Cache-Control', 'no-cache').json({ photos: await photosFor(venue) });
  } catch (err) {
    next(err);
  }
});

// Outreach: the browser computes the new entry for a venue and saves it whole.
// Everything is sanitised here so bad input can't corrupt the store.
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined);

function cleanEntry(input) {
  const e = input && typeof input === 'object' ? input : {};
  const cover = str(e.cover, 2000);
  const history = (Array.isArray(e.history) ? e.history : []).slice(-200).map((h) => ({
    type: ['email', 'bulk', 'sent', 'status', 'note'].includes(h?.type) ? h.type : 'note',
    at: iso(h?.at) ?? new Date().toISOString(),
    ...(h?.to !== undefined && { to: Array.isArray(h.to) ? h.to.map((t) => str(t, 200)).filter(Boolean).slice(0, 50) : str(h.to, 40) }),
    ...(h?.from !== undefined && { from: str(h.from, 40) }),
    ...(h?.subject !== undefined && { subject: str(h.subject, 300) }),
    ...(h?.note !== undefined && { note: str(h.note, 1000) }),
    ...(h?.count !== undefined && { count: Number(h.count) || 0 }),
  }));
  return {
    status: STATUSES.includes(e.status) ? e.status : 'not_contacted',
    history,
    favourite: e.favourite === true || undefined,
    lastContactedAt: iso(e.lastContactedAt),
    sentAt: iso(e.sentAt),
    cover: cover && /^https?:\/\/\S+$/.test(cover) ? cover : undefined,
    updatedAt: iso(e.updatedAt) ?? new Date().toISOString(),
  };
}

app.put('/api/outreach/:id', async (req, res, next) => {
  try {
    if (!findVenue(req.params.id)) return res.status(404).json({ error: 'Unknown venue' });
    const outreach = await updateOutreach(req.params.id, (entry) => {
      for (const k of Object.keys(entry)) delete entry[k];
      Object.assign(entry, cleanEntry(req.body?.entry));
    });
    res.json({ ok: true, outreach });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

export default app;
