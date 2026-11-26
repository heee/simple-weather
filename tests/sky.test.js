// Run: node tests/sky.test.js
// Checks which background sky is chosen: sunrise/sunset/twilight timing, storms, haze, tints and wind.
'use strict';
const assert = require('assert');
const path = require('path');
globalThis.SunCalc = require(path.join(__dirname, '..', 'vendor', 'suncalc.js'));
require(path.join(__dirname, '..', 'logic.js'));
const L = globalThis.SWLogic;

const MIN = 6e4, HOUR = 36e5;
const HOUSTON = { lat: 29.76, lon: -95.37 };
let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

// Houston, 26 Nov 2026 (CST, UTC-6). Reference times from SunCalc, sanity-checked against the almanac:
// sunrise about 6:52, sunset about 17:23 local.
const t = SunCalc.getTimes(new Date(Date.UTC(2026, 10, 26, 18)), HOUSTON.lat, HOUSTON.lon);
const local = d => { const x = new Date(+d - 6 * HOUR); return x.getUTCHours() + x.getUTCMinutes() / 60; };

check('reference sunrise and sunset are plausible for Houston in late November', () => {
  assert(local(t.sunrise) > 6.6 && local(t.sunrise) < 7.1, `sunrise ${local(t.sunrise)}`);
  assert(local(t.sunset) > 17.2 && local(t.sunset) < 17.6, `sunset ${local(t.sunset)}`);
  // Civil twilight and golden hour each last roughly 25–60 minutes at this latitude.
  for (const [a, b] of [[t.dawn, t.sunrise], [t.sunrise, t.goldenHourEnd], [t.goldenHour, t.sunset], [t.sunset, t.dusk]]) {
    const mins = (b - a) / MIN;
    assert(mins > 20 && mins < 70, `window ${mins} min`);
  }
});

check('phases follow the sun through the day', () => {
  const at = (d, off) => L.sunPhase(+d + off * MIN, HOUSTON.lat, HOUSTON.lon);
  assert.strictEqual(at(t.dawn, -5), null, 'before first light');
  assert.strictEqual(at(t.dawn, 5), 'dawn');
  assert.strictEqual(at(t.sunrise, -1), 'dawn');
  assert.strictEqual(at(t.sunrise, 1), 'sunrise');
  assert.strictEqual(at(t.goldenHourEnd, -1), 'sunrise');
  assert.strictEqual(at(t.goldenHourEnd, 1), null, 'morning after golden hour');
  assert.strictEqual(at(t.solarNoon, 0), null, 'noon');
  assert.strictEqual(at(t.goldenHour, -1), null);
  assert.strictEqual(at(t.goldenHour, 1), 'sunset');
  assert.strictEqual(at(t.sunset, -1), 'sunset');
  assert.strictEqual(at(t.sunset, 1), 'dusk');
  assert.strictEqual(at(t.dusk, -1), 'dusk');
  assert.strictEqual(at(t.dusk, 5), null, 'after last light');
  assert.strictEqual(at(t.nadir, 0), null, 'midnight');
});

check('far west of Greenwich, evening twilight after UTC midnight is still found', () => {
  // Honolulu: sunset is around 04:00 UTC, i.e. on the next UTC day.
  const lat = 21.31, lon = -157.86;
  const h = SunCalc.getTimes(new Date(Date.UTC(2026, 10, 26, 22)), lat, lon);
  assert.strictEqual(L.sunPhase(+h.sunset + 10 * MIN, lat, lon), 'dusk');
  assert.strictEqual(L.sunPhase(+h.sunset - 10 * MIN, lat, lon), 'sunset');
});

check('polar day and polar night never crash and fall back to day or night skies', () => {
  const lat = 69.65, lon = 18.96; // Tromsø
  for (const day of [Date.UTC(2026, 5, 21), Date.UTC(2026, 11, 21)]) {
    for (let h = 0; h < 24; h++) {
      const p = L.sunPhase(day + h * HOUR, lat, lon);
      assert(p === null || ['dawn', 'sunrise', 'sunset', 'dusk'].includes(p));
    }
  }
  assert.strictEqual(L.sunPhase(Date.UTC(2026, 5, 21, 22), lat, lon), null, 'midnight sun');
});

check('clear and partly cloudy skies get their own sunrise and sunset paintings', () => {
  assert.deepStrictEqual(L.skyScene(0, true, 'sunrise', 20000, 5), { group: 'clear', phase: 'sunrise', img: 'sunrise-clear', tint: null, windy: false });
  assert.strictEqual(L.skyScene(2, false, 'dusk', null, 5).img, 'dusk-partly');
  assert.strictEqual(L.skyScene(1, true, null, null, 5).img, 'day-clear');
  assert.strictEqual(L.skyScene(0, false, null, null, 5).img, 'night-clear');
});

check('other weather keeps its sky and gets a horizon tint', () => {
  const s = L.skyScene(3, true, 'sunset', 20000, 5);
  assert.strictEqual(s.img, 'day-cloudy');
  assert.strictEqual(s.tint, 'sunset');
  assert.strictEqual(L.skyScene(63, false, 'dawn', 8000, 5).img, 'night-rain');
  assert.strictEqual(L.skyScene(63, false, 'dawn', 8000, 5).tint, 'dawn');
  assert.strictEqual(L.skyScene(3, true, null, 20000, 5).tint, null);
});

check('thunderstorms get the storm sky, day and night', () => {
  for (const c of [95, 96, 99]) assert.strictEqual(L.skyScene(c, true, null, 20000, 5).img, 'day-storm');
  assert.strictEqual(L.skyScene(95, false, null, 20000, 5).img, 'night-storm');
  assert.strictEqual(L.skyScene(95, true, 'sunset', 20000, 5).tint, 'sunset');
});

check('haze: visibility 1–5 km on otherwise dry skies', () => {
  assert.strictEqual(L.skyScene(0, true, null, 3000, 5).img, 'day-haze');
  assert.strictEqual(L.skyScene(3, false, null, 4999, 5).img, 'night-haze');
  assert.strictEqual(L.skyScene(0, true, null, 5000, 5).img, 'day-clear', '5 km is not haze');
  assert.strictEqual(L.skyScene(0, true, null, 900, 5).img, 'day-clear', 'fog-level visibility without a fog code');
  assert.strictEqual(L.skyScene(0, true, null, null, 5).img, 'day-clear', 'no visibility data');
  assert.strictEqual(L.skyScene(63, true, null, 3000, 5).img, 'day-rain', 'rain stays rain');
  assert.strictEqual(L.skyScene(45, true, null, 3000, 5).img, 'day-fog');
  assert.strictEqual(L.skyScene(73, true, null, 3000, 5).img, 'day-snow');
  // Hazy at sunrise: no hazy sunrise painting, so the haze sky with a tint.
  const s = L.skyScene(0, true, 'sunrise', 3000, 5);
  assert.strictEqual(s.img, 'day-haze');
  assert.strictEqual(s.tint, 'sunrise');
});

check('wind wisps from 20 mph', () => {
  assert.strictEqual(L.skyScene(0, true, null, null, 19.9).windy, false);
  assert.strictEqual(L.skyScene(0, true, null, null, 20).windy, true);
  assert.strictEqual(L.skyScene(0, true, null, null, undefined).windy, false);
});

check('every sky the app can pick has a painted image', () => {
  const fs = require('fs');
  const codes = [0, 1, 2, 3, 45, 48, 51, 61, 63, 65, 71, 73, 75, 80, 85, 95, 96];
  for (const theme of ['light', 'dark']) {
    for (const c of codes) for (const isDay of [true, false]) for (const phase of [null, 'dawn', 'sunrise', 'sunset', 'dusk']) {
      for (const vis of [null, 3000, 20000]) {
        const f = path.join(__dirname, '..', 'img', 'sky', `${theme}-${L.skyScene(c, isDay, phase, vis, 5).img}.webp`);
        assert(fs.existsSync(f), f);
      }
    }
  }
});

console.log(`${n} checks passed`);
