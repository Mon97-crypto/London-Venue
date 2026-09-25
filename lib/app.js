// The API. Mounted by server.js locally and by api/index.js on Vercel.
import express from 'express';
import { Resend } from 'resend';
import venues from '../data/venues.json' with { type: 'json' };
import { getAllOutreach, updateOutreach, getCachedPhotos, setCachedPhotos } from './store.js';

const {
  RESEND_API_KEY,
  FROM_EMAIL = 'Impact Analytics Events <onboarding@resend.dev>',
  REPLY_TO = '',
  BCC_EMAIL = '',
} = process.env;
export const DRY_RUN = process.env.DRY_RUN === '1' || !RESEND_API_KEY;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const STATUSES = ['not_contacted', 'contacted', 'replied', 'shortlisted', 'declined', 'booked'];
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const findVenue = (id) => venues.find((v) => v.id === id);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function textToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LondonVenueBot/1.0)' },
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
          await setCachedPhotos(venue.id, { at: Date.now(), photos });
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

app.get('/api/config', (_req, res) => {
  res.json({ from: FROM_EMAIL, replyTo: REPLY_TO, dryRun: DRY_RUN });
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
    res.set('Cache-Control', 'private, max-age=3600').json({ photos: await photosFor(venue) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/send', async (req, res, next) => {
  try {
    const { venueId, to, subject, body } = req.body ?? {};
    const venue = findVenue(venueId);
    if (!venue) return res.status(404).json({ error: 'Unknown venue' });
    const recipients = String(to ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!recipients.length || !recipients.every((r) => EMAIL_RE.test(r))) {
      return res.status(400).json({ error: 'Enter a valid recipient email address' });
    }
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Subject and body are required' });
    }

    let messageId = null;
    if (DRY_RUN) {
      messageId = `dry-run-${Date.now()}`;
    } else {
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        text: body,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">${textToHtml(body)}</div>`,
        ...(REPLY_TO && { replyTo: REPLY_TO }),
        ...(BCC_EMAIL && { bcc: BCC_EMAIL }),
        tags: [{ name: 'venue', value: venue.id.replace(/[^a-zA-Z0-9_-]/g, '_') }],
      });
      if (error) return res.status(502).json({ error: error.message ?? 'Resend rejected the email' });
      messageId = data?.id ?? null;
    }

    const outreach = await updateOutreach(venue.id, (entry) => {
      const at = new Date().toISOString();
      if (entry.status === 'not_contacted') entry.status = 'contacted';
      entry.lastContactedAt = at;
      entry.history.push({ type: 'email', at, to: recipients, subject, messageId, dryRun: DRY_RUN });
    });
    res.json({ ok: true, dryRun: DRY_RUN, messageId, outreach });
  } catch (err) {
    next(err);
  }
});

// Manual status updates (e.g. you phoned them, they replied, they declined).
app.post('/api/outreach/:id', async (req, res, next) => {
  try {
    const { status, note } = req.body ?? {};
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!findVenue(req.params.id)) return res.status(404).json({ error: 'Unknown venue' });
    const outreach = await updateOutreach(req.params.id, (entry) => {
      const at = new Date().toISOString();
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
