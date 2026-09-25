const STATUSES = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  replied: 'Replied',
  shortlisted: 'Shortlisted',
  declined: 'Declined',
  booked: 'Booked',
};

const DEFAULT_SETTINGS = {
  senderName: '',
  senderTitle: '',
  senderPhone: '',
  gmailAccount: '',
  guests: '15 to 20',
  date: '',
  timing: 'Evening, from around 7pm',
  budget: '',
  subject: 'Private dining enquiry for {{guests}} guests | Impact Analytics',
  body: `Hello {{venue}} events team,

I'm writing from Impact Analytics about a private event we're planning in London:

* Event: Seated dinner in a private space, opening with cocktails
* Guests: 15–20
* Space: Private dining room + terrace
* Group: Senior Executives

Could you please get back to me on the following?
1. Availability on the date and times above
2. Which room you'd put us in, whether it's fully private, and what else would be running alongside it
3. Confirmation that the space seats this many guests comfortably in this format, not at capacity
4. The food & beverage minimum for that space on that date
5. Food and drink formats you'd recommend at this headcount
6. Beverage packages, including a substantial non-alcoholic selection
7. Dietary accommodation — expect vegetarian, vegan, halal, and gluten-free guests
8. All other charges — room/facility fee, service charge, administrative fee, tax, staffing, coat check, AV, overtime — so we can compare venues on a genuine all-in figure
9. Deposit schedule, payment terms, and cancellation policy

If that date is already committed, I'd still welcome the minimum and fee structure — we have some flexibility. A PDF pack or a call both work, whichever is easier for you.

Best regards,
Garvit Sindhwani
Impact Analytics`,
};

const SETTINGS_KEY = 'london-venue-settings-v3';
// Carry personal details over from the previous version, but not its old email wording.
(function migrateSettings() {
  try {
    if (localStorage.getItem(SETTINGS_KEY)) return;
    const old = JSON.parse(localStorage.getItem('london-venue-settings-v2') || 'null');
    if (!old) return;
    delete old.subject;
    delete old.body;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(old));
  } catch { /* storage unavailable */ }
})();
const LOCAL_KEY = 'london-venue-outreach-v1';
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  status: 'all', // status chip, or 'favourites'
  query: '',
  sort: 'popular',
  stars: 0,
  guestMin: null,
  guestMax: null,
  priceMax: 300,
  selected: new Set(),
  bulkMode: false, // selection mode switched on from the toolbar
  queue: [], // venues left in an "email one by one" run
  localOnly: false, // true when the server could not save tracking
};
let venues = [];

/* ---------- Icons ---------- */

const ICON = {
  mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.7.5 2.8 2 3 4.4"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>',
  pound: '<path d="M16 6.5A3.8 3.8 0 0 0 9.2 8.8V19M6.5 13h7M6.5 19H17"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 8"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- Helpers ---------- */

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJSON(SETTINGS_KEY, {}) });
const saveSettings = (s) => writeJSON(SETTINGS_KEY, s);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const recipientFor = (v) => v.rfp_to || v.email_private_dining || v.email_general || '';
const initials = (name) => name.replace(/^(The|Restaurant)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
const starCount = (v) => Number((v.michelin || '').match(/(\d)\s*Michelin/i)?.[1] || 0);
const byId = (id) => venues.find((v) => v.id === id);

function fitLevel(v) {
  const f = (v.fit_15_20 || '').toLowerCase();
  if (f.startsWith('yes')) return ['good', 'Fits 15–20'];
  if (f.startsWith('no')) return ['bad', 'Too small for 15–20'];
  if (f.startsWith('likely')) return ['good', 'Likely fits 15–20'];
  if (f.includes('buyout') || f.includes('exclusive')) return ['warn', 'Needs exclusive hire'];
  if (f.startsWith('up to 16')) return ['warn', 'Up to 16 in private room'];
  return ['warn', 'Capacity to confirm'];
}

function guestsLabel(v) {
  if (v.capacity_max == null) return 'Group size to confirm';
  return v.capacity_min ? `Hosts ${v.capacity_min}–${v.capacity_max}` : `Hosts up to ${v.capacity_max}`;
}

function fill(template, venue, s) {
  const values = {
    venue: venue.name,
    room: venue.room || 'your private dining room',
    guests: s.guests || '15 to 20',
    date: s.date || 'flexible, and we would love to hear your availability',
    timing: s.timing || 'evening',
    budget: s.budget || 'open to your recommendations',
    senderName: s.senderName || 'Impact Analytics Events Team',
    senderTitle: s.senderTitle || '',
    senderPhone: s.senderPhone || '',
  };
  return template
    .replace(/^\{\{(\w+)\}\}\n/gm, (m, k) => (values[k] === '' ? '' : m)) // drop blank signature lines
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function gmailLink({ to = '', bcc = '', subject, body }) {
  const s = loadSettings();
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  if (bcc) params.set('bcc', bcc);
  if (s.gmailAccount) params.set('authuser', s.gmailAccount);
  return `https://mail.google.com/mail/?${params}`;
}

function gmailUrl(v) {
  const s = loadSettings();
  return gmailLink({ to: recipientFor(v).replace(/\s+/g, ''), subject: fill(s.subject, v, s), body: fill(s.body, v, s) });
}

// One email to several venues: everyone in BCC, with venue-neutral wording.
function bulkGmailUrl(list) {
  const s = loadSettings();
  const generic = { name: 'your restaurant', room: 'a private dining room' };
  const body = fill(s.body.replace(/^(Hello|Dear|Hi) \{\{venue\}\}[^\n]*,/, 'Hello,'), generic, s);
  const bcc = [...new Set(list.flatMap((v) => recipientFor(v).split(',')).map((e) => e.trim()).filter(Boolean))].join(',');
  return gmailLink({ bcc, subject: fill(s.subject, generic, s), body });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- Outreach tracking ---------- */
// Every change updates the page immediately, then saves to the server. If the
// server can't save (e.g. no database connected on Vercel), the change is kept
// in this browser instead, and re-sent to the server on the next visit.

const blankEntry = () => ({ status: 'not_contacted', history: [] });

function change(v, mutate) {
  const entry = structuredClone(v.outreach);
  const now = new Date().toISOString();
  mutate(entry, now);
  entry.updatedAt = now;
  v.outreach = entry;
  render();
  return persist(v);
}

async function persist(v) {
  // Read the browser copy only after the request, so parallel saves don't overwrite each other.
  try {
    const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, { method: 'PUT', body: { entry: v.outreach } });
    v.outreach = { ...blankEntry(), ...r.outreach };
    const local = readJSON(LOCAL_KEY, {});
    if (local[v.id]) { delete local[v.id]; writeJSON(LOCAL_KEY, local); }
    if (state.localOnly && !Object.keys(local).length) { state.localOnly = false; renderProgress(); }
  } catch {
    const local = readJSON(LOCAL_KEY, {});
    local[v.id] = v.outreach;
    writeJSON(LOCAL_KEY, local);
    if (!state.localOnly) { state.localOnly = true; renderProgress(); }
  }
}

function markEmailed(v, to, subject, type = 'email') {
  return change(v, (e, at) => {
    if (e.status === 'not_contacted') e.status = 'contacted';
    e.lastContactedAt = at;
    e.history.push({ type, at, to: to.split(',').map((x) => x.trim()).filter(Boolean), subject });
  });
}

function emailOne(v) {
  const s = loadSettings();
  markEmailed(v, recipientFor(v), fill(s.subject, v, s));
  toast(recipientFor(v)
    ? `Gmail draft opened for ${v.name}. Press Send in Gmail, then tap “Mark sent”.`
    : `${v.name} has no public email. Add the address in Gmail before sending.`);
}

function toggleSent(v) {
  const wasSent = Boolean(v.outreach.sentAt);
  change(v, (e, at) => {
    if (wasSent) {
      delete e.sentAt;
      e.history.push({ type: 'note', at, note: 'Unmarked as sent' });
    } else {
      e.sentAt = at;
      e.lastContactedAt ??= at;
      if (e.status === 'not_contacted') e.status = 'contacted';
      e.history.push({ type: 'sent', at });
    }
  });
  toast(wasSent ? `${v.name} unmarked as sent` : `${v.name} marked as sent`);
}

function toggleFav(v, btn) {
  const on = !v.outreach.favourite;
  change(v, (e) => { if (on) e.favourite = true; else delete e.favourite; });
  if (on) document.querySelector(`.card[data-id="${v.id}"] .fav-btn`)?.classList.add('pop');
  toast(on ? `${v.name} added to favourites` : `${v.name} removed from favourites`);
}

/* ---------- Photos ---------- */
// Order: your own override → curated URLs in venues.json → photos the server
// read from the venue's website → the website's share image via Microlink.

const photoCache = new Map();
const microlink = (url) => `https://api.microlink.io/?url=${encodeURIComponent(url)}&embed=image.url`;

function photosFor(v) {
  if (v.outreach.cover) return Promise.resolve([v.outreach.cover]);
  const curated = [v.cover_image, ...(v.photos || [])].filter(Boolean);
  if (curated.length) return Promise.resolve(curated);
  if (!photoCache.has(v.id)) {
    photoCache.set(
      v.id,
      api(`/api/photos/${encodeURIComponent(v.id)}`)
        .then((r) => r.photos)
        .catch(() => [])
        .then((p) => (p.length ? p : v.website ? [microlink(v.website)] : [])),
    );
  }
  return photoCache.get(v.id);
}

// Tries each URL in turn until one loads. Returns the <img> or null.
const loadedSrc = new Map(); // venue id → URL that worked, so re-renders don't flicker
function loadInto(container, urls, alt, key) {
  return new Promise((resolve) => {
    const tryAt = (i) => {
      if (i >= urls.length) return resolve(null);
      const img = new Image();
      img.alt = alt;
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth < 120) return tryAt(i + 1); // skip tracking pixels and icons
        container.querySelector(':scope > img')?.remove();
        container.prepend(img);
        if (key) loadedSrc.set(key, urls[i]);
        requestAnimationFrame(() => img.classList.add('loaded'));
        resolve(img);
      };
      img.onerror = () => tryAt(i + 1);
      img.src = urls[i];
    };
    tryAt(0);
  });
}

function hydrateCovers() {
  for (const el of document.querySelectorAll('.cover[data-id]')) {
    const v = byId(el.dataset.id);
    const known = loadedSrc.get(v.id);
    photosFor(v).then((urls) => {
      if (el.isConnected) loadInto(el, known ? [known, ...urls] : urls, v.name, v.id);
    });
  }
}

/* ---------- Filtering & sorting ---------- */

function matches(v) {
  const o = v.outreach;
  if (state.status === 'favourites' ? !o.favourite : state.status !== 'all' && o.status !== state.status) return false;
  if (state.stars && starCount(v) !== state.stars) return false;
  // Guests: the venue must be able to seat the whole requested range (unknown capacity stays in).
  if (state.guestMin && v.capacity_max != null && v.capacity_max < state.guestMin) return false;
  if (state.guestMax && v.capacity_min != null && v.capacity_min > state.guestMax) return false;
  if (state.guestMax && v.capacity_max != null && v.capacity_max < state.guestMax) return false;
  if (state.priceMax < 300 && v.price_min > state.priceMax) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    if (![v.name, v.area, v.cuisine, v.chef, v.michelin].join(' ').toLowerCase().includes(q)) return false;
  }
  return true;
}

const SORTS = {
  popular: (a, b) => b.popularity - a.popularity,
  'price-desc': (a, b) => b.price_max - a.price_max || b.price_min - a.price_min,
  'price-asc': (a, b) => a.price_min - b.price_min || a.price_max - b.price_max,
  stars: (a, b) => starCount(b) - starCount(a) || b.popularity - a.popularity,
  capacity: (a, b) => (b.capacity_max ?? -1) - (a.capacity_max ?? -1),
  name: (a, b) => a.name.localeCompare(b.name),
};

function activeFilterCount() {
  return (state.stars ? 1 : 0) + (state.guestMin || state.guestMax ? 1 : 0) + (state.priceMax < 300 ? 1 : 0);
}

/* ---------- Rendering ---------- */

function animateNumber(el, to) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  if (from === to) { el.textContent = to; return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 450);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderProgress() {
  const count = (fn) => venues.filter(fn).length;
  const reached = count((v) => v.outreach.status !== 'not_contacted');
  const sent = count((v) => v.outreach.sentAt);
  const pct = venues.length ? Math.round((reached / venues.length) * 100) : 0;
  const box = $('#progress');
  if (!box.dataset.ready) {
    box.dataset.ready = '1';
    box.innerHTML = `
      <div class="progress-head">
        <div class="big"><span data-n="reached">0</span><small> / ${venues.length}</small></div>
        <button type="button" class="reset-btn" id="resetTracking" title="Clear contacted, sent and status marks">${icon('reset')}Reset</button>
      </div>
      <div class="label">venues contacted · <span data-n="sent">0</span> marked sent</div>
      <div class="bar"><span></span></div>
      <div class="mini-stats">
        <div><b data-n="replied">0</b><span>Replied</span></div>
        <div><b data-n="booked">0</b><span>Booked</span></div>
        <div><b data-n="todo">0</b><span>To contact</span></div>
      </div>
      <div class="local-note" hidden>Tracking is saved in this browser only. Connect Upstash Redis in Vercel to share it with the team.</div>`;
  }
  animateNumber($('[data-n=reached]', box), reached);
  animateNumber($('[data-n=sent]', box), sent);
  animateNumber($('[data-n=replied]', box), count((v) => ['replied', 'shortlisted'].includes(v.outreach.status)));
  animateNumber($('[data-n=booked]', box), count((v) => v.outreach.status === 'booked'));
  animateNumber($('[data-n=todo]', box), venues.length - reached);
  $('.bar span', box).style.width = `${pct}%`;
  $('.local-note', box).hidden = !state.localOnly;
}

function renderChips() {
  const favs = venues.filter((v) => v.outreach.favourite).length;
  const opts = [['all', 'All'], ...Object.entries(STATUSES)];
  $('#statusFilter').innerHTML =
    opts.map(([k, l]) => {
      const n = k === 'all' ? venues.length : venues.filter((v) => v.outreach.status === k).length;
      if (k !== 'all' && k !== 'not_contacted' && k !== 'contacted' && !n && state.status !== k) return '';
      return `<button class="chip" role="tab" data-filter="${k}" aria-selected="${state.status === k}">${l} <b>${n}</b></button>`;
    }).join('') +
    `<button class="chip fav" role="tab" data-filter="favourites" aria-selected="${state.status === 'favourites'}"><span class="heart">♥</span> Favourites <b>${favs}</b></button>`;
  const n = activeFilterCount();
  $('#filterCount').hidden = !n;
  $('#filterCount').textContent = n;
}

function starsBadge(v) {
  const n = starCount(v);
  return n ? `<span class="stars"><span class="s">${'✱'.repeat(n)}</span>${n} Michelin star${n > 1 ? 's' : ''}</span>` : '';
}

function cardHtml(v, i) {
  const o = v.outreach;
  const st = o.status;
  const to = recipientFor(v);
  const [fitCls, fitText] = fitLevel(v);
  const sel = state.selected.has(v.id);
  const cls = ['card', o.sentAt ? 'sent' : st !== 'not_contacted' ? 'contacted' : '', sel ? 'selected' : ''].join(' ');
  const ribbon = o.sentAt
    ? `<span class="sent-ribbon">${icon('check')}Sent ${fmtDay(o.sentAt)}</span>`
    : st !== 'not_contacted' ? `<span class="sent-ribbon draft">${icon('mail')}Contacted</span>` : '';
  const statusLine = o.sentAt
    ? `<div class="status-line sent">${icon('check')}Sent ${fmtDate(o.sentAt)}</div>`
    : o.lastContactedAt ? `<div class="status-line">${icon('mail')}Gmail draft opened ${fmtDate(o.lastContactedAt)} · not yet marked sent</div>` : '';
  return `
    <article class="${cls}" data-id="${esc(v.id)}" style="animation-delay:${Math.min(i, 8) * 40}ms">
      ${ribbon}
      <div class="cover" data-id="${esc(v.id)}" data-action="details">
        <div class="monogram">${esc(initials(v.name))}</div>
        <div class="top">
          <div class="top-left">
            <button class="sel-btn ${sel ? 'on' : ''}" data-action="select" aria-pressed="${sel}" title="Select for bulk RFP">${sel ? icon('check') : ''}</button>
            <span class="pill ${st}">${STATUSES[st]}</span>
          </div>
          <button class="fav-btn ${o.favourite ? 'on' : ''}" data-action="fav" aria-pressed="${Boolean(o.favourite)}" title="Favourite">${icon('heart')}</button>
        </div>
        <div class="bottom"><span class="where">${icon('pin')}${esc(v.area)}</span>${starsBadge(v)}</div>
      </div>
      <div class="card-body">
        <div>
          <h3 data-action="details">${esc(v.name)}</h3>
          <div class="sub">${esc(v.cuisine)}${v.chef ? ' · ' + esc(v.chef.split(/[;(]/)[0].trim()) : ''}</div>
        </div>
        <p class="blurb">${esc(v.speciality)}</p>
        <div class="facts-row">
          <span class="fact ${fitCls}">${icon(fitCls === 'bad' ? 'alert' : 'users')}${fitText}</span>
          <span class="fact">${icon('users')}${guestsLabel(v)}</span>
          <span class="fact">${icon('pound')}${v.price_min === v.price_max ? `£${v.price_min}` : `£${v.price_min}–£${v.price_max}`} pp</span>
        </div>
        <div class="card-foot">
          <div class="to ${to ? '' : 'missing'}">${icon(to ? 'mail' : 'phone')}<span>${to ? esc(to.split(',')[0]) + (to.includes(',') ? ' + 1 more' : '') : 'No public email · call ' + esc(v.phone)}</span></div>
          <div class="actions">
            <a class="btn primary" data-action="gmail" href="${esc(gmailUrl(v))}" target="_blank" rel="noopener">${icon('mail')}${st === 'not_contacted' ? 'Email via Gmail' : 'Email again'}</a>
            <button class="btn ghost sent-btn ${o.sentAt ? 'on' : ''}" data-action="sent" aria-pressed="${Boolean(o.sentAt)}" title="${o.sentAt ? 'Click to undo' : 'Mark as sent'}">${icon('check')}${o.sentAt ? 'Sent' : 'Mark sent'}</button>
            <button class="btn ghost icon-only details-btn" data-action="details" title="Details" aria-label="Details">${icon('more')}</button>
          </div>
          ${statusLine}
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const list = venues.filter(matches).sort(SORTS[state.sort]);
  $('#grid').innerHTML = list.length
    ? list.map(cardHtml).join('')
    : '<p class="empty">No venues match these filters. <button class="link-btn" data-clear>Clear filters</button></p>';
  $('#resultCount').textContent = `Showing ${list.length} of ${venues.length}`;
  hydrateCovers();
}

function renderBulk() {
  const bar = $('#bulkBar');
  const sel = venues.filter((v) => state.selected.has(v.id));
  const active = state.bulkMode || sel.length > 0 || state.queue.length > 0;
  bar.hidden = !active;
  document.body.classList.toggle('has-bulk', active);
  document.body.classList.toggle('selecting', active);
  $('#bulkToggle').setAttribute('aria-pressed', active);
  if (!active) return;

  if (state.queue.length) {
    const next = byId(state.queue[0]);
    const done = state.queueTotal - state.queue.length;
    $('#bulkCount').textContent = `Emailing one by one · ${done} of ${state.queueTotal} done`;
    $('#bulkActions').innerHTML = `
      <span class="queue">Next: ${esc(next.name)}</span>
      <a class="btn primary" data-bulk="next" href="${esc(gmailUrl(next))}" target="_blank" rel="noopener">${icon('mail')}Open Gmail for ${esc(next.name)}</a>
      <button class="btn ghost" data-bulk="skip">Skip</button>
      <button class="btn ghost" data-bulk="stop">Stop</button>`;
    return;
  }

  const withEmail = sel.filter((v) => recipientFor(v));
  $('#bulkCount').textContent = sel.length ? `${sel.length} selected` : 'Tick venues to include';
  if (!sel.length) { $('#bulkActions').innerHTML = ''; return; }
  $('#bulkActions').innerHTML = `
    <a class="btn primary" data-bulk="bcc" href="${esc(bulkGmailUrl(withEmail))}" target="_blank" rel="noopener" ${withEmail.length ? '' : 'aria-disabled="true"'}>${icon('send')}One Gmail to all ${withEmail.length} (BCC)</a>
    <button class="btn ghost" data-bulk="queue">${icon('mail')}Personalised, one by one</button>
    <button class="btn ghost" data-bulk="sent">${icon('check')}Mark all sent</button>`;
}

function render() {
  renderProgress();
  renderChips();
  renderGrid();
  renderBulk();
}

/* ---------- Details ---------- */

function link(url, label) {
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || url)}</a>` : '';
}

function timelineHtml(h) {
  if (!h.length) return '<p class="muted" style="margin-top:12px">No activity yet.</p>';
  return `<ul class="timeline">${[...h].reverse().map((e) => {
    let text = '';
    if (e.type === 'email') text = `Gmail draft opened to ${esc([].concat(e.to).join(', ') || 'no address')}`;
    else if (e.type === 'bulk') text = `Included in a bulk RFP (BCC)`;
    else if (e.type === 'sent') text = 'Marked as sent';
    else if (e.type === 'status') text = `Marked as ${esc(STATUSES[e.to])}`;
    else text = esc(e.note);
    return `<li><time>${fmtDate(e.at)}</time>${text}</li>`;
  }).join('')}</ul>`;
}

function kv(rows) {
  const shown = rows.filter(([, val]) => val && String(val).trim());
  return shown.length ? `<dl class="kv">${shown.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>` : '';
}

let openVenueId = null;

function drawDetails() {
  const v = byId(openVenueId);
  if (!v || !$('#detailDlg').open) return;
  const [, fitText] = fitLevel(v);
  const o = v.outreach;
  $('#detailBody').innerHTML = `
    <div class="sheet-hero" id="dHero">
      <div class="monogram">${esc(initials(v.name))}</div>
      <button class="icon-btn close" data-close aria-label="Close">${icon('x')}</button>
      <div class="title"><h2>${esc(v.name)}</h2><p>${esc(v.address)}</p></div>
    </div>
    <div class="thumbs" id="dThumbs"></div>
    <div class="sheet-body">
      <div class="cta-row">
        <a class="btn primary" data-d="gmail" href="${esc(gmailUrl(v))}" target="_blank" rel="noopener">${icon('mail')}Email via Gmail</a>
        <button class="btn ghost sent-btn ${o.sentAt ? 'on' : ''}" data-d="sent">${icon('check')}${o.sentAt ? 'Sent' : 'Mark sent'}</button>
        <button class="btn ghost" data-d="fav">${icon('heart')}${o.favourite ? 'Favourited' : 'Favourite'}</button>
        ${v.website ? `<a class="btn ghost" href="${esc(v.website)}" target="_blank" rel="noopener">${icon('ext')}Website</a>` : ''}
        ${v.menu_url ? `<a class="btn ghost" href="${esc(v.menu_url)}" target="_blank" rel="noopener">${icon('ext')}Menu</a>` : ''}
        ${v.phone ? `<a class="btn ghost" href="tel:${esc(v.phone.replace(/\s/g, ''))}">${icon('phone')}${esc(v.phone)}</a>` : ''}
      </div>

      <div class="glance">
        <div><span>Michelin</span><b>${esc(v.michelin || '—')}</b></div>
        <div><span>For 15–20 guests</span><b>${esc(fitText)}</b></div>
        <div><span>Guests</span><b>${esc(guestsLabel(v))}</b></div>
        <div><span>Price per head</span><b>£${v.price_min}${v.price_max !== v.price_min ? `–£${v.price_max}` : ''}</b></div>
      </div>

      <div class="section">
        <h4>Outreach</h4>
        <div class="status-row">${Object.entries(STATUSES).map(([k, l]) => `<button class="chip" data-status="${k}" aria-pressed="${o.status === k}">${l}</button>`).join('')}</div>
        <form class="inline-form" id="dNoteForm" style="margin-top:12px">
          <input id="dNote" placeholder="Add a note, e.g. spoke to Sarah, proposal due Friday">
          <button class="btn ghost sm">Add note</button>
        </form>
        ${timelineHtml(o.history)}
      </div>

      <div class="section"><h4>About</h4><p>${esc(v.speciality)}</p></div>

      <div class="section">
        <h4>Contact</h4>
        ${kv([
          ['Private dining', v.email_private_dining ? link('mailto:' + v.email_private_dining, v.email_private_dining) : ''],
          ['General', v.email_general ? link('mailto:' + v.email_general, v.email_general) : ''],
          ['Note', esc(v.email_note)],
          ['Source', (v.email_sources || []).map((u) => link(u, new URL(u).hostname + new URL(u).pathname)).join('<br>')],
          ['Instagram', v.instagram ? link(`https://instagram.com/${v.instagram.replace('@', '')}`, v.instagram) : ''],
        ])}
      </div>

      <div class="section">
        <h4>Food</h4>
        ${kv([
          ['Chef', esc(v.chef)],
          ['Cuisine', esc(v.cuisine)],
          ['Signature dishes', esc(v.signature_dishes)],
          ['Menus', esc(v.menu_summary)],
        ])}
      </div>

      <div class="section">
        <h4>Private dining</h4>
        ${kv([
          ['Rooms', esc(v.private_dining)],
          ['Seated', esc(v.capacity_seated)],
          ['Standing', esc(v.capacity_standing)],
          ['For 15–20', esc(v.fit_15_20)],
          ['Notes', esc(v.notes)],
        ])}
      </div>

      <div class="section">
        <h4>Cover photo</h4>
        <form class="inline-form" id="dCoverForm">
          <input id="dCover" type="url" placeholder="Paste an image URL to use as the cover" value="${esc(o.cover || '')}">
          <button class="btn ghost sm">${icon('image')}Save</button>
        </form>
      </div>
    </div>`;

  photosFor(v).then(async (urls) => {
    const hero = $('#dHero');
    if (!hero) return;
    const known = loadedSrc.get(v.id);
    await loadInto(hero, known ? [known, ...urls] : urls, v.name);
    const thumbs = $('#dThumbs');
    if (urls.length > 1 && thumbs) {
      thumbs.innerHTML = urls.map((u, i) => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" data-i="${i}" onerror="this.remove()">`).join('');
      thumbs.onclick = (e) => {
        const i = e.target.dataset?.i;
        if (i !== undefined) loadInto(hero, [urls[i]], v.name);
      };
    }
  });
}

function openDetails(v) {
  openVenueId = v.id;
  $('#detailDlg').showModal();
  drawDetails();
  $('#detailDlg').scrollTop = 0;
}

$('#detailDlg').addEventListener('click', (e) => {
  const dlg = e.currentTarget;
  if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
  const v = byId(openVenueId);
  const d = e.target.closest('[data-d]')?.dataset.d;
  if (d === 'gmail') return setTimeout(() => { emailOne(v); drawDetails(); });
  if (d === 'sent') toggleSent(v);
  if (d === 'fav') toggleFav(v);
  const st = e.target.closest('[data-status]')?.dataset.status;
  if (st && st !== v.outreach.status) {
    change(v, (en, at) => {
      en.history.push({ type: 'status', at, from: en.status, to: st });
      en.status = st;
      if (st === 'contacted') en.lastContactedAt ??= at;
    });
    toast(`${v.name} marked as ${STATUSES[st]}`);
  }
  if (d || st) drawDetails();
});
$('#detailDlg').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = byId(openVenueId);
  if (e.target.id === 'dNoteForm') {
    const note = $('#dNote').value.trim();
    if (!note) return;
    change(v, (en, at) => en.history.push({ type: 'note', at, note }));
    toast('Note added');
  } else if (e.target.id === 'dCoverForm') {
    const cover = $('#dCover').value.trim();
    photoCache.delete(v.id);
    loadedSrc.delete(v.id);
    change(v, (en) => { if (cover) en.cover = cover; else delete en.cover; });
    toast(cover ? 'Cover photo saved' : 'Cover photo removed');
  }
  drawDetails();
});

/* ---------- Settings ---------- */

function openSettings() {
  const s = loadSettings();
  const form = $('#settingsForm');
  for (const [k, val] of Object.entries(s)) if (form.elements[k]) form.elements[k].value = val;
  $('#settingsDlg').showModal();
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#settingsForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const form = e.target;
  const s = loadSettings();
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (form.elements[k]) s[k] = form.elements[k].value;
  saveSettings(s);
  render(); // refresh the Gmail links
  toast('Email settings saved');
});
$('#resetTpl').addEventListener('click', () => {
  const form = $('#settingsForm');
  form.elements.subject.value = DEFAULT_SETTINGS.subject;
  form.elements.body.value = DEFAULT_SETTINGS.body;
});

/* ---------- Grid, filters & bulk events ---------- */

$('#grid').addEventListener('click', (e) => {
  if (e.target.closest('[data-clear]')) return clearFilters();
  const actionEl = e.target.closest('[data-action]');
  const v = byId(e.target.closest('.card')?.dataset.id);
  if (!v || !actionEl) return;
  const action = actionEl.dataset.action;
  // The link itself opens Gmail; update the page once the browser has followed it.
  if (action === 'gmail') return setTimeout(() => emailOne(v));
  e.preventDefault();
  if (action === 'sent') toggleSent(v);
  else if (action === 'fav') toggleFav(v);
  else if (action === 'select') {
    state.selected.has(v.id) ? state.selected.delete(v.id) : state.selected.add(v.id);
    renderGrid();
    renderBulk();
  } else if (document.body.classList.contains('selecting') && actionEl.classList.contains('cover')) {
    state.selected.has(v.id) ? state.selected.delete(v.id) : state.selected.add(v.id);
    renderGrid();
    renderBulk();
  } else openDetails(v);
});

$('#statusFilter').addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]')?.dataset.filter;
  if (!f) return;
  state.status = f;
  render();
});
$('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); renderGrid(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });

$('#filterToggle').addEventListener('click', (e) => {
  const open = $('#filterPanel').hidden;
  $('#filterPanel').hidden = !open;
  $('.toolbar-wrap').classList.toggle('expanded', open);
  e.currentTarget.setAttribute('aria-expanded', open);
});
$('#starFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stars]');
  if (!b) return;
  state.stars = Number(b.dataset.stars);
  for (const x of $('#starFilter').children) x.setAttribute('aria-pressed', x === b);
  render();
});
const numOrNull = (el) => (el.value ? Math.max(1, Number(el.value)) : null);
for (const id of ['guestMin', 'guestMax']) {
  $(`#${id}`).addEventListener('input', () => {
    state.guestMin = numOrNull($('#guestMin'));
    state.guestMax = numOrNull($('#guestMax'));
    render();
  });
}
$('#guestPreset').addEventListener('click', () => {
  $('#guestMin').value = 15;
  $('#guestMax').value = 20;
  state.guestMin = 15;
  state.guestMax = 20;
  render();
});
$('#priceMax').addEventListener('input', (e) => {
  state.priceMax = Number(e.target.value);
  $('#priceOut').textContent = state.priceMax >= 300 ? 'Any' : `£${state.priceMax}`;
  render();
});

function clearFilters() {
  Object.assign(state, { status: 'all', query: '', stars: 0, guestMin: null, guestMax: null, priceMax: 300 });
  $('#search').value = '';
  $('#guestMin').value = '';
  $('#guestMax').value = '';
  $('#priceMax').value = 300;
  $('#priceOut').textContent = 'Any';
  for (const x of $('#starFilter').children) x.setAttribute('aria-pressed', x.dataset.stars === '0');
  render();
}
$('#clearFilters').addEventListener('click', clearFilters);

$('#bulkBar').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-select]')?.dataset.select;
  if (pick) {
    state.selected = new Set(
      pick === 'none' ? [] : venues.filter((v) => (pick === 'favourites' ? v.outreach.favourite : v.outreach.status === 'not_contacted')).map((v) => v.id),
    );
    if (!state.selected.size && pick !== 'none') toast(pick === 'favourites' ? 'No favourites yet. Tap ♥ on a card.' : 'Every venue has been contacted.');
    return render();
  }
  const btn = e.target.closest('[data-bulk]');
  if (!btn) return;
  const action = btn.dataset.bulk;
  const sel = venues.filter((v) => state.selected.has(v.id));
  // Gmail links must be followed before the bar is redrawn.
  if (btn.tagName === 'A') {
    if (action === 'bcc' && !sel.some((v) => recipientFor(v))) { e.preventDefault(); return toast('None of the selected venues has a public email.'); }
    return setTimeout(() => bulkAction(action, sel));
  }
  bulkAction(action, sel);
});

function bulkAction(action, sel) {

  if (action === 'bcc') {
    const withEmail = sel.filter((v) => recipientFor(v));
    const s = loadSettings();
    const subject = fill(s.subject, { name: 'your restaurant' }, s);
    for (const v of withEmail) markEmailed(v, recipientFor(v), subject, 'bulk');
    const skipped = sel.length - withEmail.length;
    state.selected.clear();
    render();
    toast(`Gmail opened with ${withEmail.length} venues in BCC.${skipped ? ` ${skipped} without an email were skipped.` : ''} Press Send, then “Mark all sent”.`);
  } else if (action === 'queue') {
    state.queue = sel.filter((v) => recipientFor(v)).map((v) => v.id);
    state.queueTotal = state.queue.length;
    state.selected.clear();
    if (!state.queue.length) toast('None of the selected venues has a public email.');
    render();
  } else if (action === 'next') {
    emailOne(byId(state.queue.shift())); // the link opens Gmail
    if (!state.queue.length) toast('All done. Tick “Mark sent” on each card once you have pressed Send in Gmail.');
    renderBulk();
  } else if (action === 'skip') {
    state.queue.shift();
    renderBulk();
  } else if (action === 'stop') {
    state.queue = [];
    renderBulk();
  } else if (action === 'sent') {
    for (const v of sel) if (!v.outreach.sentAt) toggleSent(v);
    state.selected.clear();
    render();
    toast(`${sel.length} venues marked as sent`);
  }
}

// Reset: clears outreach progress for every venue but keeps favourites and cover photos.
$('#progress').addEventListener('click', async (e) => {
  if (!e.target.closest('#resetTracking')) return;
  const touched = venues.filter((v) => v.outreach.status !== 'not_contacted' || v.outreach.sentAt || v.outreach.history.length);
  if (!touched.length) return toast('Nothing to reset yet.');
  if (!confirm(`Reset tracking for ${touched.length} venue${touched.length > 1 ? 's' : ''}?\n\nThis clears Contacted, Sent and status marks, notes and history for everyone using the site. Favourites and cover photos are kept.`)) return;
  Object.assign(state, { queue: [] });
  await Promise.all(touched.map((v) => change(v, (en) => {
    en.status = 'not_contacted';
    en.history = [];
    delete en.sentAt;
    delete en.lastContactedAt;
  })));
  toast(`Tracking reset for ${touched.length} venue${touched.length > 1 ? 's' : ''}`);
});

$('#bulkToggle').addEventListener('click', () => {
  state.bulkMode = !(state.bulkMode || state.selected.size);
  if (!state.bulkMode) state.selected.clear();
  else toast('Tick the venues to include, or use the quick picks in the bar below.');
  render();
});
$('#bulkClose').addEventListener('click', () => {
  Object.assign(state, { bulkMode: false, queue: [] });
  state.selected.clear();
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    $('#search').focus();
  }
});

/* ---------- Boot ---------- */

(async function init() {
  try {
    const list = await api('/api/venues');
    const local = readJSON(LOCAL_KEY, {});
    venues = list.map((v) => {
      const server = { ...blankEntry(), ...v.outreach };
      const mine = local[v.id];
      const newer = mine && (!server.updatedAt || mine.updatedAt > server.updatedAt);
      return { ...v, outreach: newer ? mine : server };
    });
    render();
    // Re-send anything that only reached this browser last time.
    const pending = venues.filter((v) => local[v.id]);
    if (pending.length) {
      state.localOnly = true;
      renderProgress();
      pending.forEach(persist);
    }
  } catch (e) {
    $('#grid').innerHTML = `<p class="empty">Could not load venues: ${esc(e.message)}</p>`;
  }
})();
