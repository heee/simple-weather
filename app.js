(function () {
  'use strict';

  const L = window.SWLogic;
  const MIN = 6e4, HOUR = 36e5;
  const TIMEOUT_MS = 8000;
  const REFETCH_AFTER = 15 * MIN;
  const STALE_AFTER = 3 * HOUR;
  const DEFAULT_PLACES = [{ id: '29.760,-95.370', name: 'Houston', region: 'TX', lat: 29.76, lon: -95.37 }];

  /* ---------- storage (every access guarded: private mode etc.) ---------- */

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } }
  };
  const wxKey = id => 'sw.wx.' + id;

  const state = {
    places: store.get('sw.places', null) || DEFAULT_PLACES.slice(),
    units: store.get('sw.units', 'F'),
    wx: {},
    loading: new Set(),
    failed: new Set(),
    active: 0
  };
  if (!Array.isArray(state.places) || !state.places.length) state.places = DEFAULT_PLACES.slice();
  for (const p of state.places) state.wx[p.id] = store.get(wxKey(p.id), null);

  /* ---------- icons ---------- */

  const CLOUD_HI = '<path d="M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 6.5 4.25 4.25 0 0 0 7 15z"/>';
  const PARTLY_CLOUD = '<path d="M9 20h8.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.3 12.2 3.9 3.9 0 0 0 9 20z"/>';
  const PATHS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    partly: '<path d="M8 3v1.5M3.5 8H2M4.3 4.3l1 1M12.7 4.3l-1 1"/><path d="M5.5 10.5A3.5 3.5 0 0 1 11.6 7"/>' + PARTLY_CLOUD,
    partlyNight: '<path d="M11.4 8.2A4.6 4.6 0 0 1 5.4 2.6 4.6 4.6 0 1 0 11.4 8.2z"/>' + PARTLY_CLOUD,
    cloudy: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z"/>',
    fog: '<path d="M7 13h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 4.5 4.25 4.25 0 0 0 7 13z"/><path d="M4 17h16M7 20.5h10"/>',
    rain: CLOUD_HI + '<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
    thunder: CLOUD_HI + '<path d="M12.5 15.5l-2 3h3l-2 3"/>',
    snow: CLOUD_HI + '<path d="M8.5 18.5h.01M12.5 18.5h.01M16.5 18.5h.01M10.5 21.5h.01M14.5 21.5h.01" stroke-width="2.4"/>',
    thermo: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    outlook: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M12 12.6l.85 1.8 1.85.85-1.85.85-.85 1.8-.85-1.8-1.85-.85 1.85-.85z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  function icon(name, size, sw, label, color) {
    const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name]}</svg>`;
  }

  // Lit part of the moon drawn as an outer limb plus an elliptical terminator.
  function moonIcon(phase, fraction, size, label) {
    const r = 18, c = 20;
    const k = Math.cos(2 * Math.PI * phase);
    const rx = Math.abs(k) * r;
    const waxing = phase < 0.5;
    const crescent = k > 0;
    const limb = waxing ? 1 : 0;
    const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    const lit = fraction < 0.01 ? '' :
      `<path d="M${c} ${c - r} A${r} ${r} 0 0 ${limb} ${c} ${c + r} A${rx.toFixed(2)} ${r} 0 0 ${term} ${c} ${c - r}z" style="fill:var(--moon-lit)"/>`;
    const full = fraction > 0.99 ? `<circle cx="${c}" cy="${c}" r="${r}" style="fill:var(--moon-lit)"/>` : '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${esc(label)}"><circle cx="${c}" cy="${c}" r="${r}" style="fill:var(--moon-dark)"/>${full || lit}</svg>`;
  }

  /* ---------- background scenery ---------- */

  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  const clouds = (op, fill) => `<g style="fill:var(${fill});opacity:${op}">
<ellipse cx="92" cy="196" rx="78" ry="26"/><ellipse cx="146" cy="174" rx="54" ry="40"/><ellipse cx="96" cy="182" rx="38" ry="30"/><ellipse cx="198" cy="194" rx="60" ry="26"/></g>
<g style="fill:var(${fill});opacity:${op * 0.78}"><ellipse cx="300" cy="250" rx="62" ry="18"/><ellipse cx="326" cy="236" rx="36" ry="24"/><ellipse cx="282" cy="242" rx="26" ry="18"/></g>
<g style="fill:var(${fill});opacity:${op * 0.6}"><ellipse cx="20" cy="318" rx="60" ry="16"/><ellipse cx="40" cy="306" rx="30" ry="18"/></g>`;
  const highClouds = (op, fill) => `<g style="fill:var(${fill});opacity:${op}">
<ellipse cx="300" cy="90" rx="96" ry="30"/><ellipse cx="250" cy="70" rx="64" ry="40"/><ellipse cx="340" cy="64" rx="54" ry="34"/>
<ellipse cx="70" cy="130" rx="90" ry="28"/><ellipse cx="110" cy="112" rx="50" ry="32"/></g>`;
  const sun = op => `<g style="opacity:var(--sun-op)">
<circle cx="318" cy="78" r="150" fill="#FFE6AE" opacity="${0.28 * op}"/><circle cx="318" cy="78" r="96" fill="#FFDD94" opacity="${0.35 * op}"/><circle cx="318" cy="78" r="54" fill="#FFD27A" opacity="${0.55 * op}"/></g>`;
  function streaks() {
    const rnd = seeded(7);
    let out = '<g style="stroke:var(--sky-streak)" stroke-width="1.2" stroke-linecap="round" opacity=".35">';
    for (let i = 0; i < 22; i++) {
      const x = 20 + rnd() * 370, y = 150 + rnd() * 220;
      out += `<path d="M${x.toFixed(0)} ${y.toFixed(0)}l-8 20"/>`;
    }
    return out + '</g>';
  }
  function starfield(count) {
    const rnd = seeded(42);
    let out = `<ellipse cx="210" cy="200" rx="260" ry="60" transform="rotate(-28 210 200)" style="fill:var(--sky-band)" opacity=".07"/>
<ellipse cx="210" cy="200" rx="200" ry="28" transform="rotate(-28 210 200)" style="fill:var(--sky-band)" opacity=".06"/><g style="fill:var(--sky-star)">`;
    for (let i = 0; i < count; i++) {
      const x = rnd() * 390, y = rnd() * 460, r = 0.7 + rnd() * 0.9, o = 0.4 + rnd() * 0.5;
      out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" opacity="${o.toFixed(2)}"/>`;
    }
    return out + '</g>';
  }
  const moonGlow = '<g fill="#FFF4D6"><circle cx="306" cy="70" r="110" opacity=".05"/><circle cx="306" cy="70" r="60" opacity=".07"/><circle cx="306" cy="70" r="22" opacity=".14"/></g>';

  function scenery(m) {
    const g = L.group(m.cur.code);
    const night = !m.cur.isDay;
    let body;
    if (night) {
      if (g === 'clear') body = starfield(60) + (m.stars.moon.upNow ? moonGlow : '');
      else if (g === 'partly') body = starfield(34) + (m.stars.moon.upNow ? moonGlow : '') + highClouds(0.55, '--sky-cloud');
      else body = clouds(0.45, '--sky-grey') + (g === 'rain' || g === 'thunder' ? streaks() : '');
    } else if (g === 'clear') body = sun(1);
    else if (g === 'partly') body = sun(1) + clouds(0.9, '--sky-cloud');
    else if (g === 'rain' || g === 'thunder') body = clouds(0.85, '--sky-grey') + streaks();
    else body = highClouds(0.6, '--sky-cloud') + clouds(0.8, '--sky-cloud');
    const h = night ? 520 : 440;
    return `<div class="scenery${night ? ' night' : ''}" aria-hidden="true"><svg viewBox="0 0 390 ${h}" preserveAspectRatio="xMaxYMin slice" fill="none">${body}</svg></div>`;
  }

  /* ---------- formatting ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const deg = f => Math.round(state.units === 'C' ? (f - 32) * 5 / 9 : f) + '°';
  const speed = mph => state.units === 'C' ? `${Math.round(mph * 1.609)} km/h` : `${Math.round(mph)} mph`;

  /* ---------- rendering ---------- */

  function headerHTML(place, idx, rec) {
    const title = idx === 0 ? 'Home' : place.name;
    const sub = idx === 0 ? `${place.name}, ${place.region}` : place.region;
    const loading = state.loading.has(place.id);
    let updated = '';
    if (rec) {
      const age = Date.now() - rec.fetchedAt;
      const tag = age > STALE_AFTER ? (navigator.onLine === false ? ' · offline' : ' · stale') : '';
      updated = `<span class="${tag ? 'stale' : ''}">Updated ${L.time(rec.fetchedAt, undefined, true)}${tag}</span>`;
    } else if (loading) updated = '<span>Loading…</span>';
    const dots = state.places.map((_, i) => `<span class="${i === idx ? 'on' : ''}"></span>`).join('');
    return `<div class="header">
  <button type="button" class="place-btn" data-act="places" aria-label="${esc(title)}, ${esc(sub)}. Manage places">
    <span class="place-name">${esc(title)}${icon('chevron', 14, 2)}</span>
    <span class="place-sub">${esc(sub)}</span>
  </button>
  <div class="updated">${updated}
    <button type="button" class="icon-btn${loading ? ' spinning' : ''}" data-act="refresh" aria-label="Refresh">${icon('refresh', 20, 1.8)}</button>
  </div>
</div>
${state.failed.has(place.id) && rec ? '<div class="note" role="status">Couldn’t refresh. Showing the saved forecast.</div>' : ''}
<div class="dots" role="img" aria-label="Place ${idx + 1} of ${state.places.length}">${dots}</div>`;
  }

  function currentHTML(m) {
    const c = m.cur;
    const units = ['F', 'C'].map(u =>
      `<button type="button" data-act="units" data-unit="${u}" aria-pressed="${state.units === u}">°${u}</button>`).join('');
    return `<section class="current" aria-label="Current conditions">
  <div class="current-top">
    <div class="temp">${deg(c.temp)}</div>
    <div class="cond">
      ${icon(c.icon, m.isNight ? 40 : 48, 1.5, c.label)}
      <div class="cond-text">${esc(c.label)}</div>
      <div class="seg" role="group" aria-label="Temperature unit">${units}</div>
    </div>
  </div>
  <div class="chips">
    <div class="chip">${icon('thermo', 20, 1.8, null, 'var(--muted)')}<div><span class="k">Feels like</span><span class="v">${deg(c.feels)}</span></div></div>
    <div class="chip">${icon('wind', 20, 1.8, null, 'var(--muted)')}<div><span class="k">Wind</span><span class="v">${c.dir} ${speed(c.wind)}</span></div></div>
  </div>
</section>`;
  }

  function todayHTML(m) {
    const t = m.today;
    const snaps = t.snaps.map(s => s.missing ? `<div class="snap"><span class="t">${s.name}</span></div>` : `<div class="snap">
    <span class="t">${s.name}</span>
    ${icon(s.icon, 28, 1.6, s.label)}
    <span class="v">${deg(s.temp)}</span>
    ${t.anyRain ? `<span class="r">${s.pop >= 20 ? s.pop + '% rain' : ''}</span>` : ''}
  </div>`).join('');
    return `<section class="card" aria-label="Today">
  <div class="card-head"><span class="label">Today</span><span class="hl">H ${deg(t.hi)}&nbsp;&nbsp;<span class="lo">L ${deg(t.lo)}</span></span></div>
  <div class="snaps">${snaps}</div>
  ${t.anyRain ? '' : `<div class="no-rain">${icon('drop', 16, 1.8)}<span>No rain expected today</span></div>`}
</section>`;
  }

  const winRow = w => `<div class="win">
    <div><span class="n">${esc(w.name || 'Stars')}</span><span class="s">${esc(w.when)}</span></div>
    <div><span class="n v-${w.verdict.cls}">${esc(w.verdict.text)}</span><span class="s">${esc(w.detail)}</span></div>
  </div>`;

  function moonHTML(moon, size) {
    const times = [moon.rise && `Rises ${moon.rise}`, moon.set && `Sets ${moon.set}`].filter(Boolean).join(' · ');
    return `<div class="moon">${moonIcon(moon.phase, moon.fraction, size, moon.name + ' moon')}
    <div><span class="n">${moon.name} · ${moon.pct}% lit</span><span class="s">${times || 'No rise or set soon'}</span></div>
    <button type="button" class="icon-btn" data-act="outlook" aria-label="Star outlook for the next 10 nights">${icon('outlook', 22, 1.6)}</button>
  </div>`;
  }

  function starsHTML(m) {
    const s = m.stars;
    const best = s.best ? `<span class="pill ${s.best.verdict.cls}">Best: ${s.best.kind === 'tonight' ? 'tonight' : 'pre-dawn'}</span>` : '';
    return `<section class="card stars" aria-label="Stargazing">
  <div class="card-head"><span class="label">Stars</span>${best}</div>
  ${winRow(s.tonight)}${winRow(s.predawn)}
  ${moonHTML(s.moon, 36)}
</section>`;
  }

  function starsHeroHTML(m) {
    const h = m.stars.hero;
    return `<section class="card stars hero" aria-label="Stargazing">
  <div class="card-head"><span class="label">${h.title}</span>${icon('star', 22, 1.6, null, 'var(--star-icon)')}</div>
  <div class="hero-main">
    <span class="hero-verdict v-${h.win.verdict.cls}">${esc(h.win.verdict.text)}</span>
    <span class="hero-sum">${esc(h.summary)}</span>
    ${h.dark ? `<span class="hero-dark">${esc(h.dark)}</span>` : ''}
  </div>
  ${h.other.none ? '' : winRow(h.other)}
  ${moonHTML(m.stars.moon, 40)}
</section>`;
  }

  function weekHTML(m) {
    const range = Math.max(1, m.weekMax - m.weekMin);
    const rows = m.days.map(d => {
      const left = (d.lo - m.weekMin) / range * 100;
      const width = Math.max(2, (d.hi - d.lo) / range * 100);
      return `<div class="day" role="listitem" aria-label="${d.name}: ${esc(d.label)}, low ${deg(d.lo)}, high ${deg(d.hi)}${d.pop >= 20 ? `, ${d.pop}% chance of rain` : ''}">
    <span class="d">${d.name}</span>
    ${icon(d.icon, 24, 1.6, d.label)}
    <span class="p">${d.pop >= 20 ? d.pop + '%' : ''}</span>
    <span class="lo">${deg(d.lo)}</span>
    <div class="bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></div>
    <span class="hi">${deg(d.hi)}</span>
  </div>`;
    }).join('');
    return `<section class="card week" aria-label="7-day forecast"><span class="label">7 days</span><div role="list">${rows}</div></section>`;
  }

  function pageHTML(place, idx) {
    const rec = state.wx[place.id];
    let m = null;
    if (rec) {
      try { m = L.build(place, rec, Date.now()); } catch (e) { console.error(e); }
    }
    if (!m) {
      const failed = state.failed.has(place.id);
      return `<div class="content">${headerHTML(place, idx, null)}
<div class="empty">${failed ? '<span>Couldn’t load the forecast. Check your connection.</span><button type="button" class="btn" data-act="refresh">Try again</button>' : '<span>Loading forecast…</span>'}</div></div>`;
    }
    const sections = m.isNight && m.stars.hero
      ? [starsHeroHTML(m), currentHTML(m), todayHTML(m), weekHTML(m)]
      : [currentHTML(m), todayHTML(m), starsHTML(m), weekHTML(m)];
    return `${scenery(m)}<div class="content${m.isNight ? ' is-night' : ''}">${headerHTML(place, idx, rec)}${sections.join('')}</div>`;
  }

  const pager = document.getElementById('pager');

  function buildPages() {
    pager.innerHTML = state.places.map(p => `<div class="page" data-id="${esc(p.id)}"></div>`).join('');
    pager.querySelectorAll('.page').forEach(page => page.addEventListener('scroll', onPageScroll, { passive: true }));
    renderAll();
  }
  function renderPage(id) {
    const idx = state.places.findIndex(p => p.id === id);
    const page = pager.querySelector(`.page[data-id="${CSS.escape(id)}"]`);
    if (idx < 0 || !page) return;
    page.innerHTML = pageHTML(state.places[idx], idx);
    fadeScenery(page);
  }
  function renderAll() { state.places.forEach(p => renderPage(p.id)); }

  // Scenery fades a little as the content scrolls up over it.
  function fadeScenery(page) {
    const sc = page.querySelector('.scenery');
    if (sc) sc.style.opacity = Math.max(0.3, 1 - page.scrollTop / 450).toFixed(2);
  }
  function onPageScroll(e) { fadeScenery(e.currentTarget); }

  pager.addEventListener('scroll', () => {
    const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
    if (i !== state.active && i >= 0 && i < state.places.length) state.active = i;
  }, { passive: true });

  /* ---------- data ---------- */

  async function getJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  function forecastURL(p) {
    const q = new URLSearchParams({
      latitude: p.lat, longitude: p.lon,
      current: 'temperature_2m,apparent_temperature,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,cloud_cover,weather_code,is_day,visibility',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'auto', forecast_days: 11, timeformat: 'unixtime'
    });
    return 'https://api.open-meteo.com/v1/forecast?' + q;
  }

  async function refresh(place) {
    if (state.loading.has(place.id)) return;
    state.loading.add(place.id);
    renderPage(place.id);
    try {
      const data = await getJSON(forecastURL(place));
      if (!data || !data.hourly || !data.daily || !data.current) throw new Error('Bad response');
      const rec = { fetchedAt: Date.now(), data };
      state.wx[place.id] = rec;
      store.set(wxKey(place.id), rec);
      state.failed.delete(place.id);
    } catch (e) {
      state.failed.add(place.id);
    } finally {
      state.loading.delete(place.id);
      renderPage(place.id);
    }
  }

  async function refreshWhere(test) {
    const order = [state.places[state.active], ...state.places.filter((_, i) => i !== state.active)];
    for (const p of order) {
      if (!p) continue;
      const rec = state.wx[p.id];
      if (test(rec)) await refresh(p);
    }
  }
  const refreshAll = () => refreshWhere(() => true);
  const refreshOld = () => refreshWhere(rec => !rec || Date.now() - rec.fetchedAt > REFETCH_AFTER);

  /* ---------- interactions ---------- */

  pager.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const page = btn.closest('.page');
    const place = state.places.find(p => p.id === page.dataset.id);
    const act = btn.dataset.act;
    if (act === 'refresh' && place) refresh(place);
    else if (act === 'units') {
      state.units = btn.dataset.unit;
      store.set('sw.units', state.units);
      renderAll();
    } else if (act === 'places') openPlaces();
    else if (act === 'outlook' && place) openOutlook(place);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderAll();
    refreshOld();
  });
  window.addEventListener('online', refreshOld);
  setInterval(() => { if (document.visibilityState === 'visible') renderAll(); }, MIN);

  /* ---------- star outlook sheet ---------- */

  const outlookSheet = document.getElementById('outlook');
  const outlookList = document.getElementById('outlook-list');

  const slotRow = (name, w) => `<div class="slot${w.best ? ' best' : ''}">
    <div><span class="n">${name}</span><span class="s">${esc(w.when)}</span></div>
    <div><span class="n v-${w.verdict.cls}">${esc(w.verdict.text)}</span><span class="s">${esc(w.detail)}</span></div>
  </div>`;

  function outlookHTML(nights) {
    let out = '', farNoted = false;
    for (const n of nights) {
      if (n.far && !farNoted) {
        farNoted = true;
        out += '<p class="far-note">Low confidence: cloud forecasts this far out often change.</p>';
      }
      out += `<section class="night${n.far ? ' far' : ''}" aria-label="${esc(n.name)}, ${esc(n.date)}">
  <div class="night-head">${moonIcon(n.moon.phase, n.moon.fraction, 26, n.moon.name + ' moon')}
    <div><span class="n">${esc(n.name)}</span><span class="s">${esc(n.date)} · moon ${n.moon.pct}% lit</span></div>
    ${n.best ? '<span class="pill good">Best</span>' : ''}
  </div>
  ${slotRow('Evening', n.evening)}${slotRow('Morning', n.morning)}
</section>`;
    }
    return out;
  }

  function openOutlook(place) {
    const rec = state.wx[place.id];
    let m = null;
    try { m = rec && L.build(place, rec, Date.now()); } catch (e) { console.error(e); }
    if (!m) return;
    document.getElementById('outlook-sub').textContent = `${place.name} · next ${m.stars.outlook.length} nights`;
    outlookList.innerHTML = outlookHTML(m.stars.outlook);
    outlookList.scrollTop = 0;
    if (typeof outlookSheet.showModal === 'function') outlookSheet.showModal(); else outlookSheet.setAttribute('open', '');
  }
  function closeOutlook() { if (outlookSheet.open) outlookSheet.close ? outlookSheet.close() : outlookSheet.removeAttribute('open'); }
  document.getElementById('outlook-close').addEventListener('click', closeOutlook);
  outlookSheet.addEventListener('click', e => { if (e.target === outlookSheet) closeOutlook(); });

  /* ---------- places sheet ---------- */

  const sheet = document.getElementById('places');
  const list = document.getElementById('places-list');
  const results = document.getElementById('places-results');
  const search = document.getElementById('places-search');
  let found = [];

  const US_STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
  const regionOf = r => r.country_code === 'US' ? (US_STATES[r.admin1] || r.admin1 || 'US') : (r.country || r.admin1 || '');

  function renderPlaces() {
    const only = state.places.length === 1;
    list.innerHTML = state.places.map((p, i) => `<li>
  <div class="grow"><b>${esc(p.name)}</b><span>${esc(p.region)}</span></div>
  ${i === 0 ? '<span class="tag">Home</span>' : `<button type="button" class="text-btn" data-home="${i}">Make Home</button>`}
  <button type="button" class="icon-btn del" data-del="${i}" aria-label="Delete ${esc(p.name)}"${only ? ' disabled hidden' : ''}>${icon('trash', 18, 1.8)}</button>
</li>`).join('');
  }

  function openPlaces() {
    renderPlaces();
    search.value = '';
    results.innerHTML = '';
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
  }
  function closePlaces() { if (sheet.open) sheet.close ? sheet.close() : sheet.removeAttribute('open'); }
  document.getElementById('places-close').addEventListener('click', closePlaces);
  sheet.addEventListener('click', e => { if (e.target === sheet) closePlaces(); });

  function savePlaces() { store.set('sw.places', state.places); }

  list.addEventListener('click', e => {
    const home = e.target.closest('[data-home]');
    const del = e.target.closest('[data-del]');
    if (home) {
      const [p] = state.places.splice(+home.dataset.home, 1);
      state.places.unshift(p);
    } else if (del && state.places.length > 1) {
      const [p] = state.places.splice(+del.dataset.del, 1);
      store.del(wxKey(p.id));
      delete state.wx[p.id];
    } else return;
    savePlaces();
    state.active = 0;
    renderPlaces();
    buildPages();
    pager.scrollLeft = 0;
  });

  let searchTimer = 0, searchSeq = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(search.value.trim()); } });

  async function runSearch(q) {
    if (q.length < 2) return;
    const seq = ++searchSeq;
    results.innerHTML = '<li><span class="msg">Searching…</span></li>';
    try {
      const data = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json' }));
      if (seq !== searchSeq) return;
      found = (data.results || []);
      results.innerHTML = found.length ? found.map((r, i) => `<li><button type="button" class="pick" data-pick="${i}">
  <b>${esc(r.name)}</b><span>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></button></li>`).join('')
        : '<li><span class="msg">No places found.</span></li>';
    } catch {
      if (seq === searchSeq) results.innerHTML = '<li><span class="msg">Search needs a connection.</span></li>';
    }
  }

  results.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    const r = found[+pick.dataset.pick];
    const lat = Math.round(r.latitude * 100) / 100, lon = Math.round(r.longitude * 100) / 100;
    const id = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    let idx = state.places.findIndex(p => p.id === id);
    if (idx < 0) {
      state.places.push({ id, name: r.name, region: regionOf(r), lat, lon });
      savePlaces();
      idx = state.places.length - 1;
      buildPages();
      refresh(state.places[idx]);
    }
    closePlaces();
    state.active = idx;
    requestAnimationFrame(() => pager.scrollTo({ left: idx * pager.clientWidth, behavior: 'smooth' }));
  });

  /* ---------- start: cached first, network second ---------- */

  buildPages();
  refreshAll();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
