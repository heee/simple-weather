// Run: node tests/stars.test.js
// Builds synthetic Open-Meteo responses for Houston and checks the stargazing verdicts.
'use strict';
const assert = require('assert');
const path = require('path');
globalThis.SunCalc = require(path.join(__dirname, '..', 'vendor', 'suncalc.js'));
require(path.join(__dirname, '..', 'logic.js'));
const L = globalThis.SWLogic;

const TZ = 'America/Chicago';
const HOUSTON = { id: 'h', name: 'Houston', region: 'TX', lat: 29.76, lon: -95.37 };
const HOUR = 36e5;

// Local midnight (CDT, UTC-5) of the first forecast day.
function fixture(firstDayUTCMidnight, cloudAt, popAt = () => 0, days = 8) {
  const t0 = firstDayUTCMidnight / 1000;
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], cloud_cover: [], weather_code: [], is_day: [] };
  for (let i = 0; i < days * 24; i++) {
    const t = t0 + i * 3600;
    const ms = t * 1000;
    const p = L.parts(ms, TZ);
    hourly.time.push(t);
    hourly.temperature_2m.push(70);
    hourly.precipitation_probability.push(popAt(p, ms));
    hourly.cloud_cover.push(cloudAt(p, ms));
    hourly.weather_code.push(0);
    hourly.is_day.push(p.h >= 7 && p.h < 19 ? 1 : 0);
  }
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], sunrise: [], sunset: [] };
  for (let d = 0; d < days; d++) {
    const t = t0 + d * 86400;
    const s = SunCalc.getTimes(new Date(t * 1000 + 12 * HOUR), HOUSTON.lat, HOUSTON.lon);
    daily.time.push(t);
    daily.weather_code.push(0);
    daily.temperature_2m_max.push(84);
    daily.temperature_2m_min.push(66);
    daily.precipitation_probability_max.push(0);
    daily.sunrise.push(Math.round(+s.sunrise / 1000));
    daily.sunset.push(Math.round(+s.sunset / 1000));
  }
  const current = { temperature_2m: 70, apparent_temperature: 70, weather_code: 0, cloud_cover: 0, wind_speed_10m: 5, wind_direction_10m: 180, is_day: 1 };
  return { timezone: TZ, hourly, daily, current };
}

const at = iso => Date.parse(iso);
const run = (data, nowISO) => L.build(HOUSTON, { fetchedAt: at(nowISO), data }, at(nowISO));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok  ' + name); }

// ---- Night 1: Wed 21 Oct 2026, waxing gibbous (full moon 26 Oct), clear all night ----
const oct21 = at('2026-10-21T05:00:00Z');
const clear = fixture(oct21, () => 6);

// Reference values from the US Naval Observatory almanac (aa.usno.navy.mil), Houston 29.76 N 95.37 W, CDT:
//   21 Oct: sunset 18:45, end civil twilight 19:09, moonrise 16:07, waxing gibbous 78%
//   22 Oct: moonset 03:50, begin civil twilight 07:04, sunrise 07:28
//    9 Nov: new moon, 0% (CST: moonrise 08:07, moonset 18:32)
const near = (ms, iso, minutes, what) =>
  assert.ok(Math.abs(ms - at(iso)) <= minutes * 6e4, `${what}: got ${new Date(ms).toISOString()}, expected ≈ ${iso}`);

check('astronomy for Houston, 21–22 Oct 2026 matches the USNO almanac', () => {
  const s = SunCalc.getTimes(new Date(oct21 + 12 * HOUR), HOUSTON.lat, HOUSTON.lon);
  near(+s.sunset, '2026-10-21T23:45:00Z', 2, 'sunset');
  near(+s.dusk, '2026-10-22T00:09:00Z', 2, 'end of civil twilight');
  const s22 = SunCalc.getTimes(new Date(oct21 + 36 * HOUR), HOUSTON.lat, HOUSTON.lon);
  near(+s22.dawn, '2026-10-22T12:04:00Z', 2, 'begin civil twilight');
  near(+s22.sunrise, '2026-10-22T12:28:00Z', 2, 'sunrise');
  const ev = L.moonEvents(at('2026-10-21T17:00:00Z'), 24, HOUSTON.lat, HOUSTON.lon);
  near(ev.rise, '2026-10-21T21:07:00Z', 5, 'moonrise');
  near(ev.set, '2026-10-22T08:50:00Z', 5, 'moonset');
  const ill = SunCalc.getMoonIllumination(new Date(at('2026-10-21T17:00:00Z')));
  assert.strictEqual(L.phaseName(ill.phase), 'Waxing gibbous');
  assert.ok(Math.abs(ill.fraction - 0.78) < 0.04, 'about 78% lit, got ' + ill.fraction);
});

check('afternoon: tonight is bright-moon Fair, pre-dawn Great, best is pre-dawn', () => {
  const m = run(clear, '2026-10-21T20:00:00Z'); // 3 pm CDT
  assert.strictEqual(m.isNight, false);
  const { tonight, predawn, best } = m.stars;
  assert.strictEqual(tonight.verdict.text, 'Fair · bright moon');
  assert.strictEqual(tonight.detail, 'Clear · 6% cloud');
  assert.ok(tonight.bright && tonight.moonUpShare > 0.5);
  assert.strictEqual(predawn.verdict.text, 'Great');
  assert.ok(!predawn.bright, 'moon has set before 4:30 am');
  assert.ok(/^Thu 4:30 – 6:[34][05] am$/.test(predawn.when), predawn.when);
  assert.ok(/^8(:0[05])? pm – 1 am$/.test(tonight.when), tonight.when);
  assert.strictEqual(best.kind, 'predawn');
});

check('9 pm: night layout, hero is tonight, titled "Stars tonight"', () => {
  const m = run(clear, '2026-10-22T02:00:00Z'); // 9 pm CDT
  assert.strictEqual(m.isNight, true);
  const h = m.stars.hero;
  assert.strictEqual(h.title, 'Stars tonight');
  assert.strictEqual(h.win.kind, 'tonight');
  assert.strictEqual(h.other.kind, 'predawn');
  assert.ok(/bright moon up/.test(h.summary), h.summary);
});

check('5:42 am: hero is pre-dawn, "Stars now", moon has set, dark until nautical dawn', () => {
  const m = run(clear, '2026-10-22T10:42:00Z');
  const h = m.stars.hero;
  assert.strictEqual(m.isNight, true);
  assert.strictEqual(h.title, 'Stars now');
  assert.strictEqual(h.win.kind, 'predawn');
  assert.strictEqual(h.win.verdict.text, 'Great');
  assert.strictEqual(h.summary, 'Clear · 6% cloud · moon has set');
  assert.ok(/^Dark sky until 6:[34][05] am$/.test(h.dark), h.dark);
  assert.strictEqual(h.other.kind, 'tonight');
  assert.ok(h.other.start > at('2026-10-22T10:42:00Z'), 'next tonight, not the one that passed');
});

check('2 am: passed tonight window rolls to the next night', () => {
  const m = run(clear, '2026-10-22T07:00:00Z');
  assert.strictEqual(L.parts(m.stars.tonight.start, TZ).date, '2026-10-22');
  assert.strictEqual(L.parts(m.stars.predawn.start, TZ).date, '2026-10-22');
});

check('rain chance of 40% or more forces Poor', () => {
  const wet = fixture(oct21, () => 5, p => (p.h >= 4 && p.h < 7 ? 45 : 0));
  const m = run(wet, '2026-10-21T20:00:00Z');
  assert.strictEqual(m.stars.predawn.verdict.text, 'Poor');
  assert.strictEqual(m.stars.best.kind, 'tonight');
});

check('partly cloudy and dark is Good; cloudy is Poor; both Poor drops the pill', () => {
  const partly = fixture(oct21, p => (p.h >= 4 && p.h < 7 ? 35 : 80));
  const m = run(partly, '2026-10-21T20:00:00Z');
  assert.strictEqual(m.stars.predawn.verdict.text, 'Good');
  assert.strictEqual(m.stars.predawn.detail, 'Partly · 35% cloud');
  assert.strictEqual(m.stars.tonight.verdict.text, 'Poor');
  const overcast = run(fixture(oct21, () => 90), '2026-10-21T20:00:00Z');
  assert.strictEqual(overcast.stars.best, null);
});

// ---- Night 2: Mon 9 Nov 2026, new moon — tonight should be dark ----
check('new moon night: clear tonight is Great', () => {
  const nov9 = at('2026-11-09T06:00:00Z'); // CST, UTC-6
  const m = run(fixture(nov9, () => 10), '2026-11-09T20:00:00Z');
  assert.ok(m.stars.moon.pct < 5, 'moon almost new, got ' + m.stars.moon.pct + '%');
  assert.strictEqual(m.stars.tonight.verdict.text, 'Great');
  assert.strictEqual(m.stars.moon.name, 'New moon');
});

// ---- 10-night outlook ----
check('outlook: 10 nights from tonight, last 3 low confidence, best on a sure night', () => {
  const data = fixture(oct21, () => 6, undefined, 11);
  const o = run(data, '2026-10-21T20:00:00Z').stars.outlook; // 3 pm CDT
  assert.strictEqual(o.length, 10);
  assert.deepStrictEqual(o.slice(0, 3).map(n => n.name), ['Tonight', 'Thu', 'Fri']);
  assert.strictEqual(o[0].date, 'Oct 21');
  assert.deepStrictEqual(o.map(n => n.far), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1].map(Boolean));
  assert.strictEqual(o[0].evening.verdict.text, 'Fair · bright moon');
  assert.strictEqual(o[0].morning.verdict.text, 'Great');
  assert.ok(o.every(n => !n.evening.noData && !n.morning.noData), '11 days covers every night');
  const best = o.filter(n => n.best);
  assert.strictEqual(best.length, 1);
  assert.ok(!best[0].far);
});

check('outlook: before sunrise the current night leads as "Now" with its evening over', () => {
  const o = run(fixture(oct21, () => 6, undefined, 11), '2026-10-22T08:00:00Z').stars.outlook; // 3 am CDT
  assert.strictEqual(o[0].name, 'Now');
  assert.strictEqual(o[0].date, 'Oct 21');
  assert.strictEqual(o[0].evening.verdict.text, 'Over');
  assert.notStrictEqual(o[0].morning.verdict.text, 'Over');
  assert.strictEqual(o[1].name, 'Tonight');
});

check('outlook: nights past the forecast say "No data"', () => {
  const o = run(clear, '2026-10-21T20:00:00Z').stars.outlook; // only 8 days
  assert.strictEqual(o[9].evening.verdict.text, 'No data');
  assert.strictEqual(o[9].morning.detail, 'Beyond the forecast');
});

check('fog makes a window Poor; haze is only noted', () => {
  const data = fixture(oct21, () => 6);
  data.hourly.visibility = data.hourly.time.map(t => {
    const p = L.parts(t * 1000, TZ);
    return p.date === '2026-10-22' && p.h >= 4 && p.h < 7 ? 600 : p.h >= 20 ? 3000 : 24000;
  });
  const m = run(data, '2026-10-21T20:00:00Z');
  assert.strictEqual(m.stars.predawn.verdict.text, 'Poor');
  assert.strictEqual(m.stars.predawn.detail, 'Clear · 6% cloud · fog');
  assert.strictEqual(m.stars.tonight.verdict.text, 'Fair · bright moon');
  assert.strictEqual(m.stars.tonight.detail, 'Clear · 6% cloud · haze');
  assert.strictEqual(L.hazeClass(999), 'fog');
  assert.strictEqual(L.hazeClass(4999), 'haze');
  assert.strictEqual(L.hazeClass(5000), null);
});

check('verdict table', () => {
  assert.strictEqual(L.verdict('Clear', false, 0).text, 'Great');
  assert.strictEqual(L.verdict('Clear', true, 0).text, 'Fair · bright moon');
  assert.strictEqual(L.verdict('Partly', false, 0).text, 'Good');
  assert.strictEqual(L.verdict('Partly', true, 0).text, 'Fair');
  assert.strictEqual(L.verdict('Cloudy', false, 0).text, 'Poor');
  assert.strictEqual(L.cloudClass(20), 'Clear');
  assert.strictEqual(L.cloudClass(21), 'Partly');
  assert.strictEqual(L.cloudClass(50), 'Partly');
  assert.strictEqual(L.cloudClass(51), 'Cloudy');
});

console.log(`\n${passed} checks passed`);
