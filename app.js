(function () {
  'use strict';

  const L = window.SWLogic;
  const MIN = 6e4, HOUR = 36e5;
  const TIMEOUT_MS = 8000;
  const REFETCH_AFTER = 5 * MIN; // refresh automatically once the saved forecast is older than this
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
    active: 0,
    todayFlipped: false
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
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    sunrise: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v5M9.5 6.5L12 4l2.5 2.5M4.9 11.9l1.4 1.4M19.1 11.9l-1.4 1.4"/>',
    sunset: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 9V4M9.5 6.5L12 9l2.5-2.5M4.9 11.9l1.4 1.4M19.1 11.9l-1.4 1.4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    outlook: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M12 12.6l.85 1.8 1.85.85-1.85.85-.85 1.8-.85-1.8-1.85-.85 1.85-.85z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
  };
  function icon(name, size, sw, label, color) {
    const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || 'currentColor'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name]}</svg>`;
  }

  // Lit part of the moon drawn as an outer limb plus an elliptical terminator.
  // Path of the lit part in a 40x40 box ('' when new, 'full' when full).
  function moonLitPath(phase, fraction) {
    const r = 18, c = 20;
    if (fraction > 0.99) return 'full';
    if (fraction < 0.01) return '';
    const k = Math.cos(2 * Math.PI * phase);
    const rx = Math.abs(k) * r;
    const waxing = phase < 0.5;
    const crescent = k > 0;
    const limb = waxing ? 1 : 0;
    const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    return `M${c} ${c - r} A${r} ${r} 0 0 ${limb} ${c} ${c + r} A${rx.toFixed(2)} ${r} 0 0 ${term} ${c} ${c - r}z`;
  }
  function moonIcon(phase, fraction, size, label) {
    const r = 18, c = 20, d = moonLitPath(phase, fraction);
    const lit = d && d !== 'full' ? `<path d="${d}" style="fill:var(--moon-lit)"/>` : '';
    const full = d === 'full' ? `<circle cx="${c}" cy="${c}" r="${r}" style="fill:var(--moon-lit)"/>` : '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${esc(label)}"><circle cx="${c}" cy="${c}" r="${r}" style="fill:var(--moon-dark)"/>${full || lit}</svg>`;
  }

  /* ---------- background scenery ---------- */

  // Painted skies (tools/paint-skies.js), one per weather group, day/night, light/dark theme.
  function scenery(m) {
    let g = L.group(m.cur.code);
    if (g === 'thunder') g = 'rain';
    const t = m.cur.isDay ? 'day' : 'night';
    const moonlit = !m.cur.isDay && (g === 'clear' || g === 'partly') && m.stars.moon.upNow;
    return `<div class="scenery${moonlit ? ' moonlit' : ''}" style="--sky-light:url(img/sky/light-${t}-${g}.webp);--sky-dark:url(img/sky/dark-${t}-${g}.webp)" aria-hidden="true"></div>`;
  }

  /* ---------- formatting ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  const deg = f => Math.round(state.units === 'C' ? (f - 32) * 5 / 9 : f) + '°';
  const speed = mph => state.units === 'C' ? `${Math.round(mph * 1.609)} km/h` : `${Math.round(mph)} mph`;

  /* ---------- rendering ---------- */

  function headerHTML(place, idx, rec) {
    const title = place.name;
    // The place's own clock, shown only when it differs from the phone's (all stars and moon times use it).
    const tz = rec && rec.data && rec.data.timezone;
    const now = Date.now();
    const local = tz && L.time(now, tz, true) !== L.time(now, undefined, true) ? L.time(now, tz, true) : '';
    const loading = state.loading.has(place.id);
    let updated = '';
    if (rec) {
      const age = Date.now() - rec.fetchedAt;
      const tag = age > STALE_AFTER ? (navigator.onLine === false ? ' · offline' : ' · stale') : '';
      if (tag) updated = `<span class="stale">Updated ${L.time(rec.fetchedAt, undefined, true)}${tag}</span>`;
    } else if (loading) updated = '<span>Loading…</span>';
    // Page dots sit at the right of the header row (2+ places only).
    const n = state.places.length;
    const dots = n > 1 ? `<div class="dots" role="img" aria-label="Place ${idx + 1} of ${n}">${state.places.map((_, i) => `<span class="${i === idx ? 'on' : ''}"></span>`).join('')}</div>` : '';
    return `<div class="header">
  <button type="button" class="place-btn" data-act="places" aria-label="${esc(title)}${place.region ? ', ' + esc(place.region) : ''}${local ? ', local time ' + local : ''}. Manage places">
    <span class="place-name"><span class="city">${esc(title)}</span>${icon('chevron', 14, 2)}</span>${local ? `<span class="place-time">${local}</span>` : ''}
  </button>${dots}
  ${updated ? `<div class="updated">${updated}</div>` : ''}
</div>
${state.failed.has(place.id) && rec ? '<div class="note" role="status">Couldn’t refresh. Showing the saved forecast.</div>' : ''}`;
  }

  function currentHTML(m) {
    const c = m.cur, t = m.today;
    // Feels-like and wind only when they matter: 3°F+ off the actual temperature, 10 mph+ wind.
    const extra = [
      Math.abs(c.feels - c.temp) >= 3 && `Feels ${deg(c.feels)}`,
      c.wind >= 10 && `Wind ${c.dir} ${speed(c.wind)}`
    ].filter(Boolean).join(' · ');
    return `<section class="current" aria-label="Current conditions">
  <div class="current-top">
    <button type="button" class="temp" data-act="units-toggle" aria-label="${deg(c.temp)} ${state.units === 'C' ? 'Celsius' : 'Fahrenheit'}. Switch to ${state.units === 'C' ? 'Fahrenheit' : 'Celsius'}">${deg(c.temp)}</button>
    <div class="cond">
      <div class="cond-row">${icon(c.icon, 26, 1.6, null)}<span>${esc(c.label)}</span></div>
      <div class="hl">H ${deg(t.hi)}&nbsp;&nbsp;<span class="lo">L ${deg(t.lo)}</span></div>
      ${extra ? `<div class="meta">${esc(extra)}</div>` : ''}
    </div>
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
    const flipped = state.todayFlipped;
    return `<section class="card-flip${flipped ? ' flipped' : ''}" aria-label="Today">
  <div class="flip-inner" data-act="flip" role="button" tabindex="0" aria-pressed="${flipped}" aria-label="Today. Tap to ${flipped ? 'show the forecast' : 'show the temperature curve and sunrise and sunset'}">
    <div class="face front card glass" aria-hidden="${flipped}"><span class="label">Today</span><div class="snaps">${snaps}</div></div>
    <div class="face back card glass" aria-hidden="${!flipped}"><span class="label">Today</span>${dayCurveSVG(t)}</div>
  </div>
</section>`;
  }

  // The day's temperature as a smooth line, night hours shaded, sunrise and sunset marked with their times.
  function dayCurveSVG(t) {
    const pts = t.curve;
    if (pts.length < 2) return '<p class="curve-empty">No hourly data for today.</p>';
    const W = 326, H = 94, top = 30, bottom = 66;               // plot area y: top..bottom, labels below
    const temps = pts.map(p => p.temp), lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(4, hi - lo);
    const x = h => (h / 24) * W, y = v => bottom - (v - lo) / span * (bottom - top);
    const P = pts.map(p => [x(p.h), y(p.temp)]);
    // Catmull-Rom to Bezier for a smooth line through every hour.
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    const tempAt = h => { // linear between hours, for the "now" dot
      for (let i = 0; i < pts.length - 1; i++) if (h >= pts[i].h && h <= pts[i + 1].h) return pts[i].temp + (pts[i + 1].temp - pts[i].temp) * (h - pts[i].h) / (pts[i + 1].h - pts[i].h);
      return null;
    };
    let night = '', marks = '';
    if (t.sunriseH != null && t.sunsetH != null) {
      night = `<rect x="0" y="16" width="${x(t.sunriseH).toFixed(1)}" height="${bottom - 10}" rx="4" class="night"/><rect x="${x(t.sunsetH).toFixed(1)}" y="16" width="${(W - x(t.sunsetH)).toFixed(1)}" height="${bottom - 10}" rx="4" class="night"/>`;
      // Sun icon at the top of a dotted line, time centred underneath (kept inside the card).
      for (const [hh, name, label] of [[t.sunriseH, 'sunrise', t.sunrise], [t.sunsetH, 'sunset', t.sunset]]) {
        const cx = x(hh), tx = Math.min(W - 30, Math.max(30, cx));
        marks += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="16" y2="${bottom + 6}" class="sunline"/>
      <g transform="translate(${(cx - 9).toFixed(1)} -3) scale(.75)" class="sunicon"><path d="${PATHS[name].match(/d="([^"]+)"/)[1]}"/></g>
      <text x="${tx.toFixed(1)}" y="${bottom + 22}" text-anchor="middle" class="sunlbl">${esc(label)}</text>`;
      }
    }
    const iHi = temps.indexOf(hi), iLo = temps.indexOf(lo);
    const nt = tempAt(t.nowH);
    const srT = t.sunriseH != null ? tempAt(t.sunriseH) : null, ssT = t.sunsetH != null ? tempAt(t.sunsetH) : null;

    // Labels sit above the curve, placed in priority order: now, sunrise, sunset, high, low.
    // Each tries centred, then fully left or right; it must not touch a sunrise/sunset line or an earlier
    // label. If nothing fits it is dropped (e.g. a low right at sunrise shows once, as the sunrise temp).
    const lines = [t.sunriseH, t.sunsetH].filter(v => v != null).map(x);
    const placed = [], boxes = lines.map(lx => ({ l: lx - 9, r: lx + 9, t: -4, b: 15 })); // sun icons
    const shown = []; // [x, text] of placed labels, to skip a high/low that would repeat one nearby
    const wOf = txt => txt.length * 7.6 + 2, hit = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
    const curveYAt = px => { const v = tempAt(Math.min(pts[pts.length - 1].h, Math.max(pts[0].h, px / W * 24))); return v == null ? H : y(v); };
    const clearsCurve = box => { for (let px = box.l; px <= box.r; px += 3) if (box.b + 3 > curveYAt(px)) return false; return true; };
    function addLabel(hx, temp, cls, onLine, skipIfShown) {
      if (temp == null) return;
      const txt = deg(temp), w = wOf(txt), cx = x(hx);
      if (skipIfShown && shown.some(([sx, st]) => st === txt && Math.abs(sx - cx) < 60)) return;
      const sides = onLine ? [cx - 11 - w / 2, cx + 11 + w / 2] : [cx, cx - w / 2 - 8, cx + w / 2 + 8];
      for (const lift of [8, 16, 24]) for (const mid of sides) {
        const base = y(temp) - lift - (cls.includes('now') ? 2 : 0);
        const box = { l: mid - w / 2, r: mid + w / 2, t: base - 12, b: base + 2 };
        if (box.l < 0 || box.r > W || box.t < -2) continue;
        if (lines.some(lx => lx >= box.l - 3 && lx <= box.r + 3)) continue;
        if (boxes.some(o => hit(o, box)) || !clearsCurve(box)) continue;
        boxes.push(box); shown.push([cx, txt]);
        placed.push(`<text x="${mid.toFixed(1)}" y="${base.toFixed(1)}" text-anchor="middle" class="${cls}">${txt}</text>`);
        return;
      }
    }
    addLabel(t.nowH, nt, 'hilo nowlbl', false);
    addLabel(t.sunriseH, srT, 'hilo sunT', true);
    addLabel(t.sunsetH, ssT, 'hilo sunT', true);
    addLabel(pts[iHi].h, hi, 'hilo', false, true);
    if (iLo !== iHi) addLabel(pts[iLo].h, lo, 'hilo lo', false, true);

    const sunDots = [[t.sunriseH, srT], [t.sunsetH, ssT]].filter(([h, v]) => h != null && v != null)
      .map(([h, v]) => `<circle cx="${x(h).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="sundot"/>`).join('');
    const now = nt == null ? '' : `<circle cx="${x(t.nowH).toFixed(1)}" cy="${y(nt).toFixed(1)}" r="4" class="nowdot"/>`;
    const sr = t.sunrise ? `Sunrise ${t.sunrise}${srT != null ? ', ' + deg(srT) : ''}. ` : '';
    const ss = t.sunset ? `Sunset ${t.sunset}${ssT != null ? ', ' + deg(ssT) : ''}. ` : '';
    const nw = nt != null ? `Now ${deg(nt)}. ` : '';
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Temperature today from ${deg(lo)} to ${deg(hi)}. ${nw}${sr}${ss}`)}">
      ${night}<path d="${d}" class="line"/>${marks}${sunDots}${now}${placed.join('')}</svg>`;
  }

  const winRow = w => `<div class="win">
    <div><span class="n">${esc(w.name || 'Stars')}</span><span class="s">${esc(w.when)}</span></div>
    <div><span class="n v-${w.verdict.cls}">${esc(w.verdict.text)}</span><span class="s">${esc(w.detail)}</span></div>
  </div>`;

  function moonHTML(moon, size) {
    const times = [moon.rise && `Rises ${moon.rise}`, moon.set && `Sets ${moon.set}`].filter(Boolean).join(' · ');
    return `<div class="moon">${moonIcon(moon.phase, moon.fraction, size, moon.name + ' moon')}
    <div><button type="button" class="n moon-name" data-act="moon" aria-haspopup="dialog">${moon.name}</button><span class="n"> · ${moon.pct}% lit</span><span class="s">${times || 'No rise or set soon'}</span></div>
    <button type="button" class="icon-btn" data-act="outlook" aria-label="Star outlook for the next 7 nights">${icon('outlook', 22, 1.6)}</button>
  </div>`;
  }

  // Daytime: one line for the better of tonight / pre-dawn; details live in the outlook sheet.
  function starsHTML(m) {
    const s = m.stars, moon = s.moon;
    const w = s.best || (s.tonight.none ? s.predawn : s.tonight);
    const name = (w.name || 'Tonight').toLowerCase();
    return `<section class="card glass stars compact" aria-label="Stargazing">
  <div class="moon">
    <button type="button" class="moon-btn" data-act="moon" aria-haspopup="dialog" aria-label="${esc(moon.name)} moon, ${moon.pct}% lit">${moonIcon(moon.phase, moon.fraction, 34, moon.name + ' moon')}</button>
    <div><span class="n">Stars ${esc(name)}</span>${verdictMeter(w.verdict, 'sm', clearOf(w))}<span class="s">${esc([w.when, ...L.slotMarks(w).map(k => MARKS[k].label)].join(' · '))}</span><span class="s moon-line"><button type="button" class="moon-name" data-act="moon" aria-haspopup="dialog">${esc(moon.name)}</button> · ${moon.pct}% lit</span></div>
    <button type="button" class="icon-btn" data-act="outlook" aria-label="Star outlook for the next 7 nights">${icon('outlook', 22, 1.6)}</button>
  </div>
</section>`;
  }

  // Signal-style meter: 4 translucent bars (Great 4, Good 3, Fair 2, Poor none lit) beside the word.
  // Used on the night card, the daytime stars card and the outlook. States without a rating
  // ("Over", "No data", no window) show just the word.
  // With `clear` (0–100) the number replaces the word: e.g. bars + "96%" in the verdict colour.
  function verdictMeter(v, cls = '', clear = null) {
    const word = v.text.split(' · ')[0];
    if (v.score < 0) return `<span class="verdict ${cls} v-${v.cls}">${esc(word)}</span>`;
    const lit = Math.max(0, Math.min(4, v.score));
    const bars = [0, 1, 2, 3].map(i => `<i class="${i < lit ? 'on' : ''}"></i>`).join('');
    const shown = clear == null ? word : `${clear}%`;
    const label = `${word}, ${lit} of 4${clear == null ? '' : `, ${clear}% clear sky`}`;
    return `<span class="verdict ${cls} v-${v.cls}" role="img" aria-label="${esc(label)}"><span class="meter" aria-hidden="true">${bars}</span><span aria-hidden="true">${esc(shown)}</span></span>`;
  }
  const clearOf = w => (w && !w.none && !w.noData && w.cloud != null ? 100 - w.cloud : null);

  // Small marks for what besides cloud lowers a rating.
  const MARKS = {
    moon: { path: PATHS.moon, label: 'bright moon' },
    haze: { path: '<path d="M4 8h16M6 12h12M4 16h16"/>', label: 'haze or fog' },
    rain: { path: PATHS.drop, label: 'rain likely' }
  };
  const markIcon = k => `<svg class="mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MARKS[k].path}</svg>`;

  function starsHeroHTML(m) {
    const h = m.stars.hero;
    return `<section class="card stars hero" aria-label="Stargazing">
  <div class="hero-main">
    <div class="hero-text"><span class="label">${h.title}</span><span class="hero-sum">${esc(h.summary)}</span></div>
    ${verdictMeter(h.win.verdict, 'hero-verdict', clearOf(h.win))}
  </div>
  ${moonHTML(m.stars.moon, 40)}
</section>`;
  }

  // The next 6 days as small columns, like the Today card (today itself is in the Today card).
  function weekHTML(m) {
    const next = m.days.slice(1, 7);
    const cols = next.map(d => `<div class="md" role="listitem" aria-label="${d.name}: ${esc(d.label)}, high ${deg(d.hi)}, low ${deg(d.lo)}${d.pop >= 20 ? `, ${d.pop}% chance of rain` : ''}">
      <span class="t">${d.name}</span>${icon(d.icon, 24, 1.6)}
      <span class="r">${d.pop >= 20 ? d.pop + '%' : ''}</span>
      <span class="h">${deg(d.hi)}</span><span class="l">${deg(d.lo)}</span></div>`).join('');
    return `<section class="card glass week" aria-label="Next 6 days">
  <div class="week-head"><span class="label">Next 6 days</span></div>
  <div class="week-mini" role="list">${cols}</div>
</section>`;
  }

  // Flip in place (no re-render), on every page so swiping keeps the same side up.
  function toggleFlip() {
    state.todayFlipped = !state.todayFlipped;
    pager.querySelectorAll('.card-flip').forEach(c => {
      c.classList.toggle('flipped', state.todayFlipped);
      const inner = c.querySelector('.flip-inner');
      inner.setAttribute('aria-pressed', String(state.todayFlipped));
      inner.setAttribute('aria-label', `Today. Tap to ${state.todayFlipped ? 'show the forecast' : 'show the temperature curve and sunrise and sunset'}`);
      c.querySelector('.front').setAttribute('aria-hidden', String(state.todayFlipped));
      c.querySelector('.back').setAttribute('aria-hidden', String(!state.todayFlipped));
    });
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
    if (state.active >= state.places.length) state.active = 0;
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

  const lastTry = new Map(); // place id -> time of the last attempt, so failures retry every 5 min, not every minute
  async function refresh(place) {
    if (state.loading.has(place.id)) return;
    lastTry.set(place.id, Date.now());
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
      if (test(rec, p)) await refresh(p);
    }
  }
  const refreshAll = () => refreshWhere(() => true);
  // Places whose forecast is over 5 minutes old; `retryNow` skips the back-off (e.g. back online).
  const refreshOld = (retryNow = false) => refreshWhere((rec, p) => {
    const now = Date.now();
    const old = !rec || now - rec.fetchedAt > REFETCH_AFTER;
    return old && (retryNow === true || !lastTry.has(p.id) || now - lastTry.get(p.id) > REFETCH_AFTER);
  });

  /* ---------- interactions ---------- */

  pager.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const page = btn.closest('.page');
    const place = state.places.find(p => p.id === page.dataset.id);
    const act = btn.dataset.act;
    if (act === 'refresh' && place) refresh(place);
    else if (act === 'places') openPlaces();
    else if (act === 'flip') toggleFlip();
    else if (act === 'units-toggle') setUnits(state.units === 'C' ? 'F' : 'C');
    else if (act === 'outlook' && place) openOutlook(place);
    else if (act === 'moon' && place) openMoonInfo(place, btn);
  });

  pager.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.flip-inner')) { e.preventDefault(); toggleFlip(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderAll();
    refreshOld();
  });
  window.addEventListener('online', () => refreshOld(true));
  setInterval(() => { if (document.visibilityState === 'visible') { renderAll(); refreshOld(); } }, MIN);

  /* ---------- star outlook sheet ---------- */

  const outlookSheet = document.getElementById('outlook');
  const outlookList = document.getElementById('outlook-list');

  // One table cell: meter + clear-sky % in the verdict colour, plus marks for moon, haze or rain.
  function slotCell(w) {
    const full = `${w.when}: ${w.verdict.text}${w.detail ? ', ' + w.detail : ''}`;
    const v = w.none ? { text: '—', cls: 'poor', score: -1 } : w.verdict;
    const marks = L.slotMarks(w);
    const markHTML = marks.length ? `<span class="marks" role="img" aria-label="${esc(marks.map(k => MARKS[k].label).join(', '))}">${marks.map(markIcon).join('')}</span>` : '';
    return `<td class="cell${w.best ? ' best' : ''}" title="${esc(full)}">
      <span class="cell-line">${verdictMeter(v, 'n sm', w.past ? null : clearOf(w))}${markHTML}</span></td>`;
  }

  // "Clearest", moon and haze notes for one night's hours.
  function hoursSummary(hrs) {
    const live = hrs.filter(h => h.dark && !h.past);
    const out = [];
    const min = live.length ? Math.min(...live.map(h => h.cloud)) : 0;
    if (live.length && min >= 80) out.push('No clear spell');
    else if (live.length) {
      const i = hrs.indexOf(live.find(h => h.cloud === min));
      let a = i, b = i;
      const ok = h => h && h.dark && !h.past && h.cloud <= min + 5;
      while (ok(hrs[a - 1])) a--;
      while (ok(hrs[b + 1])) b++;
      out.push(`Clearest ${a === b ? hrs[a].label : `${hrs[a].label}–${hrs[b].label}`} · ${min}%`);
    }
    const up = hrs.map(h => h.moonUp), f = up.indexOf(true), l = up.lastIndexOf(true);
    if (f < 0) out.push('No moon');
    else if (f === 0 && l === hrs.length - 1) out.push('Moon up all night');
    else if (f === 0) out.push(`Moon sets ~${hrs[l].label}`);
    else if (l === hrs.length - 1) out.push(`Moon rises ~${hrs[f].label}`);
    else out.push(`Moon up ${hrs[f].label}–${hrs[l].label}`);
    for (const kind of ['fog', 'haze']) {
      const h = hrs.find(x => x.haze === kind);
      if (h) { out.push(`${kind === 'fog' ? 'Fog' : 'Haze'} from ${h.label}`); break; }
    }
    const pop = Math.max(...hrs.map(h => h.pop));
    if (pop >= 30) out.push(`Rain chance up to ${pop}%`);
    return out.join(' · ');
  }

  // Hourly cloud bars from sunset to sunrise; star windows shaded, moon-up hours dotted.
  function hoursHTML(hrs) {
    if (!hrs.length) return '<p class="hsum">Hourly detail isn’t available this far out.</p>';
    const cols = `style="grid-template-columns:repeat(${hrs.length},minmax(0,1fr))"`;
    const cls = h => [h.evening || h.morning ? 'win' : '', h.past ? 'past' : ''].filter(Boolean).join(' ');
    const bars = hrs.map(h => `<div class="hb ${cls(h)}" title="${h.label}: ${h.cloud}% cloud${h.moonUp ? ', moon up' : ''}${h.haze ? ', ' + h.haze : ''}">
      <span class="pct">${h.cloud}</span><i style="height:${Math.max(2, Math.round(h.cloud * 0.54))}px"></i></div>`).join('');
    const moon = hrs.map(h => `<span class="${cls(h)}">${h.moonUp ? '<b></b>' : ''}</span>`).join('');
    const labels = hrs.map((h, i) => `<span class="${cls(h)}">${i % 2 ? '' : h.label}</span>`).join('');
    return `<div class="hours" role="img" aria-label="Hourly cloud cover: ${esc(hrs.map(h => `${h.label} ${h.cloud}%`).join(', '))}">
  <div class="hrow hbars" ${cols}>${bars}</div>
  <div class="hrow hmoon" ${cols}>${moon}</div>
  <div class="hrow hlabels" ${cols}>${labels}</div>
</div>
<div class="hlegend"><span><i class="sw win"></i>Star windows</span><span><i class="sw bar"></i>Cloud %</span><span><b></b>Moon up</span></div>
<p class="hsum">${esc(hoursSummary(hrs))}</p>`;
  }

  function outlookHTML(nights) {
    let rows = '', farNoted = false;
    for (const n of nights) {
      if (n.far && !farNoted) {
        farNoted = true;
        rows += '<tr class="far-note"><td colspan="4">Low confidence: forecasts this far out often change.</td></tr>';
      }
      const id = 'night-' + n.date.replace(/\W/g, '');
      rows += '<tr class="sep" aria-hidden="true"><td colspan="4"></td></tr>';
      rows += `<tr class="night-row${n.far ? ' far' : ''}" data-night="${id}" tabindex="0" role="button" aria-expanded="false" aria-controls="${id}">
    <th scope="row"><span class="n">${esc(n.name)}${n.best ? ` ${icon('star', 13, 2, 'Best night', 'var(--star-icon)')}` : ''}</span><span class="s">${esc(n.date)}</span></th>
    <td class="mn">${moonIcon(n.moon.phase, n.moon.fraction, 20, n.moon.name + ' moon')}<span class="s">${n.moon.pct}%</span></td>
    ${slotCell(n.evening)}${slotCell(n.morning)}
  </tr>
  <tr class="night-detail${n.far ? ' far' : ''}" id="${id}" hidden><td colspan="4">${hoursHTML(n.hours)}</td></tr>`;
    }
    return `<table class="outlook-table">
  <thead><tr><th scope="col">Night</th><th scope="col">Moon</th>
    <th scope="col">Evening<span class="s">dark → 1 am</span></th><th scope="col">Morning<span class="s">4:30 → dawn</span></th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="outlook-legend">% = clear sky<span>${markIcon('moon')} bright moon</span><span>${markIcon('haze')} haze</span><span>${markIcon('rain')} rain</span></p>`;
  }

  function openOutlook(place) {
    const rec = state.wx[place.id];
    let m = null;
    try { m = rec && L.build(place, rec, Date.now()); } catch (e) { console.error(e); }
    if (!m) return;
    document.getElementById('outlook-share').setAttribute('aria-label', `Share the star outlook for ${place.name}`);
    outlookList.innerHTML = outlookHTML(m.stars.outlook);
    outlookList.scrollTop = 0;
    // Prepare the share image now: iOS only opens the share sheet straight after a tap.
    shareReady = null;
    sharePrep = prepareShare(place, m).then(d => (shareReady = d)).catch(e => { console.error(e); return null; });
    if (typeof outlookSheet.showModal === 'function') outlookSheet.showModal(); else outlookSheet.setAttribute('open', '');
  }
  function toggleNight(row) {
    const detail = document.getElementById(row.dataset.night);
    const open = detail.hidden;
    detail.hidden = !open;
    row.setAttribute('aria-expanded', String(open));
    row.classList.toggle('open', open);
  }
  outlookList.addEventListener('click', e => {
    const row = e.target.closest('.night-row');
    if (row) toggleNight(row);
  });
  outlookList.addEventListener('keydown', e => {
    const row = e.target.closest('.night-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleNight(row); }
  });

  function closeOutlook() { if (outlookSheet.open) outlookSheet.close ? outlookSheet.close() : outlookSheet.removeAttribute('open'); }
  document.getElementById('outlook-close').addEventListener('click', closeOutlook);

  /* ---------- share the star outlook: a drawn image plus a one-line message ---------- */

  let sharePrep = null, shareReady = null;
  const SHARE_COLORS = { good: '#63D6A8', fair: '#F2B36B', poor: '#9AA8BC' };

  function loadImage(src) {
    return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  }

  // A mark icon on the canvas, from the same SVG path as in the app.
  function drawMark(c, k, x, y, size) {
    c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
    c.strokeStyle = '#9AA8BC'; c.lineWidth = 2.2; c.lineCap = 'round'; c.lineJoin = 'round';
    const d = MARKS[k].path.match(/d="([^"]+)"/g).map(s => s.slice(3, -1));
    d.forEach(p => c.stroke(new Path2D(p)));
    c.restore();
  }

  async function drawOutlookImage(place, m) {
    const nights = m.stars.outlook;
    const W = 1080, pad = 56, headH = 150, colH = 104, rowH = 128, footH = 150;
    const H = pad + headH + colH + rowH * nights.length + footH;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    try { await document.fonts.load('600 40px Manrope'); } catch { /* system font */ }
    const font = (w, px) => `${w} ${px}px Manrope, -apple-system, Helvetica, sans-serif`;

    // Night sky behind a translucent card, as in the app's dark theme.
    c.fillStyle = '#0B1220'; c.fillRect(0, 0, W, H);
    try {
      const sky = await loadImage('img/sky/dark-night-clear.webp');
      const h = W * sky.height / sky.width;
      c.drawImage(sky, 0, 0, W, h);
      const fade = c.createLinearGradient(0, h * 0.55, 0, h);
      fade.addColorStop(0, 'rgba(11,18,32,0)'); fade.addColorStop(1, '#0B1220');
      c.fillStyle = fade; c.fillRect(0, h * 0.55, W, h * 0.45 + 1);
    } catch { /* plain background */ }

    c.textBaseline = 'alphabetic';
    c.fillStyle = '#E6ECF5'; c.font = font(600, 60); c.textAlign = 'left';
    c.fillText('Star outlook', pad, pad + 70);
    c.fillStyle = '#9AA8BC'; c.font = font(500, 40); c.textAlign = 'right';
    c.fillText(place.name, W - pad, pad + 68);

    const x0 = pad, cw = W - pad * 2, top = pad + headH;
    const rr = 32;
    c.fillStyle = 'rgba(21,30,48,.78)';
    c.beginPath();
    if (c.roundRect) c.roundRect(x0, top, cw, colH + rowH * nights.length, rr); else c.rect(x0, top, cw, colH + rowH * nights.length);
    c.fill();

    const cols = [x0 + 40, x0 + cw * 0.31, x0 + cw * 0.5, x0 + cw * 0.75];
    const colW = cw * 0.25;
    c.textAlign = 'left';
    const heads = [['NIGHT'], ['MOON'], ['EVENING', 'dark → 1 am'], ['MORNING', '4:30 → dawn']];
    heads.forEach(([h, s], i) => {
      c.fillStyle = '#9AA8BC'; c.font = font(600, 26); c.fillText(h, cols[i], top + (s ? 46 : 62));
      if (s) { c.font = font(500, 26); c.fillText(s, cols[i], top + 82); }
    });

    const divider = y => {
      const g = c.createLinearGradient(x0, 0, x0 + cw, 0);
      g.addColorStop(0, 'rgba(36,48,74,0)'); g.addColorStop(0.14, '#24304A'); g.addColorStop(0.86, '#24304A'); g.addColorStop(1, 'rgba(36,48,74,0)');
      c.fillStyle = g; c.fillRect(x0, y, cw, 2);
    };

    nights.forEach((n, k) => {
      const y = top + colH + rowH * k;
      divider(y);
      // best cell highlight
      for (const [w, i] of [[n.evening, 2], [n.morning, 3]]) {
        if (w.best) { c.fillStyle = 'rgba(99,214,168,.14)'; c.fillRect(cols[i] - 18, y + 2, colW, rowH - 2); }
      }
      c.fillStyle = '#E6ECF5'; c.font = font(600, 36); c.fillText(n.name, cols[0], y + 58);
      if (n.best) { c.fillStyle = '#F2C46D'; c.fillText('★', cols[0] + c.measureText(n.name).width + 12, y + 56); }
      c.fillStyle = '#9AA8BC'; c.font = font(500, 28); c.fillText(n.date, cols[0], y + 98);
      // moon
      const ms = 1.3, mx = cols[1], my = y + rowH / 2 - 20 * ms;
      c.save(); c.translate(mx, my); c.scale(ms, ms);
      c.fillStyle = '#2A3550'; c.beginPath(); c.arc(20, 20, 18, 0, Math.PI * 2); c.fill();
      const d = moonLitPath(n.moon.phase, n.moon.fraction);
      c.fillStyle = '#F1E4BE';
      if (d === 'full') { c.beginPath(); c.arc(20, 20, 18, 0, Math.PI * 2); c.fill(); } else if (d) c.fill(new Path2D(d));
      c.restore();
      c.fillStyle = '#9AA8BC'; c.font = font(500, 28); c.fillText(`${n.moon.pct}%`, mx + 40 * ms + 12, y + rowH / 2 + 10);
      // windows
      for (const [w, i] of [[n.evening, 2], [n.morning, 3]]) {
        const clear = w.past ? null : clearOf(w);
        const word = w.none ? '—' : clear != null && w.verdict.score >= 0 ? `${clear}%` : w.verdict.text.split(' · ')[0];
        const base = y + 76;
        const col = SHARE_COLORS[w.verdict.cls] || '#9AA8BC';
        let tx = cols[i];
        if (!w.none && w.verdict.score >= 0) {
          // the same 4-bar meter as in the app: lit bars in the verdict colour at 50%, unlit faint
          const lit = Math.min(4, w.verdict.score);
          [12, 19, 26, 33].forEach((h, b) => {
            c.globalAlpha = b < lit ? 0.5 : 1;
            c.fillStyle = b < lit ? col : 'rgba(154,168,188,.14)';
            c.beginPath();
            if (c.roundRect) c.roundRect(tx + b * 13, base - h, 8, h, 3); else c.rect(tx + b * 13, base - h, 8, h);
            c.fill();
          });
          c.globalAlpha = 1;
          tx += 4 * 13 + 10;
        }
        c.fillStyle = col; c.font = font(600, 36); c.fillText(word, tx, base);
        let mx2 = tx + c.measureText(word).width + 12;
        for (const k of L.slotMarks(w)) { drawMark(c, k, mx2, base - 26, 26); mx2 += 32; }
      }
    });

    // legend + footer
    c.fillStyle = '#9AA8BC'; c.font = font(500, 26); c.textAlign = 'left';
    let lx = x0 + 40; const ly = top + colH + rowH * nights.length + 52;
    c.fillText('% = clear sky', lx, ly); lx += c.measureText('% = clear sky').width + 34;
    for (const k of ['moon', 'haze', 'rain']) {
      drawMark(c, k, lx, ly - 22, 24); lx += 32;
      c.fillStyle = '#9AA8BC'; c.fillText(MARKS[k].label, lx, ly); lx += c.measureText(MARKS[k].label).width + 30;
    }
    c.fillStyle = '#6F7E95'; c.font = font(500, 26); c.textAlign = 'center';
    c.fillText(`Simple Weather · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, W / 2, H - 30);
    return new Promise(ok => cv.toBlob(ok, 'image/png'));
  }

  async function prepareShare(place, m) {
    const text = L.shareText(place.name, m.stars.outlook, m.tz);
    const blob = await drawOutlookImage(place, m);
    const file = blob && new File([blob], 'star-outlook.png', { type: 'image/png' });
    return { text, file };
  }

  function shareOutlook() {
    const go = d => {
      if (!d) return;
      const withFile = d.file ? { text: d.text, files: [d.file] } : null;
      let p;
      if (withFile && navigator.canShare && navigator.canShare(withFile)) p = navigator.share(withFile);
      else if (navigator.share) p = navigator.share({ text: d.text });
      else {
        // No share sheet (desktop): save the image and copy the message.
        if (d.file) { const a = document.createElement('a'); a.href = URL.createObjectURL(d.file); a.download = d.file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
        if (navigator.clipboard) navigator.clipboard.writeText(d.text).catch(() => {});
        return;
      }
      p.catch(e => { if (e && e.name !== 'AbortError') console.error(e); });
    };
    if (shareReady) go(shareReady); else if (sharePrep) sharePrep.then(go);
  }
  document.getElementById('outlook-share').addEventListener('click', shareOutlook);
  outlookSheet.addEventListener('click', e => { if (e.target === outlookSheet) closeOutlook(); });

  /* ---------- moon phase explainer ---------- */

  const WIKI = 'https://en.wikipedia.org/wiki/';
  const PHASE_INFO = {
    'New moon': {
      wiki: 'New_moon',
      body: 'The <b>new moon</b> is the first lunar phase, when the Moon lies roughly between Earth and the Sun. Its sunlit side faces away from us, so the Moon is effectively invisible, lost in the Sun’s glare. It rises and sets with the Sun.',
      sky: 'The darkest nights of the month. Moonlight adds nothing to the sky, so faint galaxies, nebulae and the Milky Way are at their best.'
    },
    'Waxing crescent': {
      wiki: 'Lunar_phase',
      body: 'A <b>waxing crescent</b> is a thin, growing sliver of Moon seen in the western sky after sunset, in the days after new moon. <i>Waxing</i> means the lit portion is increasing; <i>crescent</i> comes from the Latin <i>crescere</i>, “to grow”. The unlit part often glows faintly with <i>earthshine</i>, sunlight reflected off Earth.',
      sky: 'Sets a few hours after the Sun, so the rest of the night is dark. A good time for deep-sky viewing once it has set.'
    },
    'First quarter': {
      wiki: 'Lunar_phase',
      body: 'At <b>first quarter</b>, about a week after new moon, the Moon has completed a quarter of its orbit and appears exactly half lit (the right half, seen from the Northern Hemisphere). It rises around midday and sets around midnight.',
      sky: 'The evening sky is moderately bright, but after the Moon sets near midnight the sky is dark. Craters along the shadow line (the <i>terminator</i>) look sharp through binoculars.'
    },
    'Waxing gibbous': {
      wiki: 'Lunar_phase',
      body: 'A <b>waxing gibbous</b> Moon is more than half lit and still growing toward full. <i>Gibbous</i> comes from the Latin <i>gibbus</i>, “hump”, for its bulging shape. It rises in the afternoon and sets after midnight, getting later each night.',
      sky: 'Bright moonlight fills most of the night. The darkest stretch is the pre-dawn window, after the Moon has set.'
    },
    'Full moon': {
      wiki: 'Full_moon',
      body: 'The <b>full moon</b> occurs when the Moon is opposite the Sun in the sky, so the whole face we see is lit. It rises around sunset, sets around sunrise and is up all night. Traditional names mark each month’s full moon, such as the Harvest and Hunter’s moons in autumn.',
      sky: 'The brightest night of the month. Moonlight washes out the Milky Way and faint objects, though bright planets, stars and the Moon itself are still rewarding.'
    },
    'Waning gibbous': {
      wiki: 'Lunar_phase',
      body: 'A <b>waning gibbous</b> Moon is past full and shrinking, but still more than half lit. <i>Waning</i> means the lit portion is decreasing. It rises after sunset, about 50 minutes later each night, and is still up after sunrise.',
      sky: 'The early evening, before moonrise, is dark. Once the Moon is up, the rest of the night is bright.'
    },
    'Last quarter': {
      wiki: 'Lunar_phase',
      body: 'At <b>last quarter</b> (also called third quarter), about three weeks after new moon, the Moon is again half lit, this time the left half seen from the Northern Hemisphere. It rises around midnight and sets around midday.',
      sky: 'Evenings are dark until the Moon rises near midnight, which makes this a good phase for early-night stargazing.'
    },
    'Waning crescent': {
      wiki: 'Lunar_phase',
      body: 'A <b>waning crescent</b> is the thinning sliver before the next new moon, seen low in the east in the hours before dawn. Like the waxing crescent, its dark part may show faint earthshine.',
      sky: 'Rises only shortly before the Sun, so nearly the whole night is dark. Excellent for deep-sky viewing.'
    }
  };

  const moonSheet = document.getElementById('moon-info');
  function openMoonInfo(place, anchor) {
    const rec = state.wx[place.id];
    let m = null;
    try { m = rec && L.build(place, rec, Date.now()); } catch (e) { console.error(e); }
    if (!m) return;
    const moon = m.stars.moon, info = PHASE_INFO[moon.name];
    if (!info) return;
    const age = moon.phase * 29.53;
    moonSheet.innerHTML = `<div class="pop-head">
    ${moonIcon(moon.phase, moon.fraction, 56, moon.name + ' moon')}
    <div><h2 id="moon-info-title">${esc(moon.name)}</h2><span class="s">Lunar phase · day ${Math.round(age)} of 29.5</span></div>
    <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close', 20, 1.8)}</button>
  </div>
  <p>${info.body}</p>
  <h3>For stargazing</h3>
  <p>${info.sky}</p>
  <a href="${WIKI}${info.wiki}" target="_blank" rel="noopener">Read more on Wikipedia →</a>`;
    if (typeof moonSheet.showModal === 'function') moonSheet.showModal(); else moonSheet.setAttribute('open', '');
    // Anchor the card just below the tapped name, like a link preview, keeping it on screen.
    const r = (anchor.closest('.moon') || anchor).getBoundingClientRect();
    const h = moonSheet.offsetHeight, vh = window.innerHeight;
    const top = r.bottom + 8 + h <= vh - 12 ? r.bottom + 8 : Math.max(12, r.top - 8 - h);
    moonSheet.style.top = Math.max(12, Math.min(top, vh - h - 12)) + 'px';
  }
  function closeMoonInfo() { if (moonSheet.open) moonSheet.close ? moonSheet.close() : moonSheet.removeAttribute('open'); }
  moonSheet.addEventListener('click', e => { if (e.target === moonSheet || e.target.closest('[data-close]')) closeMoonInfo(); });

  /* ---------- places sheet ---------- */

  const sheet = document.getElementById('places');
  const list = document.getElementById('places-list');
  const results = document.getElementById('places-results');
  const search = document.getElementById('places-search');
  let found = [];

  const US_STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
  const regionOf = r => r.country_code === 'US' ? (US_STATES[r.admin1] || r.admin1 || 'US') : (r.country || r.admin1 || '');

  const unitsSeg = document.getElementById('units');
  function setUnits(u) {
    state.units = u;
    store.set('sw.units', u);
    renderUnits();
    renderAll();
  }
  function renderUnits() {
    unitsSeg.querySelectorAll('[data-unit]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === state.units)));
  }
  unitsSeg.addEventListener('click', e => {
    const b = e.target.closest('[data-unit]');
    if (b) setUnits(b.dataset.unit);
  });

  function renderPlaces() {
    renderUnits();
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
    sheet.classList.remove('searching');
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
  // While typing, the sheet shows only the search box and results, top-aligned above the keyboard.
  const vv = window.visualViewport;
  function syncViewport() {
    if (!vv) return;
    sheet.style.setProperty('--vv-top', vv.offsetTop + 'px');
    sheet.style.setProperty('--vv-h', vv.height + 'px');
  }
  if (vv) { vv.addEventListener('resize', syncViewport); vv.addEventListener('scroll', syncViewport); }
  const setSearching = () => { syncViewport(); sheet.classList.toggle('searching', search.value.trim().length > 0); };
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    setSearching();
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
      // The geocoder only matches names, so search the city part and filter by country/state ourselves.
      found = [];
      for (const { name, quals } of L.placeQueries(q)) {
        if (name.length < 2) continue;
        const data = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: quals.length ? 50 : 20, language: 'en', format: 'json' }));
        if (seq !== searchSeq) return;
        found = L.rankPlaces((data.results || []).filter(r => L.placeMatches(r, quals)), name).slice(0, 5);
        if (found.length) break;
      }
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
    // When an update takes over an already-running page, reload once so the new version shows now.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Home-screen apps often resume rather than relaunch; check for updates when brought back.
      document.addEventListener('visibilitychange', () => {
        if (reg && document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
})();
