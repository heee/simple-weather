/* Pure forecast + stargazing logic. No DOM access, so it also runs under Node for tests. */
(function (root) {
  'use strict';

  const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
  const RAD = Math.PI / 180;
  const MOON_H0 = 0.133 * RAD; // same horizon altitude SunCalc uses for moonrise/set
  const SunCalc = root.SunCalc;

  /* ---------- time, always in the place's own time zone ---------- */

  const fmts = new Map();
  function parts(ms, tz) {
    const key = tz || '';
    let f = fmts.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
      });
      fmts.set(key, f);
    }
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { date: `${o.year}-${o.month}-${o.day}`, h: +o.hour % 24, m: +o.minute, wd: o.weekday };
  }

  function clock(ms, tz, withMinutes) {
    const p = parts(ms, tz);
    const h = p.h % 12 || 12;
    return { t: p.m || withMinutes ? `${h}:${String(p.m).padStart(2, '0')}` : `${h}`, ap: p.h < 12 ? 'am' : 'pm' };
  }
  const time = (ms, tz, withMinutes) => { const c = clock(ms, tz, withMinutes); return `${c.t} ${c.ap}`; };
  function span(a, b, tz) {
    const x = clock(a, tz), y = clock(b, tz);
    return x.ap === y.ap ? `${x.t} – ${y.t} ${y.ap}` : `${x.t} ${x.ap} – ${y.t} ${y.ap}`;
  }
  const round5 = ms => Math.round(ms / (5 * MIN)) * 5 * MIN;
  const mdFmts = new Map();
  function monthDay(ms, tz) {
    const key = tz || '';
    let f = mdFmts.get(key);
    if (!f) mdFmts.set(key, f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, month: 'short', day: 'numeric' }));
    return f.format(new Date(ms));
  }
  const valid = d => d instanceof Date && !isNaN(d);

  /* ---------- weather codes (WMO) ---------- */

  function group(c) {
    if (c <= 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'cloudy';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 95) return 'thunder';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    return 'rain';
  }

  const LABELS = {
    2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail'
  };
  function label(c, isDay) {
    if (c === 0) return isDay ? 'Sunny' : 'Clear';
    if (c === 1) return isDay ? 'Mostly sunny' : 'Mostly clear';
    return LABELS[c] || 'Cloudy';
  }
  function iconName(c, isDay) {
    const g = group(c);
    if (g === 'clear') return isDay ? 'sun' : 'moon';
    if (g === 'partly') return isDay ? 'partly' : 'partlyNight';
    return g;
  }

  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = deg => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

  /* ---------- moon ---------- */

  const moonAlt = (ms, lat, lon) => SunCalc.getMoonPosition(new Date(ms), lat, lon).altitude - MOON_H0;

  // First rise and first set after `from`, found by scanning altitude in 10-minute steps.
  function moonEvents(from, hours, lat, lon) {
    const step = 10 * MIN;
    const refine = (a, b) => {
      const up = moonAlt(b, lat, lon) > 0;
      for (let i = 0; i < 8; i++) {
        const m = (a + b) / 2;
        if ((moonAlt(m, lat, lon) > 0) === up) b = m; else a = m;
      }
      return b;
    };
    let rise = null, set = null, prev = moonAlt(from, lat, lon);
    for (let t = from + step; t <= from + hours * HOUR && (rise === null || set === null); t += step) {
      const a = moonAlt(t, lat, lon);
      if (prev <= 0 && a > 0 && rise === null) rise = refine(t - step, t);
      if (prev > 0 && a <= 0 && set === null) set = refine(t - step, t);
      prev = a;
    }
    return { rise, set };
  }

  function phaseName(p) {
    if (p < 0.03 || p > 0.97) return 'New moon';
    if (p < 0.22) return 'Waxing crescent';
    if (p < 0.28) return 'First quarter';
    if (p < 0.47) return 'Waxing gibbous';
    if (p < 0.53) return 'Full moon';
    if (p < 0.72) return 'Waning gibbous';
    if (p < 0.78) return 'Last quarter';
    return 'Waning crescent';
  }

  /* ---------- stargazing ---------- */

  const VERDICTS = {
    great: { text: 'Great', cls: 'good', score: 4 },
    good: { text: 'Good', cls: 'good', score: 3 },
    fairMoon: { text: 'Fair · bright moon', cls: 'fair', score: 2 },
    fair: { text: 'Fair', cls: 'fair', score: 2 },
    poor: { text: 'Poor', cls: 'poor', score: 0 }
  };

  function cloudClass(avg) { return avg <= 20 ? 'Clear' : avg <= 50 ? 'Partly' : 'Cloudy'; }

  // Lowest visibility in the window (metres): under 1 km is fog, under 5 km is haze.
  function hazeClass(minVis) { return minVis < 1000 ? 'fog' : minVis < 5000 ? 'haze' : null; }

  function verdict(sky, bright, maxPop) {
    if (maxPop >= 40 || sky === 'Cloudy') return VERDICTS.poor;
    if (sky === 'Clear') return bright ? VERDICTS.fairMoon : VERDICTS.great;
    return bright ? VERDICTS.fair : VERDICTS.good;
  }

  // Cloud, rain and moon over [start, end), using every hourly slot that overlaps the window.
  function windowStats(w, H, lat, lon) {
    const clouds = [], pops = [], vis = [];
    for (let i = 0; i < H.time.length; i++) {
      const t = H.time[i] * 1000;
      if (t + HOUR > w.start && t < w.end) {
        clouds.push(H.cloud_cover[i]);
        pops.push(H.precipitation_probability[i] ?? 0);
        if (H.visibility && H.visibility[i] != null) vis.push(H.visibility[i]);
      }
    }
    let up = 0, n = 0;
    for (let t = w.start; t <= w.end; t += 10 * MIN, n++) if (moonAlt(t, lat, lon) > 0) up++;
    const lit = SunCalc.getMoonIllumination(new Date((w.start + w.end) / 2)).fraction;
    const moonUpShare = n ? up / n : 0;
    const bright = moonUpShare > 0.5 && lit > 0.5;
    if (!clouds.length) return { ...w, noData: true, bright, moonUpShare, lit };
    const cloud = Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length);
    const maxPop = Math.max(...pops);
    const sky = cloudClass(cloud);
    const haze = vis.length ? hazeClass(Math.min(...vis)) : null;
    const v = haze === 'fog' ? VERDICTS.poor : verdict(sky, bright, maxPop);
    return { ...w, cloud, maxPop, sky, haze, bright, moonUpShare, lit, verdict: v };
  }

  /* ---------- the whole screen model for one place ---------- */

  function build(place, rec, now) {
    const data = rec.data;
    const tz = data.timezone;
    const H = data.hourly, D = data.daily, C = data.current;
    const { lat, lon } = place;
    const ms = s => s * 1000;

    const today = parts(now, tz).date;
    let ti = D.time.findIndex(t => parts(ms(t) + 12 * HOUR, tz).date === today);
    if (ti < 0) ti = now < ms(D.time[0]) ? 0 : D.time.length - 1;
    const dayStart = i => (i >= 0 && i < D.time.length) ? ms(D.time[i]) : ms(D.time[0]) + i * DAY;
    const sunTimes = i => SunCalc.getTimes(new Date(dayStart(i) + 12 * HOUR), lat, lon);

    const hourAt = new Map();
    H.time.forEach((t, i) => { const p = parts(ms(t), tz); hourAt.set(`${p.date}T${p.h}`, i); });

    const sunrise = ms(D.sunrise[ti]), sunset = ms(D.sunset[ti]);
    const isNight = now >= sunset || now < sunrise;

    // Current conditions; once the saved data is over an hour old, the hourly forecast is closer to the truth.
    const cur = {
      temp: C.temperature_2m, feels: C.apparent_temperature, code: C.weather_code, isDay: !!C.is_day,
      cloud: C.cloud_cover, wind: C.wind_speed_10m, dir: compass(C.wind_direction_10m)
    };
    const nowP = parts(now, tz);
    const hi = hourAt.get(`${nowP.date}T${nowP.h}`);
    if (now - rec.fetchedAt > 75 * MIN && hi !== undefined) {
      cur.feels += H.temperature_2m[hi] - cur.temp;
      cur.temp = H.temperature_2m[hi];
      cur.code = H.weather_code[hi];
      cur.isDay = !!H.is_day[hi];
      cur.cloud = H.cloud_cover[hi];
    }
    cur.label = label(cur.code, cur.isDay);
    cur.icon = iconName(cur.code, cur.isDay);

    // Today card
    const snaps = [['Morning', 7], ['Noon', 12], ['Evening', 18], ['Night', 22]].map(([name, h]) => {
      const i = hourAt.get(`${today}T${h}`);
      if (i === undefined) return { name, missing: true };
      const isDay = !!H.is_day[i];
      return { name, temp: H.temperature_2m[i], pop: H.precipitation_probability[i] ?? 0,
        icon: iconName(H.weather_code[i], isDay), label: label(H.weather_code[i], isDay) };
    });
    const todayCard = {
      hi: D.temperature_2m_max[ti], lo: D.temperature_2m_min[ti], snaps,
      anyRain: snaps.some(s => !s.missing && s.pop >= 20)
    };

    // 7 days
    const days = [];
    for (let i = ti; i < Math.min(ti + 7, D.time.length); i++) {
      days.push({
        name: i === ti ? 'Today' : parts(dayStart(i) + 12 * HOUR, tz).wd,
        icon: iconName(D.weather_code[i], true), label: label(D.weather_code[i], true),
        pop: D.precipitation_probability_max[i] ?? 0,
        lo: D.temperature_2m_min[i], hi: D.temperature_2m_max[i]
      });
    }
    const weekMin = Math.min(...days.map(d => d.lo)), weekMax = Math.max(...days.map(d => d.hi));

    // Stars: tonight = end of astronomical twilight → 1:00 am; pre-dawn = 4:30 am → nautical dawn.
    const tonight = i => {
      const s = sunTimes(i);
      const start = valid(s.night) ? +s.night : valid(s.nauticalDusk) ? +s.nauticalDusk : +s.sunset + 90 * MIN;
      return { kind: 'tonight', name: 'Tonight', day: i, start, end: dayStart(i) + 25 * HOUR };
    };
    const nauticalDawn = i => { const s = sunTimes(i); return valid(s.nauticalDawn) ? +s.nauticalDawn : NaN; };
    const predawn = i => ({ kind: 'predawn', name: 'Pre-dawn', day: i, start: dayStart(i) + 4.5 * HOUR, end: nauticalDawn(i) });
    const usable = w => w.end > w.start && w.end > now;
    const pick = (make, from) => {
      for (let i = from; i < from + 3; i++) { const w = make(i); if (usable(w)) return w; }
      return null;
    };
    const detailOf = s => `${s.sky} · ${s.cloud}% cloud` + (s.haze ? ` · ${s.haze}` : '');
    const describe = w => {
      if (!w) return { name: '', none: true, when: 'No dark window', verdict: VERDICTS.poor, detail: '' };
      const s = windowStats(w, H, lat, lon);
      const startDate = parts(w.start, tz);
      const prefix = startDate.date > today ? startDate.wd + ' ' : '';
      s.when = prefix + span(round5(w.start), round5(w.end), tz);
      if (s.noData) { s.verdict = { text: 'No data', cls: 'poor', score: -1 }; s.detail = 'Beyond the forecast'; }
      else s.detail = detailOf(s);
      return s;
    };
    const tw = describe(pick(tonight, ti - 1));
    const pw = describe(pick(predawn, ti));

    let best = null;
    for (const w of [tw, pw]) {
      if (w.none || w.noData || w.verdict.score <= 0) continue;
      if (!best || w.verdict.score > best.verdict.score ||
          (w.verdict.score === best.verdict.score && w.cloud < best.cloud)) best = w;
    }

    // Outlook: evening and pre-dawn windows for the next 10 nights. Before sunrise the current night leads.
    const OUTLOOK_NIGHTS = 10, SURE_NIGHTS = 7;
    const slot = w => {
      if (!(w.end > w.start)) return { none: true, when: 'No dark window', verdict: VERDICTS.poor, detail: '' };
      const when = span(round5(w.start), round5(w.end), tz);
      if (w.end <= now) return { ...w, past: true, when, verdict: { text: 'Over', cls: 'poor', score: -1 }, detail: '' };
      const s = windowStats(w, H, lat, lon);
      s.when = when;
      if (s.noData) { s.verdict = { text: 'No data', cls: 'poor', score: -1 }; s.detail = 'Beyond the forecast'; }
      else s.detail = detailOf(s);
      return s;
    };
    const early = now < sunrise;
    const first = early ? ti - 1 : ti;
    const outlook = [];
    for (let k = 0; k < OUTLOOK_NIGHTS; k++) {
      const i = first + k;
      const noon = dayStart(i) + 12 * HOUR;
      const evening = slot(tonight(i)), morning = slot(predawn(i + 1));
      const illum = SunCalc.getMoonIllumination(new Date(noon + 12 * HOUR));
      outlook.push({
        name: k === 0 ? (early ? 'Now' : 'Tonight') : k === 1 && early ? 'Tonight' : parts(noon, tz).wd,
        date: monthDay(noon, tz), far: k >= SURE_NIGHTS, evening, morning,
        moon: { phase: illum.phase, fraction: illum.fraction, pct: Math.round(illum.fraction * 100), name: phaseName(illum.phase) }
      });
    }
    let bestSlot = null;
    for (const n of outlook) {
      if (n.far) continue;
      for (const w of [n.evening, n.morning]) {
        if (w.none || w.past || w.noData || w.verdict.score <= 0) continue;
        if (!bestSlot || w.verdict.score > bestSlot.w.verdict.score ||
            (w.verdict.score === bestSlot.w.verdict.score && w.cloud < bestSlot.w.cloud)) bestSlot = { n, w };
      }
    }
    if (bestSlot) { bestSlot.n.best = true; bestSlot.w.best = true; }

    // Moon right now
    const illum = SunCalc.getMoonIllumination(new Date(now));
    const ev = moonEvents(now, 36, lat, lon);
    const moon = {
      phase: illum.phase, fraction: illum.fraction, waxing: illum.phase < 0.5,
      name: phaseName(illum.phase), pct: Math.round(illum.fraction * 100),
      rise: ev.rise && time(round5(ev.rise), tz), set: ev.set && time(round5(ev.set), tz),
      upNow: moonAlt(now, lat, lon) > 0
    };

    // Night hero: whichever window ends next.
    let hero = null;
    if (isNight) {
      const live = [tw, pw].filter(w => !w.none).sort((a, b) => a.end - b.end);
      const w = live[0];
      if (w) {
        const ref = Math.max(now, w.start);
        let moonPhrase;
        if (moonAlt(ref, lat, lon) > 0) {
          const lit = SunCalc.getMoonIllumination(new Date(ref)).fraction;
          moonPhrase = lit > 0.5 ? 'bright moon up' : `moon up, ${Math.round(lit * 100)}% lit`;
        } else {
          const later = moonEvents(ref, Math.max(0, (w.end - ref) / HOUR), lat, lon);
          let wasUp = false;
          for (let t = ref - 12 * HOUR; t < ref && !wasUp; t += 15 * MIN) wasUp = moonAlt(t, lat, lon) > 0;
          moonPhrase = later.rise ? `moon rises ${time(round5(later.rise), tz)}` : wasUp ? 'moon has set' : 'no moon';
        }
        const darkEnd = w.kind === 'predawn' ? w.end : nauticalDawn(w.day + 1);
        const dark = now < w.start
          ? `Dark sky ${span(round5(w.start), round5(darkEnd), tz)}`
          : `Dark sky until ${time(round5(darkEnd), tz)}`;
        hero = {
          title: nowP.h >= 12 ? 'Stars tonight' : 'Stars now',
          win: w,
          other: w === tw ? pw : tw,
          summary: w.noData ? 'Beyond the forecast' : `${w.sky} · ${w.cloud}% cloud · ${moonPhrase}`,
          dark: isNaN(darkEnd) ? '' : dark
        };
      }
    }

    return {
      tz, isNight, cur, today: todayCard, days, weekMin, weekMax,
      stars: { tonight: tw, predawn: pw, best, hero, moon, outlook }
    };
  }

  root.SWLogic = { build, parts, time, span, group, label, iconName, compass, phaseName, verdict, cloudClass, hazeClass, moonEvents };
})(typeof window !== 'undefined' ? window : globalThis);
