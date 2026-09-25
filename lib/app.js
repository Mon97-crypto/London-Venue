// The API. Mounted by server.js locally and by api/index.js on Vercel.
import express from 'express';
import venues from '../data/venues.json' with { type: 'json' };
import { getAllOutreach, updateOutreach, getCachedPhotos, setCachedPhotos } from './store.js';

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

async function scrapePhotos(url) {
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
  const html = await res.text();
  const found = [];
  const meta = html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::url)?["'][^>]*>/gi);
  for (const [tag] of meta) {
    const m = tag.match(/content=["']([^"']+)["']/i);
    if (m) found.push(m[1]);
  }
  for (const [tag] of html.matchAll(/<img[^>]+>/gi)) {
    const m = tag.match(/(?:data-src|src)=["']([^"']+\.(?:jpe?g|webp|png)[^"']*)["']/i);
    if (m && !/logo|icon|sprite|favicon|badge|michelin/i.test(m[1])) found.push(m[1]);
  }
  return [...new Set(found.map((s) => absolutise(s, res.url)).filter(Boolean))].slice(0, 8);
}

const inflight = new Map();

async function photosFor(venue) {
  const curated = [venue.cover_image, ...(venue.photos ?? [])].filter(Boolean);
  if (curated.length) return curated;
  const cached = await getCachedPhotos(venue.id);
  if (cached && Date.now() - cached.at < 7 * 864e5) return cached.photos;
  if (!venue.website) return [];
  if (!inflight.has(venue.id)) {
    inflight.set(
      venue.id,
      scrapePhotos(venue.website)
        .then(async (photos) => {
          // A failed cache write (e.g. no Redis on Vercel) must not lose the photos.
          if (photos.length) {
            await setCachedPhotos(venue.id, { at: Date.now(), photos }).catch((err) =>
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
    res.set('Cache-Control', 'private, max-age=3600').json({ photos: await photosFor(venue) });
  } catch (err) {
    next(err);
  }
});

// Outreach updates: a Gmail draft was opened (`emailed`), a status change
// (e.g. they replied or declined), or a free-text note.
app.post('/api/outreach/:id', async (req, res, next) => {
  try {
    const { status, note, emailed, cover } = req.body ?? {};
    if (cover !== undefined && cover !== '' && !/^https?:\/\/\S+$/.test(cover)) {
      return res.status(400).json({ error: 'Cover photo must be an http(s) image URL' });
    }
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!findVenue(req.params.id)) return res.status(404).json({ error: 'Unknown venue' });
    const outreach = await updateOutreach(req.params.id, (entry) => {
      const at = new Date().toISOString();
      if (emailed) {
        if (entry.status === 'not_contacted') entry.status = 'contacted';
        entry.lastContactedAt = at;
        entry.history.push({
          type: 'email',
          at,
          to: String(emailed.to ?? '').split(',').map((e) => e.trim()).filter(Boolean),
          subject: String(emailed.subject ?? '').slice(0, 300),
        });
      }
      if (cover !== undefined) entry.cover = cover || undefined;
      if (status && status !== entry.status) {
        entry.history.push({ type: 'status', at, from: entry.status, to: status });
        entry.status = status;
        if (status === 'contacted') entry.lastContactedAt ??= at;
      }
      if (note?.trim()) entry.history.push({ type: 'note', at, note: note.trim() });
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
