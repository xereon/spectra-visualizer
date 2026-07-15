/* TELLY — Live English TV
   Static client-side IPTV browser. Data: iptv-org playlists (CORS-enabled).
   No build step, no backend. */

(() => {
'use strict';

const SOURCES = [
  'https://iptv-org.github.io/iptv/languages/eng.m3u',   // all English-language channels
  'https://iptv-org.github.io/iptv/countries/au.m3u',    // ensure every AU channel is included
];

const CACHE_KEY = 'telly.channels.v2'; // v2: religious channels excluded
const PREFS_KEY = 'telly.prefs.v1';
const FAVS_KEY  = 'telly.favs.v1';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

const CAT_ICONS = {
  Favorites: '❤️', All: '🌐',
  News: '📰', Sports: '🏆', Movies: '🎬', Series: '📺', Entertainment: '✨',
  Music: '🎵', Kids: '🧸', Comedy: '😄', Documentary: '🎞️',
  Education: '🎓', Animation: '🖍️', Lifestyle: '🌸', Culture: '🎭',
  Outdoor: '🏕️', Business: '📈', Travel: '✈️', Shop: '🛍️', Family: '🏠',
  Cooking: '🍳', Auto: '🏎️', Weather: '⛅', Relax: '🌊', Science: '🔬',
  Classic: '🎩', Legislative: '⚖️', General: '📡', Other: '🧩',
};

// Keyword rules used to rescue channels whose playlist category is "Undefined"
const KEYWORD_CATS = [
  [/\b(news|report|24[\/ ]?7 live)\b/i, 'News'],
  [/\b(sport|espn|racing|golf|cricket|football|soccer|nba|nfl|mlb|wwe|fight|boxing|tennis|rugby)\b/i, 'Sports'],
  [/\b(movie|cinema|film|flix)\b/i, 'Movies'],
  [/\b(music|hits|radio|mtv|vevo|jukebox)\b/i, 'Music'],
  [/\b(kid|cartoon|junior|toon|baby)\b/i, 'Kids'],
  // 'Religious' is filtered out in normalize() — this rule catches uncategorized ones so they're excluded too
  [/\b(church|gospel|catholic|islam|hope|faith|god|christian|worship|bible)\b/i, 'Religious'],
  [/\b(comedy|laugh)\b/i, 'Comedy'],
  [/\b(nature|wild|history|discover|documentar)\b/i, 'Documentary'],
  [/\b(weather)\b/i, 'Weather'],
  [/\b(shop)\b/i, 'Shop'],
  [/\b(food|cook|chef|kitchen)\b/i, 'Cooking'],
  [/\b(drama|series|novela)\b/i, 'Series'],
];

const $ = (s) => document.querySelector(s);

const el = {
  header: $('#appHeader'), chips: $('#chips'), grid: $('#grid'),
  sentinel: $('#sentinel'), count: $('#countLine'),
  search: $('#searchInput'), searchWrap: document.querySelector('.search'),
  searchClear: $('#searchClear'),
  country: $('#countrySelect'), zoom: $('#zoomRange'), toolbar: $('#toolbar'),
  empty: $('#emptyState'), loadErr: $('#loadError'),
  player: $('#player'), video: $('#video'), spinner: $('#spinner'),
  perror: $('#playerError'), playerTitle: $('#playerTitle'),
  playerMeta: $('#playerMeta'), playerFav: $('#playerFav'),
  relatedRow: $('#relatedRow'), relatedTitle: $('#relatedTitle'),
  toast: $('#toast'), refresh: $('#refreshBtn'),
};

const state = {
  channels: [],
  filtered: [],
  cats: [],            // [{name, count}]
  countries: [],       // [{code, count}]
  view: 'grid',
  zoom: 1,
  cat: 'All',
  country: 'all',
  q: '',
  favs: new Set(),
  rendered: 0,         // how many of filtered[] are in the DOM
  current: null,       // channel playing now
};

const CHUNK = 60;

/* ---------------- helpers ---------------- */

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => n.toLocaleString('en');

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  if (!words[0]) return 'TV';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

let regionNames;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* older browsers */ }

function countryName(code) {
  if (!code) return '';
  const iso = code === 'uk' ? 'GB' : code.toUpperCase();
  try { return regionNames ? regionNames.of(iso) : iso; } catch { return iso; }
}

function countryFlag(code) {
  if (!code || code.length !== 2) return '🏳️';
  const iso = code === 'uk' ? 'gb' : code;
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}

/* ---------------- data: fetch + parse ---------------- */

function parseM3U(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let meta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) { meta = line; continue; }
    if (!meta || !line || line.startsWith('#')) continue;

    const attr = (name) => {
      const m = meta.match(new RegExp(name + '="([^"]*)"'));
      return m ? m[1] : '';
    };
    // Channel name = text after the comma that follows the last quoted attribute
    const lastQuote = meta.lastIndexOf('"');
    const comma = meta.indexOf(',', lastQuote === -1 ? 8 : lastQuote);
    let name = comma === -1 ? '' : meta.slice(comma + 1).trim();

    const tvgId = attr('tvg-id');
    const logo = attr('tvg-logo');
    const group = attr('group-title');

    // quality tag e.g. "(1080p)" — pull out of the display name
    let quality = '';
    name = name
      .replace(/\((\d{3,4}p)[^)]*\)/i, (_, q) => { quality = q.toLowerCase(); return ''; })
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!name) name = tvgId.split('.')[0] || 'Unknown';

    const cm = tvgId.match(/\.([a-z]{2})(?:@|$)/i);
    const country = cm ? cm[1].toLowerCase() : '';

    let cats = group.split(';').map((c) => c.trim()).filter((c) => c && c !== 'Undefined');
    if (!cats.length) {
      for (const [re, cat] of KEYWORD_CATS) if (re.test(name)) { cats = [cat]; break; }
    }
    if (!cats.length) cats = ['Other'];

    out.push({ id: line, name, url: line, logo, cats, country, quality });
    meta = null;
  }
  return out;
}

function normalize(lists) {
  const byUrl = new Map();
  for (const list of lists) {
    for (const ch of list) {
      if (ch.cats.includes('Religious')) continue; // religious channels excluded
      if (!byUrl.has(ch.url)) byUrl.set(ch.url, ch);
    }
  }
  const channels = [...byUrl.values()];
  channels.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  for (const ch of channels) {
    ch.nameL = ch.name.toLowerCase();
    ch.hue = hashHue(ch.name);
    ch.ini = initials(ch.name);
  }
  return channels;
}

async function fetchChannels(force = false) {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && Date.now() - cached.time < CACHE_TTL && cached.channels?.length) {
        return { channels: normalize([cached.channels]), fromCache: true };
      }
    } catch { /* corrupt cache — refetch */ }
  }

  const results = await Promise.allSettled(
    SOURCES.map((u) => fetch(u, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }))
  );
  const lists = results.filter((r) => r.status === 'fulfilled').map((r) => parseM3U(r.value));
  if (!lists.length || !lists[0].length) {
    // total failure — fall back to stale cache if we have one
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached?.channels?.length) {
        toast('Offline — showing cached channel list');
        return { channels: normalize([cached.channels]), fromCache: true };
      }
    } catch { /* nothing to fall back to */ }
    throw new Error('all sources failed');
  }

  const channels = normalize(lists);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      time: Date.now(),
      channels: channels.map(({ name, url, logo, cats, country, quality }) =>
        ({ id: url, name, url, logo, cats, country, quality })),
    }));
  } catch { /* storage full — fine, just no cache */ }
  return { channels, fromCache: false };
}

/* ---------------- derived UI data ---------------- */

function buildFacets() {
  const catCount = new Map();
  const cCount = new Map();
  for (const ch of state.channels) {
    for (const c of ch.cats) catCount.set(c, (catCount.get(c) || 0) + 1);
    if (ch.country) cCount.set(ch.country, (cCount.get(ch.country) || 0) + 1);
  }
  state.cats = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  state.countries = [...cCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
}

function renderChips() {
  const total = state.channels.length;
  const chips = [
    { name: 'All', count: total },
    { name: 'Favorites', count: state.favs.size },
    ...state.cats,
  ];
  el.chips.innerHTML = chips.map((c) => `
    <button class="chip${state.cat === c.name ? ' active' : ''}" data-cat="${esc(c.name)}">
      <span>${CAT_ICONS[c.name] || '🧩'}</span>${esc(c.name)}<span class="n">${fmt(c.count)}</span>
    </button>`).join('');
}

function renderCountrySelect() {
  const opts = state.countries.map(({ code, count }) =>
    `<option value="${code}">${countryFlag(code)} ${esc(countryName(code))} (${fmt(count)})</option>`);
  el.country.innerHTML = `<option value="all">🌍 All countries</option>` + opts.join('');
  el.country.value = state.country;
  if (el.country.value !== state.country) { state.country = 'all'; el.country.value = 'all'; }
}

/* ---------------- filtering + rendering ---------------- */

function applyFilters() {
  let list = state.channels;
  if (state.cat === 'Favorites') list = list.filter((ch) => state.favs.has(ch.url));
  else if (state.cat !== 'All') list = list.filter((ch) => ch.cats.includes(state.cat));
  if (state.country !== 'all') list = list.filter((ch) => ch.country === state.country);
  if (state.q) list = list.filter((ch) => ch.nameL.includes(state.q));
  state.filtered = list;

  state.rendered = 0;
  el.grid.innerHTML = '';
  el.empty.classList.toggle('hidden', list.length > 0);
  el.count.textContent = list.length === state.channels.length
    ? `${fmt(list.length)} channels · ${state.cats.length} categories · ${state.countries.length} countries`
    : `${fmt(list.length)} of ${fmt(state.channels.length)} channels`;
  renderChunk();
}

function subline(ch) {
  const bits = [];
  if (ch.country) bits.push(`${countryFlag(ch.country)} ${countryName(ch.country)}`);
  bits.push(ch.cats.slice(0, 2).join(' · '));
  return bits.join('  ·  ');
}

function thumbHTML(ch) {
  const img = ch.logo
    ? `<img src="${esc(ch.logo)}" alt="" loading="lazy" decoding="async"
         onload="this.classList.add('ok')" onerror="this.remove()">`
    : '';
  return `<div class="thumb" style="--h:${ch.hue}" data-ini="${esc(ch.ini)}">${img}
    ${ch.quality ? `<span class="q">${esc(ch.quality)}</span>` : ''}
    <button class="fav${state.favs.has(ch.url) ? ' on' : ''}" data-fav aria-label="Favorite">♥</button>
  </div>`;
}

function cardHTML(ch, i) {
  if (state.view === 'wall') {
    return `<div class="tile" data-i="${i}">${thumbHTML(ch)}<span class="name">${esc(ch.name)}</span></div>`;
  }
  if (state.view === 'list') {
    return `<div class="rowitem" data-i="${i}">${thumbHTML(ch)}
      <div class="rmeta"><h3>${esc(ch.name)}</h3><p>${esc(subline(ch))}</p></div>
      <span class="play-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>
    </div>`;
  }
  return `<article class="card" data-i="${i}">${thumbHTML(ch)}
    <div class="meta"><h3>${esc(ch.name)}</h3><p>${esc(subline(ch))}</p></div>
  </article>`;
}

function renderChunk() {
  const end = Math.min(state.rendered + CHUNK, state.filtered.length);
  if (end === state.rendered) return;
  let html = '';
  for (let i = state.rendered; i < end; i++) html += cardHTML(state.filtered[i], i);
  el.grid.insertAdjacentHTML('beforeend', html);
  state.rendered = end;
  // IO won't re-fire if the sentinel never left the margin — keep filling until it does
  requestAnimationFrame(() => {
    if (state.rendered < state.filtered.length &&
        el.sentinel.getBoundingClientRect().top < innerHeight + 900) {
      renderChunk();
    }
  });
}

function renderSkeletons() {
  el.grid.innerHTML = Array.from({ length: 12 }, () =>
    `<div class="sk"><div class="sk-thumb"></div><div class="sk-l1"></div><div class="sk-l2"></div></div>`).join('');
}

const io = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) renderChunk();
}, { rootMargin: '900px' });

/* ---------------- view + zoom ---------------- */

function setView(view) {
  state.view = view;
  el.grid.className = `grid view-${view}`;
  document.body.classList.toggle('view-is-list', view === 'list');
  document.querySelectorAll('.seg-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  state.rendered = 0;
  el.grid.innerHTML = '';
  renderChunk();
  savePrefs();
}

function setZoom(z, fromSlider = false) {
  state.zoom = Math.min(2.2, Math.max(0.55, z));
  document.documentElement.style.setProperty('--zoom', state.zoom.toFixed(2));
  document.body.classList.toggle('zoom-small', state.zoom < 0.8);
  if (!fromSlider) el.zoom.value = state.zoom;
  savePrefs();
}

function initPinch() {
  const pointers = new Map();
  let pinch = null;
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  el.grid.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = { d: dist(), z: state.zoom };
  });
  el.grid.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      e.preventDefault();
      setZoom(pinch.z * (dist() / pinch.d));
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); pinch = null; };
  el.grid.addEventListener('pointerup', up);
  el.grid.addEventListener('pointercancel', up);

  // iOS Safari pinch (gesture events) — scoped to the grid only
  let gz = 1;
  el.grid.addEventListener('gesturestart', (e) => { e.preventDefault(); gz = state.zoom; });
  el.grid.addEventListener('gesturechange', (e) => { e.preventDefault(); setZoom(gz * e.scale); });
}

/* ---------------- player ---------------- */

let hls = null;
let netRetried = false;
let mediaRetried = false;

function openPlayer(ch) {
  state.current = ch;
  el.player.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  el.playerTitle.textContent = ch.name;
  el.playerFav.classList.toggle('on', state.favs.has(ch.url));
  el.playerMeta.innerHTML = [
    ch.country ? `<span class="pill">${countryFlag(ch.country)} ${esc(countryName(ch.country))}</span>` : '',
    ...ch.cats.map((c) => `<span class="pill">${CAT_ICONS[c] || ''} ${esc(c)}</span>`),
    ch.quality ? `<span class="pill">🎥 ${esc(ch.quality)}</span>` : '',
  ].join('');
  renderRelated(ch);
  startStream(ch);
}

function startStream(ch) {
  stopStream();
  netRetried = mediaRetried = false;
  el.perror.classList.add('hidden');
  el.spinner.classList.remove('hidden');
  const video = el.video;

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      manifestLoadingTimeOut: 12000,
      levelLoadingTimeOut: 12000,
      fragLoadingTimeOut: 20000,
    });
    hls.loadSource(ch.url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !netRetried) {
        netRetried = true; hls.startLoad(); return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetried) {
        mediaRetried = true; hls.recoverMediaError(); return;
      }
      showStreamError();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = ch.url;
    video.play().catch(() => {});
    video.onerror = showStreamError;
  } else {
    showStreamError();
  }
}

function showStreamError() {
  el.spinner.classList.add('hidden');
  el.perror.classList.remove('hidden');
}

function stopStream() {
  if (hls) { hls.destroy(); hls = null; }
  el.video.onerror = null;
  el.video.pause();
  el.video.removeAttribute('src');
  el.video.load();
}

function closePlayer() {
  stopStream();
  el.player.classList.add('hidden');
  document.body.style.overflow = '';
  state.current = null;
}

function renderRelated(ch) {
  const cat = ch.cats[0];
  el.relatedTitle.textContent = `More ${cat === 'Other' ? 'channels' : cat}`;
  const rel = state.channels
    .filter((c) => c.url !== ch.url && c.cats.includes(cat))
    .sort((a, b) => (b.country === ch.country) - (a.country === ch.country))
    .slice(0, 14);
  el.relatedRow.innerHTML = rel.map((c, i) => `
    <div class="tile" data-rel="${i}">
      <div class="thumb" style="--h:${c.hue}" data-ini="${esc(c.ini)}">
        ${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()">` : ''}
      </div>
      <span class="name">${esc(c.name)}</span>
    </div>`).join('');
  el.relatedRow.scrollLeft = 0;
  el.relatedRow.onclick = (e) => {
    const t = e.target.closest('[data-rel]');
    if (t) openPlayer(rel[+t.dataset.rel]);
  };
}

/* ---------------- favorites + prefs ---------------- */

function toggleFav(url) {
  if (state.favs.has(url)) { state.favs.delete(url); toast('Removed from favorites'); }
  else { state.favs.add(url); toast('Added to favorites ♥'); }
  localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs]));
  const favChip = el.chips.querySelector('[data-cat="Favorites"] .n');
  if (favChip) favChip.textContent = fmt(state.favs.size);
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({
    view: state.view, zoom: state.zoom, cat: state.cat, country: state.country,
  }));
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    if (['grid', 'wall', 'list'].includes(p.view)) state.view = p.view;
    if (typeof p.zoom === 'number') state.zoom = p.zoom;
    if (typeof p.cat === 'string') state.cat = p.cat;
    if (typeof p.country === 'string') state.country = p.country;
  } catch { /* fresh start */ }
  try { state.favs = new Set(JSON.parse(localStorage.getItem(FAVS_KEY)) || []); }
  catch { state.favs = new Set(); }
}

/* ---------------- events ---------------- */

function wireEvents() {
  // play / favorite (event delegation)
  el.grid.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    const item = e.target.closest('[data-i]');
    if (!item) return;
    const ch = state.filtered[+item.dataset.i];
    if (!ch) return;
    if (fav) {
      e.stopPropagation();
      toggleFav(ch.url);
      fav.classList.toggle('on', state.favs.has(ch.url));
      if (state.cat === 'Favorites') applyFilters();
      return;
    }
    openPlayer(ch);
  });

  // category chips
  el.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    state.cat = chip.dataset.cat;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    applyFilters();
    savePrefs();
  });

  // search
  let debounce;
  el.search.addEventListener('input', () => {
    el.searchWrap.classList.toggle('has-text', !!el.search.value);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = el.search.value.trim().toLowerCase();
      applyFilters();
    }, 130);
  });
  el.searchClear.addEventListener('click', () => {
    el.search.value = '';
    el.searchWrap.classList.remove('has-text');
    state.q = '';
    applyFilters();
    el.search.focus();
  });

  // view mode
  el.toolbar.querySelectorAll('.seg-btn').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view)));

  // zoom slider
  el.zoom.addEventListener('input', () => setZoom(parseFloat(el.zoom.value), true));

  // country
  el.country.addEventListener('change', () => {
    state.country = el.country.value;
    applyFilters();
    savePrefs();
  });

  // clear filters / retry
  $('#clearFilters').addEventListener('click', () => {
    state.cat = 'All'; state.country = 'all'; state.q = '';
    el.search.value = ''; el.searchWrap.classList.remove('has-text');
    el.country.value = 'all';
    renderChips();
    applyFilters();
    savePrefs();
  });
  $('#retryLoad').addEventListener('click', () => boot(true));
  el.refresh.addEventListener('click', () => boot(true));

  // player
  $('#playerClose').addEventListener('click', closePlayer);
  $('#retryStream').addEventListener('click', () => state.current && startStream(state.current));
  $('#copyStream').addEventListener('click', async () => {
    if (!state.current) return;
    try {
      await navigator.clipboard.writeText(state.current.url);
      toast('Stream URL copied — try it in VLC');
    } catch { toast('Could not copy'); }
  });
  el.playerFav.addEventListener('click', () => {
    if (!state.current) return;
    toggleFav(state.current.url);
    el.playerFav.classList.toggle('on', state.favs.has(state.current.url));
  });
  el.video.addEventListener('playing', () => el.spinner.classList.add('hidden'));
  el.video.addEventListener('waiting', () => {
    if (el.perror.classList.contains('hidden')) el.spinner.classList.remove('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.player.classList.contains('hidden')) closePlayer();
    if (e.key === '/' && document.activeElement !== el.search) {
      e.preventDefault();
      el.search.focus();
    }
  });

  // collapse toolbar when scrolling down (more room for channels on mobile)
  let lastY = 0;
  addEventListener('scroll', () => {
    const y = scrollY;
    if (y > 220 && y > lastY + 6) el.header.classList.add('compact');
    else if (y < lastY - 6 || y < 120) el.header.classList.remove('compact');
    lastY = y;
  }, { passive: true });

  initPinch();
  io.observe(el.sentinel);
}

/* ---------------- boot ---------------- */

async function boot(force = false) {
  el.loadErr.classList.add('hidden');
  el.empty.classList.add('hidden');
  el.count.textContent = 'Loading channels…';
  el.refresh.classList.add('spinning');
  renderSkeletons();
  try {
    const { channels, fromCache } = await fetchChannels(force);
    state.channels = channels;
    buildFacets();
    // drop favorites that no longer exist in the channel list
    const urls = new Set(channels.map((c) => c.url));
    const nFavs = state.favs.size;
    state.favs = new Set([...state.favs].filter((u) => urls.has(u)));
    if (state.favs.size !== nFavs) localStorage.setItem(FAVS_KEY, JSON.stringify([...state.favs]));
    // saved category may no longer exist
    if (state.cat !== 'All' && state.cat !== 'Favorites' && !state.cats.some((c) => c.name === state.cat)) {
      state.cat = 'All';
    }
    renderChips();
    renderCountrySelect();
    applyFilters();
    el.search.placeholder = `Search ${fmt(state.channels.length)} channels…`;
    if (force && !fromCache) toast('Channel list refreshed');
  } catch (err) {
    console.error('load failed', err);
    el.grid.innerHTML = '';
    el.count.textContent = '';
    el.loadErr.classList.remove('hidden');
  } finally {
    el.refresh.classList.remove('spinning');
  }
}

localStorage.removeItem('telly.channels.v1'); // pre-filter cache format
loadPrefs();
setView(state.view);
setZoom(state.zoom);
el.zoom.value = state.zoom;
wireEvents();
boot();

})();
