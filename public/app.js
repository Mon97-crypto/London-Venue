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
  altDates: '',
  timing: 'Evening, from around 7pm',
  budget: '',
  subject: 'Private dining enquiry for {{guests}} guests | Impact Analytics',
  body: `Dear {{venue}} team,

My name is {{senderName}} and I lead events at Impact Analytics, an AI-powered retail analytics company. We are planning a private dinner in London and {{venue}} is at the top of our list.

Here are the details:
- Group size: {{guests}} guests
- Preferred date: {{date}}
- Alternative dates: {{altDates}}
- Timing: {{timing}}
- Format: seated private dinner, ideally in {{room}}
- Budget: {{budget}}

Could you please let us know:
1. Whether you can host a group of {{guests}} in a private or semi-private space on these dates
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

const SETTINGS_KEY = 'london-venue-settings-v1';
const $ = (sel, root = document) => root.querySelector(sel);

let venues = [];
let filter = 'all';
let query = '';

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
const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const recipientFor = (v) => v.rfp_to || v.email_private_dining || v.email_general || '';
const photoCache = new Map();
function photosFor(v) {
  const curated = [v.cover_image, ...(v.photos || [])].filter(Boolean);
  if (curated.length) return Promise.resolve(curated);
  if (!photoCache.has(v.id)) {
    photoCache.set(v.id, api(`/api/photos/${encodeURIComponent(v.id)}`).then((r) => r.photos).catch(() => []));
  }
  return photoCache.get(v.id);
}
const imgTag = (src, alt, extra = '') => `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" ${extra}>`;

function fill(template, venue, s) {
  const values = {
    venue: venue.name,
    room: venue.room || 'your private dining room',
    guests: s.guests || '15 to 20',
    date: s.date || '[date to be confirmed]',
    altDates: s.altDates || 'flexible',
    timing: s.timing || 'evening',
    budget: s.budget || 'open to your recommendations',
    senderName: s.senderName || '[Your name]',
    senderTitle: s.senderTitle || '',
    senderPhone: s.senderPhone || '',
  };
  return template
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
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

/* ---------- Rendering ---------- */

function renderStats() {
  const count = (st) => venues.filter((v) => v.outreach.status === st).length;
  const reached = venues.length - count('not_contacted');
  const items = [
    [venues.length, 'Venues'],
    [reached, 'Reached out'],
    [count('not_contacted'), 'Still to contact'],
    [count('replied') + count('shortlisted'), 'Replied or shortlisted'],
    [count('booked'), 'Booked'],
  ];
  $('#stats').innerHTML = items.map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
}

function renderFilters() {
  const opts = [['all', 'All'], ...Object.entries(STATUSES)];
  $('#statusFilter').innerHTML = opts
    .map(([k, l]) => {
      const n = k === 'all' ? venues.length : venues.filter((v) => v.outreach.status === k).length;
      return `<button class="chip" role="tab" data-filter="${k}" aria-selected="${filter === k}">${l} · ${n}</button>`;
    })
    .join('');
}

function coverHtml(v) {
  return `<div class="fallback">${esc(v.name)}</div><span class="cover-slot" data-cover="${esc(v.id)}"></span>`;
}

function hydrateCovers() {
  for (const slot of document.querySelectorAll('[data-cover]')) {
    const v = venues.find((x) => x.id === slot.dataset.cover);
    photosFor(v).then((p) => {
      if (p[0] && slot.isConnected) slot.outerHTML = imgTag(p[0], v.name);
    });
  }
}

function renderGrid() {
  const q = query.toLowerCase();
  const list = venues.filter((v) => {
    if (filter !== 'all' && v.outreach.status !== filter) return false;
    if (!q) return true;
    return [v.name, v.area, v.cuisine, v.chef, v.michelin].join(' ').toLowerCase().includes(q);
  });
  if (!list.length) {
    $('#grid').innerHTML = '<p class="meta">No venues match this filter.</p>';
    return;
  }
  $('#grid').innerHTML = list
    .map((v) => {
      const st = v.outreach.status;
      const to = recipientFor(v);
      return `
      <article class="card" data-id="${esc(v.id)}">
        <div class="cover" data-action="details">${coverHtml(v)}<span class="pill ${st}">${STATUSES[st]}</span></div>
        <div class="card-body">
          <h3 data-action="details">${esc(v.name)}</h3>
          <div class="meta">${esc(v.area)}${v.cuisine ? ' · ' + esc(v.cuisine) : ''}</div>
          <div class="tags">
            ${v.michelin ? `<span class="tag star">${esc(v.michelin)}</span>` : ''}
            ${v.fit_15_20 ? `<span class="tag">15–20: ${esc(v.fit_15_20)}</span>` : ''}
            ${v.price_range ? `<span class="tag">${esc(v.price_range)}</span>` : ''}
          </div>
          <div class="email-line ${to ? '' : 'missing'}">${to ? esc(to.split(',')[0]) + (to.includes(',') ? ' +1' : '') : 'No public email: call ' + esc(v.phone)}</div>
          ${v.outreach.lastContactedAt ? `<div class="last">Last emailed ${fmtDate(v.outreach.lastContactedAt)}</div>` : ''}
          <div class="card-actions">
            <button class="btn ghost sm" data-action="details">Details</button>
            <button class="btn primary sm" data-action="gmail">${st === 'not_contacted' ? 'Email via Gmail' : 'Email again'}</button>
          </div>
        </div>
      </article>`;
    })
    .join('');
  hydrateCovers();
}

function render() {
  renderStats();
  renderFilters();
  renderGrid();
}

/* ---------- Gmail ---------- */

function gmailUrl(v, s) {
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

// Opens a prefilled Gmail draft in a new tab and logs the venue as contacted.
async function emailViaGmail(v) {
  const s = loadSettings();
  if (!s.senderName) {
    toast('Add your name and event date under Event details first.');
    return openSettings();
  }
  // window.open must run before any await, or the browser blocks the pop-up.
  const tab = window.open(gmailUrl(v, s), '_blank');
  if (!tab) return toast('Your browser blocked the Gmail tab. Allow pop-ups for this site and try again.');
  tab.opener = null;
  if (!recipientFor(v)) toast(`${v.name} has no public email. Add the address in Gmail before sending.`);
  try {
    const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, {
      method: 'POST',
      body: { emailed: { to: recipientFor(v), subject: fill(s.subject, v, s) } },
    });
    setOutreach(v.id, r.outreach);
    render();
    if (recipientFor(v)) toast(`Gmail draft opened for ${v.name}. Marked as contacted.`);
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Details ---------- */

function link(url, label) {
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || url)}</a>` : '';
}

function historyHtml(h) {
  if (!h.length) return '<p class="meta">No activity yet.</p>';
  return `<ul class="history">${[...h].reverse().map((e) => {
    let text = '';
    if (e.type === 'email') text = `Opened Gmail draft to ${esc([].concat(e.to).join(', ') || 'no address')}: “${esc(e.subject)}”`;
    else if (e.type === 'status') text = `Status changed to ${esc(STATUSES[e.to])}`;
    else text = esc(e.note);
    return `<li><time>${fmtDate(e.at)}</time>${text}</li>`;
  }).join('')}</ul>`;
}

function openDetails(v) {
  const rows = [
    ['Website', link(v.website)],
    ['Private dining email', v.email_private_dining ? link('mailto:' + v.email_private_dining, v.email_private_dining) : ''],
    ['General email', v.email_general ? link('mailto:' + v.email_general, v.email_general) : ''],
    ['Phone', v.phone ? link('tel:' + v.phone.replace(/\s/g, ''), v.phone) : ''],
    ['Address', esc(v.address)],
    ['Good for 15–20?', esc(v.fit_15_20)],
    ['Email source', (v.email_sources || []).map((u) => link(u, new URL(u).pathname)).join(' · ')],
    ['Chef', esc(v.chef)],
    ['Cuisine', esc(v.cuisine)],
    ['Accolades', esc(v.michelin)],
    ['Speciality', esc(v.speciality)],
    ['Signature dishes', esc(v.signature_dishes)],
    ['Menu', `${esc(v.menu_summary)} ${link(v.menu_url, 'View menu')}`],
    ['Price range', esc(v.price_range)],
    ['Private dining', esc(v.private_dining)],
    ['Capacity', [v.capacity_seated && `${esc(v.capacity_seated)} seated`, v.capacity_standing && `${esc(v.capacity_standing)} standing`].filter(Boolean).join(' · ')],
    ['Instagram', v.instagram ? link(`https://instagram.com/${v.instagram.replace('@', '')}`, v.instagram) : ''],
    ['Notes', esc(v.notes)],
  ].filter(([, val]) => val && val.trim());

  $('#detailBody').innerHTML = `
    <header class="dlg-head">
      <div><p class="eyebrow">${esc(v.area)}</p><h2>${esc(v.name)}</h2></div>
      <button class="icon-btn" data-close aria-label="Close">✕</button>
    </header>
    <div id="dPhotos"></div>
    <dl class="facts">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
    <h3>Outreach</h3>
    <div class="status-row">
      <label style="flex-direction:row;align-items:center;gap:8px">Status
        <select id="dStatus">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${v.outreach.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <button class="btn primary sm" id="dCompose">Email via Gmail</button>
    </div>
    <div class="note-row"><input id="dNote" placeholder="Add a note, e.g. called and spoke to Sarah, proposal due Friday"><button class="btn ghost sm" id="dAddNote">Add note</button></div>
    <div id="dHistory">${historyHtml(v.outreach.history)}</div>`;

  const dlg = $('#detailDlg');
  photosFor(v).then((p) => {
    const box = $('#dPhotos');
    if (!box || !p.length) return;
    box.innerHTML = `<div class="detail-hero">${imgTag(p[0], v.name)}</div>` +
      (p.length > 1 ? `<div class="thumbs" style="margin-top:8px">${p.slice(1).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${imgTag(u, v.name + ' photo')}</a>`).join('')}</div>` : '');
  });
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('#dCompose').onclick = () => { dlg.close(); emailViaGmail(v); };
  $('#dStatus').onchange = async (e) => {
    try {
      const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, { method: 'POST', body: { status: e.target.value } });
      setOutreach(v.id, r.outreach);
      $('#dHistory').innerHTML = historyHtml(r.outreach.history);
      render();
      toast(`${v.name} marked as ${STATUSES[e.target.value]}`);
    } catch (err) { toast(err.message); }
  };
  $('#dAddNote').onclick = async () => {
    const note = $('#dNote').value.trim();
    if (!note) return;
    try {
      const r = await api(`/api/outreach/${encodeURIComponent(v.id)}`, { method: 'POST', body: { note } });
      setOutreach(v.id, r.outreach);
      $('#dNote').value = '';
      $('#dHistory').innerHTML = historyHtml(r.outreach.history);
    } catch (err) { toast(err.message); }
  };
  dlg.showModal();
}

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
  toast('Event details saved');
});
$('#resetTpl').addEventListener('click', () => {
  const form = $('#settingsForm');
  form.elements.subject.value = DEFAULT_SETTINGS.subject;
  form.elements.body.value = DEFAULT_SETTINGS.body;
});

/* ---------- Events & boot ---------- */

$('#grid').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const id = e.target.closest('.card')?.dataset.id;
  const v = venues.find((x) => x.id === id);
  if (!v || !action) return;
  if (action === 'gmail') emailViaGmail(v);
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
    const s = loadSettings();
    if (!s.senderName) toast('Tip: add your name and event date under Event details before sending.');
  } catch (e) {
    $('#grid').innerHTML = `<p class="err">Could not load venues: ${esc(e.message)}</p>`;
  }
})();
