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
  body: `Dear {{venue}} team,

I am reaching out from Impact Analytics, an AI-powered retail analytics company. We are planning a private dinner in London for {{guests}} guests and would love to host it at {{venue}}.

Event details:
- Group size: {{guests}} guests
- Date: {{date}}
- Timing: {{timing}}
- Format: seated private dinner, ideally in {{room}}
- Budget: {{budget}}

Could you please let us know:
1. Whether you can host a group of {{guests}} in a private or semi-private space
2. Your group menus (set or tasting) and price per head, including wine pairing or drinks packages
3. Any minimum spend, room hire fee, service charge and deposit terms
4. Whether we can use a screen or say a few words of welcome during the evening

We would be grateful for a proposal at your earliest convenience. Happy to jump on a call if that is easier.

Kind regards,
{{senderName}}
{{senderTitle}}
Impact Analytics
{{senderPhone}}`,
};

const SETTINGS_KEY = 'london-venue-settings-v2';
const $ = (sel, root = document) => root.querySelector(sel);

let venues = [];
let filter = 'all';
let query = '';

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
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- Helpers ---------- */

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const recipientFor = (v) => v.rfp_to || v.email_private_dining || v.email_general || '';
const initials = (name) => name.replace(/^(The|Restaurant)\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
const starCount = (v) => Number((v.michelin || '').match(/(\d)\s*Michelin/i)?.[1] || 0);

function fitLevel(v) {
  const f = (v.fit_15_20 || '').toLowerCase();
  if (f.startsWith('yes')) return ['good', 'Fits 15–20'];
  if (f.startsWith('no')) return ['bad', 'Too small for 15–20'];
  if (f.startsWith('likely')) return ['good', 'Likely fits 15–20'];
  if (f.includes('buyout') || f.includes('exclusive')) return ['warn', 'Needs exclusive hire'];
  if (f.startsWith('up to 16')) return ['warn', 'Up to 16 in private room'];
  return ['warn', 'Capacity to confirm'];
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

function gmailUrl(v) {
  const s = loadSettings();
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: recipientFor(v).replace(/\s+/g, ''),
    su: fill(s.subject, v, s),
    body: fill(s.body, v, s),
  });
  if (s.gmailAccount) params.set('authuser', s.gmailAccount);
  return `https://mail.google.com/mail/?${params}`;
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

function setOutreach(id, outreach) {
  const v = venues.find((x) => x.id === id);
  if (v) v.outreach = outreach;
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
function loadInto(container, urls, alt) {
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
    const v = venues.find((x) => x.id === el.dataset.id);
    photosFor(v).then((urls) => {
      if (el.isConnected) loadInto(el, urls, v.name);
    });
  }
}

/* ---------- Rendering ---------- */

function renderProgress() {
  const count = (st) => venues.filter((v) => v.outreach.status === st).length;
  const reached = venues.length - count('not_contacted');
  const pct = venues.length ? Math.round((reached / venues.length) * 100) : 0;
  $('#progress').innerHTML = `
    <div class="big">${reached}<small> / ${venues.length}</small></div>
    <div class="label">venues contacted</div>
    <div class="bar"><span style="width:${pct}%"></span></div>
    <div class="mini-stats">
      <div><b>${count('replied') + count('shortlisted')}</b><span>Replied</span></div>
      <div><b>${count('booked')}</b><span>Booked</span></div>
      <div><b>${count('not_contacted')}</b><span>To contact</span></div>
    </div>`;
}

function renderFilters() {
  const opts = [['all', 'All'], ...Object.entries(STATUSES)];
  $('#statusFilter').innerHTML = opts
    .map(([k, l]) => {
      const n = k === 'all' ? venues.length : venues.filter((v) => v.outreach.status === k).length;
      if (k !== 'all' && k !== 'not_contacted' && !n && filter !== k) return '';
      return `<button class="chip" role="tab" data-filter="${k}" aria-selected="${filter === k}">${l} <b>${n}</b></button>`;
    })
    .join('');
}

function starsBadge(v) {
  const n = starCount(v);
  return n ? `<span class="stars"><span class="s">${'✱'.repeat(n)}</span>${n} Michelin star${n > 1 ? 's' : ''}</span>` : '';
}

function cardHtml(v) {
  const st = v.outreach.status;
  const to = recipientFor(v);
  const [fitCls, fitText] = fitLevel(v);
  const emailed = st !== 'not_contacted';
  return `
    <article class="card" data-id="${esc(v.id)}">
      <div class="cover" data-id="${esc(v.id)}" data-action="details">
        <div class="monogram">${esc(initials(v.name))}</div>
        <div class="top"><span class="pill ${st}">${STATUSES[st]}</span>${starsBadge(v)}</div>
        <div class="bottom">${icon('pin')}${esc(v.area)}</div>
      </div>
      <div class="card-body">
        <div>
          <h3 data-action="details">${esc(v.name)}</h3>
          <div class="sub">${esc(v.cuisine)}${v.chef ? ' · ' + esc(v.chef.split(/[;(]/)[0].trim()) : ''}</div>
        </div>
        <p class="blurb">${esc(v.speciality)}</p>
        <div class="facts-row">
          <span class="fact ${fitCls}">${icon(fitCls === 'bad' ? 'alert' : 'users')}${fitText}</span>
          ${v.price_range ? `<span class="fact">${icon('pound')}${esc(v.price_range.replace(/^£/, ''))}</span>` : ''}
        </div>
        <div class="card-foot">
          <div class="to ${to ? '' : 'missing'}">${icon(to ? 'mail' : 'phone')}<span>${to ? esc(to.split(',')[0]) + (to.includes(',') ? ' + 1 more' : '') : 'No public email · call ' + esc(v.phone)}</span></div>
          <div class="actions">
            <a class="btn primary" data-action="gmail" href="${esc(gmailUrl(v))}" target="_blank" rel="noopener">${icon('mail')}${emailed ? 'Email again' : 'Email via Gmail'}</a>
            <button class="btn ghost" data-action="details">Details</button>
          </div>
          ${v.outreach.lastContactedAt ? `<div class="last">Emailed ${fmtDate(v.outreach.lastContactedAt)}</div>` : ''}
        </div>
      </div>
    </article>`;
}

function renderGrid() {
  const q = query.toLowerCase();
  const list = venues.filter((v) => {
    if (filter !== 'all' && v.outreach.status !== filter) return false;
    if (!q) return true;
    return [v.name, v.area, v.cuisine, v.chef, v.michelin].join(' ').toLowerCase().includes(q);
  });
  $('#grid').innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="empty">No venues match this filter.</p>';
  hydrateCovers();
}

function render() {
  renderProgress();
  renderFilters();
  renderGrid();
}

/* ---------- Gmail ---------- */
// The button is a real link to Gmail, so the browser opens it directly with no
// pop-up blocking. Here we only record that the draft was opened.

async function logEmailed(v) {
  const s = loadSettings();
  try {
    const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, {
      method: 'POST',
      body: { emailed: { to: recipientFor(v), subject: fill(s.subject, v, s) } },
    });
    setOutreach(v.id, r.outreach);
    render();
    toast(recipientFor(v)
      ? `Gmail draft opened for ${v.name}. Marked as contacted.`
      : `${v.name} has no public email. Add the address in Gmail before sending.`);
  } catch (e) {
    toast(`Gmail opened, but tracking failed: ${e.message}`);
  }
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
    else if (e.type === 'status') text = `Marked as ${esc(STATUSES[e.to])}`;
    else text = esc(e.note);
    return `<li><time>${fmtDate(e.at)}</time>${text}</li>`;
  }).join('')}</ul>`;
}

function kv(rows) {
  const shown = rows.filter(([, val]) => val && String(val).trim());
  return shown.length ? `<dl class="kv">${shown.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>` : '';
}

function openDetails(v) {
  const [, fitText] = fitLevel(v);
  const dlg = $('#detailDlg');

  async function update(body, msg) {
    try {
      const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, { method: 'POST', body });
      setOutreach(v.id, r.outreach);
      render();
      draw();
      toast(msg);
    } catch (err) {
      toast(err.message);
    }
  }

  function draw() {
    const st = v.outreach.status;
    $('#detailBody').innerHTML = `
      <div class="sheet-hero" id="dHero">
        <div class="monogram">${esc(initials(v.name))}</div>
        <button class="icon-btn close" data-close aria-label="Close">${icon('x')}</button>
        <div class="title"><h2>${esc(v.name)}</h2><p>${esc(v.address)}</p></div>
      </div>
      <div class="thumbs" id="dThumbs"></div>
      <div class="sheet-body">
        <div class="cta-row">
          <a class="btn primary" id="dGmail" href="${esc(gmailUrl(v))}" target="_blank" rel="noopener">${icon('mail')}Email via Gmail</a>
          ${v.website ? `<a class="btn ghost" href="${esc(v.website)}" target="_blank" rel="noopener">${icon('ext')}Website</a>` : ''}
          ${v.menu_url ? `<a class="btn ghost" href="${esc(v.menu_url)}" target="_blank" rel="noopener">${icon('ext')}Menu</a>` : ''}
          ${v.phone ? `<a class="btn ghost" href="tel:${esc(v.phone.replace(/\s/g, ''))}">${icon('phone')}${esc(v.phone)}</a>` : ''}
        </div>

        <div class="glance">
          <div><span>Michelin</span><b>${esc(v.michelin || '—')}</b></div>
          <div><span>For 15–20 guests</span><b>${esc(fitText)}</b></div>
          <div><span>Price</span><b>${esc(v.price_range || '—')}</b></div>
          <div><span>Private dining</span><b>${esc(v.capacity_seated || '—')}</b></div>
        </div>

        <div class="section">
          <h4>Outreach</h4>
          <div class="status-row">${Object.entries(STATUSES).map(([k, l]) => `<button class="chip" data-status="${k}" aria-pressed="${st === k}">${l}</button>`).join('')}</div>
          <form class="inline-form" id="dNoteForm" style="margin-top:12px">
            <input id="dNote" placeholder="Add a note, e.g. spoke to Sarah, proposal due Friday">
            <button class="btn ghost sm">Add note</button>
          </form>
          ${timelineHtml(v.outreach.history)}
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
            <input id="dCover" type="url" placeholder="Paste an image URL to use as the cover" value="${esc(v.outreach.cover || '')}">
            <button class="btn ghost sm">${icon('image')}Save</button>
          </form>
        </div>
      </div>`;

    photosFor(v).then(async (urls) => {
      const hero = $('#dHero');
      if (!hero) return;
      await loadInto(hero, urls, v.name);
      const thumbs = $('#dThumbs');
      if (urls.length > 1 && thumbs) {
        thumbs.innerHTML = urls.map((u, i) => `<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" data-i="${i}" onerror="this.remove()">`).join('');
        thumbs.onclick = (e) => {
          const i = e.target.dataset?.i;
          if (i !== undefined) loadInto(hero, [urls[i]], v.name);
        };
      }
    });

    $('[data-close]', dlg).onclick = () => dlg.close();
    $('#dGmail').onclick = () => logEmailed(v).then(draw);
    for (const b of dlg.querySelectorAll('[data-status]')) {
      b.onclick = () => update({ status: b.dataset.status }, `Marked as ${STATUSES[b.dataset.status]}`);
    }
    $('#dNoteForm').onsubmit = (e) => {
      e.preventDefault();
      const note = $('#dNote').value.trim();
      if (note) update({ note }, 'Note added');
    };
    $('#dCoverForm').onsubmit = (e) => {
      e.preventDefault();
      photoCache.delete(v.id);
      update({ cover: $('#dCover').value.trim() }, 'Cover photo saved');
    };
  }

  draw();
  dlg.showModal();
  dlg.scrollTop = 0;
}

$('#detailDlg').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close(); // click on the backdrop
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
  renderGrid(); // refresh the Gmail links
  toast('Email settings saved');
});
$('#resetTpl').addEventListener('click', () => {
  const form = $('#settingsForm');
  form.elements.subject.value = DEFAULT_SETTINGS.subject;
  form.elements.body.value = DEFAULT_SETTINGS.body;
});

/* ---------- Events & boot ---------- */

$('#grid').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const v = venues.find((x) => x.id === e.target.closest('.card')?.dataset.id);
  if (!v || !action) return;
  if (action === 'gmail') logEmailed(v); // the link itself opens Gmail
  else openDetails(v);
});
$('#statusFilter').addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]')?.dataset.filter;
  if (!f) return;
  filter = f;
  render();
});
$('#search').addEventListener('input', (e) => { query = e.target.value; renderGrid(); });

(async function init() {
  try {
    venues = await api('/api/venues');
    render();
  } catch (e) {
    $('#grid').innerHTML = `<p class="empty">Could not load venues: ${esc(e.message)}</p>`;
  }
})();
