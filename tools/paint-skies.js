// Paints the background skies in img/sky/ with a canvas in headless Chromium.
// Run: node tools/paint-skies.js   (needs Playwright; not part of the app shell)
//   --only sunset    paint only files whose name contains this text
//   --out <dir>      write somewhere other than img/sky (e.g. to preview)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const W = 860, H = 1120; // 2x of a 430 x 560 scenery box

// Per theme: sky gradient stops, and the colors used for clouds, stars, rain and haze.
const THEMES = {
  light: {
    base: '#EEF3F7',
    day: {
      clear:  ['#8EC3EC', '#B9DBF3', '#EEF3F7'],
      partly: ['#9CC9EE', '#C2DFF4', '#EEF3F7'],
      cloudy: ['#B9C6D4', '#D3DCE6', '#EEF3F7'],
      fog:    ['#CBD3DC', '#DEE4EA', '#EEF3F7'],
      rain:   ['#9AA8B9', '#C4CED9', '#EEF3F7'],
      snow:   ['#C3CEDC', '#DAE2EB', '#EEF3F7'],
      storm:  ['#8794A6', '#AFB9C6', '#EEF3F7'],
      haze:   ['#C6C7BD', '#DADBD3', '#EEF3F7']
    },
    night: {
      clear:  ['#A9B3D6', '#C9D0E6', '#EEF3F7'],
      partly: ['#AFB8D8', '#CCD3E7', '#EEF3F7'],
      cloudy: ['#B6BDD3', '#D2D7E6', '#EEF3F7'],
      fog:    ['#C2C8DA', '#D9DEEA', '#EEF3F7'],
      rain:   ['#A2AAC2', '#C6CCDD', '#EEF3F7'],
      snow:   ['#B9C0D8', '#D4D9E8', '#EEF3F7'],
      storm:  ['#9198B1', '#BAC0D1', '#EEF3F7'],
      haze:   ['#B8B8C4', '#D0D1DA', '#EEF3F7']
    },
    // Around sunrise and sunset (clear and partly cloudy only; other weather keeps its own sky plus a CSS tint).
    // Stops as [position, color]: blue overhead, warm toward the horizon, then the page color.
    dawn: {
      clear:  [[0, '#A7AED6'], [0.24, '#C8C2DF'], [0.42, '#ECD2D8'], [0.85, '#EEF3F7']],
      partly: [[0, '#ABB1D4'], [0.24, '#CBC6DE'], [0.42, '#E9D3D9'], [0.85, '#EEF3F7']]
    },
    sunrise: {
      clear:  [[0, '#9FC6EA'], [0.2, '#C9D5EC'], [0.34, '#F4D3D3'], [0.48, '#FAE0C6'], [0.85, '#EEF3F7']],
      partly: [[0, '#A6C8E8'], [0.2, '#CDD7EB'], [0.34, '#F1D5D5'], [0.48, '#F8E1CA'], [0.85, '#EEF3F7']]
    },
    sunset: {
      clear:  [[0, '#93A3D6'], [0.18, '#D3AFCA'], [0.32, '#F2B5A6'], [0.46, '#F7CB9C'], [0.85, '#EEF3F7']],
      partly: [[0, '#98A5D2'], [0.18, '#D3B2CA'], [0.32, '#EFB8A9'], [0.46, '#F5CCA3'], [0.85, '#EEF3F7']]
    },
    dusk: {
      clear:  [[0, '#8D93C4'], [0.24, '#ADA7D0'], [0.42, '#D9BBCD'], [0.85, '#EEF3F7']],
      partly: [[0, '#9297C2'], [0.24, '#B1ABCF'], [0.42, '#D8BECE'], [0.85, '#EEF3F7']]
    },
    glow: {
      sunrise: ['rgba(255,226,190,.9)', 'rgba(255,200,180,.35)', 'rgba(255,200,180,0)'],
      sunset:  ['rgba(255,190,130,.95)', 'rgba(255,150,120,.4)', 'rgba(255,150,120,0)'],
      dawn: 'rgba(255,214,200,.55)', dusk: 'rgba(240,170,170,.45)'
    },
    cloudGold: { dawn: ['#C3BEDC', '#E8CDD6'], sunrise: ['#F3E2EC', '#FBD5C4'], sunset: ['#C7A2C4', '#FFC09A'], dusk: ['#9D97C2', '#D7AFC2'] },
    cloudStorm: ['#A8B2BF', '#6E7A8B'], cloudNightStorm: ['#A9AEC4', '#6F7591'],
    hazeBand: 'rgba(245,240,225,.6)', hazeSun: ['rgba(255,242,220,.95)', 'rgba(255,225,180,.35)'], hazeGlow: 'rgba(225,205,175,.4)',
    sun: ['rgba(255,236,200,.95)', 'rgba(255,214,170,.45)', 'rgba(255,220,180,0)'],
    cloudDay: ['#FFFFFF', '#DCE6F0'], cloudDayHeavy: ['#E9EEF3', '#A9B6C5'], cloudRain: ['#C9D2DC', '#7D8B9C'],
    cloudNight: ['#E3E7F2', '#B3BBD3'], cloudNightRain: ['#C3C9DB', '#8890AB'],
    star: '#5E6C98', starGlow: 'rgba(94,108,152,0)', starAlpha: 0.6, band: 'rgba(255,255,255,.22)', bandDust: 'rgba(0,0,0,0)', bandStar: '#FFFFFF',
    rain: 'rgba(70,90,120,.32)', snow: 'rgba(255,255,255,.95)', snowEdge: 'rgba(110,125,150,.35)', fog: 'rgba(255,255,255,.75)', grain: 4
  },
  dark: {
    base: '#0B1220',
    day: {
      clear:  ['#24538A', '#1A3A62', '#0B1220'],
      partly: ['#1F416A', '#172E4D', '#0B1220'],
      cloudy: ['#24324A', '#18233A', '#0B1220'],
      fog:    ['#2A3446', '#1B2436', '#0B1220'],
      rain:   ['#1D2A3E', '#141F33', '#0B1220'],
      snow:   ['#28344C', '#1A2439', '#0B1220'],
      storm:  ['#18212F', '#121A28', '#0B1220'],
      haze:   ['#3A3F48', '#262C37', '#0B1220']
    },
    night: {
      clear:  ['#070E20', '#0A1326', '#0B1220'],
      partly: ['#0A1224', '#0B1427', '#0B1220'],
      cloudy: ['#121A2C', '#0E1626', '#0B1220'],
      fog:    ['#161E30', '#101828', '#0B1220'],
      rain:   ['#101828', '#0D1525', '#0B1220'],
      snow:   ['#141D31', '#0F1828', '#0B1220'],
      storm:  ['#0A0F1B', '#0B111D', '#0B1220'],
      haze:   ['#16181F', '#121520', '#0B1220']
    },
    dawn: {
      clear:  [[0, '#0C1430'], [0.24, '#1A2148'], [0.42, '#3C3159'], [0.85, '#0B1220']],
      partly: [[0, '#0E1530'], [0.24, '#1C2246'], [0.42, '#393156'], [0.85, '#0B1220']]
    },
    sunrise: {
      clear:  [[0, '#1C3262'], [0.2, '#30406E'], [0.34, '#664A6E'], [0.48, '#8A5A5E'], [0.85, '#0B1220']],
      partly: [[0, '#1E325E'], [0.2, '#32406B'], [0.34, '#624A6B'], [0.48, '#84595D'], [0.85, '#0B1220']]
    },
    sunset: {
      clear:  [[0, '#18214A'], [0.18, '#38295A'], [0.32, '#7A3A58'], [0.46, '#9A4E3E'], [0.85, '#0B1220']],
      partly: [[0, '#1A2248'], [0.18, '#382A57'], [0.32, '#743B56'], [0.46, '#934D3F'], [0.85, '#0B1220']]
    },
    dusk: {
      clear:  [[0, '#0A1129'], [0.24, '#181B44'], [0.42, '#35274F'], [0.85, '#0B1220']],
      partly: [[0, '#0C1229'], [0.24, '#1A1D42'], [0.42, '#33284D'], [0.85, '#0B1220']]
    },
    glow: {
      sunrise: ['rgba(255,190,150,.45)', 'rgba(220,140,130,.18)', 'rgba(220,140,130,0)'],
      sunset:  ['rgba(255,150,90,.55)', 'rgba(210,90,80,.22)', 'rgba(210,90,80,0)'],
      dawn: 'rgba(200,130,150,.28)', dusk: 'rgba(170,90,120,.28)'
    },
    cloudGold: { dawn: ['#1E2346', '#4A3A5E'], sunrise: ['#3A3C68', '#9A6E80'], sunset: ['#2C2348', '#B0604E'], dusk: ['#171A3A', '#432E52'] },
    cloudStorm: ['#2E3A4E', '#121A28'], cloudNightStorm: ['#1D2536', '#0A101C'],
    hazeBand: 'rgba(150,140,120,.16)', hazeSun: ['rgba(235,175,120,.6)', 'rgba(200,140,90,.18)'], hazeGlow: 'rgba(150,110,70,.2)',
    sun: ['rgba(255,200,140,.55)', 'rgba(200,140,100,.20)', 'rgba(200,140,100,0)'],
    cloudDay: ['#56708F', '#2B3D58'], cloudDayHeavy: ['#3E4E66', '#212D42'], cloudRain: ['#34425A', '#18223A'],
    cloudNight: ['#2C3754', '#151E33'], cloudNightRain: ['#252F47', '#111A2C'],
    star: '#F2F5FB', starGlow: 'rgba(200,215,255,0)', starAlpha: 1, band: 'rgba(160,178,235,.13)', bandDust: 'rgba(5,9,20,.22)', bandStar: '#DCE4FA',
    rain: 'rgba(160,185,220,.30)', snow: 'rgba(235,242,252,.9)', snowEdge: 'rgba(0,0,0,0)', fog: 'rgba(120,135,160,.28)', grain: 5
  }
};

const SCENES = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow', 'storm', 'haze'];
// Sunrise, sunset and the twilights around them are painted only for clear and partly cloudy skies.
const TIMES = { day: SCENES, night: SCENES, dawn: ['clear', 'partly'], sunrise: ['clear', 'partly'], sunset: ['clear', 'partly'], dusk: ['clear', 'partly'] };
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

async function main() {
  const out = arg('--out') ? path.resolve(arg('--out')) : path.join(__dirname, '..', 'img', 'sky');
  const only = arg('--only');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  for (const theme of Object.keys(THEMES)) {
    for (const time of Object.keys(TIMES)) {
      for (const scene of TIMES[time]) {
        if (only && !`${theme}-${time}-${scene}`.includes(only)) continue;
        const url = await page.evaluate(paint, { W, H, T: THEMES[theme], theme, time, scene });
        const file = path.join(out, `${theme}-${time}-${scene}.webp`);
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        console.log(path.relative(process.cwd(), file), Math.round(fs.statSync(file).size / 1024) + ' KB');
      }
    }
  }
  await browser.close();
}

// Runs inside the browser.
function paint({ W, H, T, theme, time, scene }) {
  const cv = document.getElementById('c');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  let seed = { clear: 11, partly: 23, cloudy: 37, fog: 41, rain: 53, snow: 67, storm: 71, haze: 83 }[scene]
    + { day: 0, night: 100, dawn: 200, sunrise: 300, sunset: 400, dusk: 500 }[time];
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const night = time === 'night', day = time === 'day';
  const golden = time === 'sunrise' || time === 'sunset', twilight = time === 'dawn' || time === 'dusk';
  // Fade to the same color at zero alpha; fading to transparent black leaves grey fringes.
  const clear = c => c.replace(/[\d.]+\)$/, '0)');
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  // Sky
  // Three colors (top, middle, page) or a list of [position, color] stops.
  const raw = T[time][scene];
  const stops = typeof raw[0] === 'string' ? [[0, raw[0]], [0.42, raw[1]], [0.92, raw[2]]] : raw;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [p, c] of stops) g.addColorStop(p, c);
  g.addColorStop(1, stops[stops.length - 1][1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Sun haze (top right, behind the refresh button)
  if (day && (scene === 'clear' || scene === 'partly')) {
    const sx = W * 0.7, sy = H * 0.12;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const r = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.75);
    r.addColorStop(0, T.sun[0]); r.addColorStop(0.18, T.sun[1]); r.addColorStop(1, T.sun[2]);
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70);
    core.addColorStop(0, theme === 'light' ? 'rgba(255,250,232,1)' : 'rgba(255,224,170,.55)');
    core.addColorStop(1, theme === 'light' ? 'rgba(255,250,232,0)' : 'rgba(255,224,170,0)');
    ctx.fillStyle = core; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (day && scene !== 'clear' && scene !== 'haze') {
    // Diffuse brightening where the sun sits behind the clouds
    const sx = W * 0.8, sy = H * 0.05;
    const r = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.7);
    r.addColorStop(0, theme === 'light' ? 'rgba(255,255,255,.55)' : 'rgba(150,170,200,.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }

  // Low sun at sunrise (left) and sunset (right): a wide warm glow over the horizon and a soft bright core.
  if (golden) {
    const sx = W * (time === 'sunrise' ? 0.22 : 0.78), sy = H * 0.44, gl = T.glow[time];
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const r = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.95);
    r.addColorStop(0, gl[0]); r.addColorStop(0.22, gl[1]); r.addColorStop(1, gl[2]);
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
    core.addColorStop(0, gl[0]); core.addColorStop(1, clear(gl[0]));
    ctx.fillStyle = core; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  // Twilight: no sun, just a broad band of color along the horizon, stronger on the sun's side.
  if (twilight) {
    const c = layer(), b = c.getContext('2d'), col = T.glow[time];
    const bx = W * (time === 'dawn' ? 0.3 : 0.7);
    const rg = b.createRadialGradient(bx, H * 0.46, 0, bx, H * 0.46, W * 0.8);
    rg.addColorStop(0, col); rg.addColorStop(1, clear(col));
    b.fillStyle = rg; b.save(); b.translate(0, H * 0.46); b.scale(1, 0.45); b.translate(0, -H * 0.46); b.fillRect(0, 0, W, H); b.restore();
    ctx.drawImage(c, 0, 0);
  }
  // Haze: a dim, flat sun disc by day; a dull glow of scattered town light low down at night; soft flat layers.
  if (scene === 'haze') {
    if (day) {
      const sx = W * 0.7, sy = H * 0.15;
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 240);
      halo.addColorStop(0, T.hazeSun[1]); halo.addColorStop(1, clear(T.hazeSun[1]));
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.filter = 'blur(3px)'; ctx.fillStyle = T.hazeSun[0];
      ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 7); ctx.fill(); ctx.restore();
    } else {
      const c = layer(), b = c.getContext('2d');
      const rg = b.createLinearGradient(0, H * 0.35, 0, H * 0.8);
      rg.addColorStop(0, clear(T.hazeGlow)); rg.addColorStop(1, T.hazeGlow);
      b.fillStyle = rg; b.fillRect(0, 0, W, H); ctx.drawImage(c, 0, 0);
    }
  }

  // Stars and Milky Way
  function stars(count, maxY, bandStrength) {
    if (bandStrength > 0) {
      const band = layer(), b = band.getContext('2d');
      b.translate(W * 0.45, H * 0.32); b.rotate(-0.55);
      for (let i = 0; i < 70; i++) {
        const x = (rnd() - 0.5) * W * 1.8, y = (rnd() - 0.5) * 120 * (0.6 + rnd());
        const rr = 60 + rnd() * 140;
        const rg = b.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, T.band); rg.addColorStop(1, clear(T.band));
        b.fillStyle = rg; b.beginPath(); b.arc(x, y, rr, 0, 7); b.fill();
      }
      // dark dust lane
      for (let i = 0; i < 26; i++) {
        const x = (rnd() - 0.5) * W * 1.6, y = (rnd() - 0.5) * 30;
        const rr = 30 + rnd() * 60;
        const rg = b.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, T.bandDust); rg.addColorStop(1, clear(T.bandDust));
        b.fillStyle = rg; b.beginPath(); b.ellipse(x, y, rr * 1.8, rr * 0.5, 0, 0, 7); b.fill();
      }
      // dense faint stars along the band
      b.fillStyle = T.bandStar;
      for (let i = 0; i < 900 * bandStrength; i++) {
        const x = (rnd() - 0.5) * W * 1.8, y = (rnd() + rnd() + rnd() - 1.5) * 110;
        b.globalAlpha = 0.15 + rnd() * 0.35;
        b.beginPath(); b.arc(x, y, 0.6 + rnd() * 0.8, 0, 7); b.fill();
      }
      ctx.save(); ctx.filter = 'blur(1px)'; ctx.globalAlpha = bandStrength; ctx.drawImage(band, 0, 0); ctx.restore();
    }
    for (let i = 0; i < count; i++) {
      const x = rnd() * W, y = Math.pow(rnd(), 1.4) * maxY;
      const big = rnd() < 0.06;
      const r = big ? 1.8 + rnd() * 1.4 : 0.7 + rnd() * 1.2;
      const fade = 1 - y / maxY * 0.6;
      ctx.globalAlpha = (0.35 + rnd() * 0.6) * fade * T.starAlpha;
      if (big) {
        const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
        gl.addColorStop(0, T.star); gl.addColorStop(1, T.starGlow);
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = T.star; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // A soft cloud: overlapping puffs, lit from above, blurred.
  function cloud(cx, cy, w, h, cols, alpha, blur) {
    const c = layer(), b = c.getContext('2d');
    const grad = b.createLinearGradient(0, cy - h, 0, cy + h * 0.5);
    grad.addColorStop(0, cols[0]); grad.addColorStop(1, cols[1]);
    b.fillStyle = grad;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = cx + (t - 0.5) * w + (rnd() - 0.5) * w * 0.08;
      const bulge = Math.sin(Math.PI * t);
      const r = h * (0.35 + 0.55 * bulge) * (0.75 + rnd() * 0.45);
      const y = cy - r * 0.45 + (rnd() - 0.5) * h * 0.15;
      b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
    }
    // flat-ish base
    b.beginPath(); b.ellipse(cx, cy + h * 0.1, w * 0.52, h * 0.32, 0, 0, 7); b.fill();
    ctx.save(); ctx.globalAlpha = alpha; ctx.filter = `blur(${blur}px)`; ctx.drawImage(c, 0, 0); ctx.restore();
  }

  function cloudDeck(cols, alpha, rows) {
    for (const [y, count, size, a, bl] of rows) {
      for (let i = 0; i < count; i++) {
        const x = (i + 0.2 + rnd() * 0.6) / count * W * 1.2 - W * 0.1;
        cloud(x, y + (rnd() - 0.5) * 50, size * (0.8 + rnd() * 0.5), size * 0.36 * (0.8 + rnd() * 0.4), cols, alpha * a, bl);
      }
    }
  }

  const cDay = scene === 'storm' ? T.cloudStorm : scene === 'rain' ? T.cloudRain : scene === 'cloudy' || scene === 'snow' ? T.cloudDayHeavy : T.cloudDay;
  const cNight = scene === 'storm' ? T.cloudNightStorm : scene === 'rain' ? T.cloudNightRain : T.cloudNight;
  const cols = night ? cNight : day ? cDay : T.cloudGold[time];

  if (night) {
    if (scene === 'clear') stars(260, H * 0.8, 1);
    else if (scene === 'partly') stars(150, H * 0.75, 0.45);
    else if (scene === 'snow' || scene === 'fog') stars(18, H * 0.4, 0);
    else if (scene === 'haze') stars(theme === 'dark' ? 40 : 14, H * 0.45, 0);
  }
  // First and last stars of twilight, high up where the sky is darkest.
  if (twilight) stars(scene === 'clear' ? (theme === 'dark' ? 70 : 26) : (theme === 'dark' ? 36 : 14), H * 0.42, 0);

  if (scene === 'partly' && !day && !night) {
    // Around sunrise and sunset: long, thin clouds lit from below by the low sun.
    for (const [x, y, w, h, a, bl] of [[0.3, 0.2, 620, 70, 0.8, 9], [0.85, 0.33, 520, 54, 0.85, 8], [0.12, 0.45, 560, 60, 0.75, 9],
      [0.66, 0.52, 480, 44, 0.7, 10], [0.5, 0.08, 420, 40, 0.45, 14]]) {
      cloud(W * x, H * y, w, h, cols, a, bl);
    }
  } else if (scene === 'partly') {
    cloud(W * 0.28, H * 0.31, 520, 190, cols, night ? 0.75 : 0.95, 10);
    cloud(W * 0.86, H * 0.47, 380, 120, cols, night ? 0.6 : 0.85, 12);
    cloud(W * 0.05, H * 0.6, 320, 90, cols, 0.55, 14);
    cloud(W * 0.62, H * 0.13, 300, 70, cols, night ? 0.35 : 0.5, 18);
  } else if (scene === 'cloudy' || scene === 'snow') {
    cloudDeck(cols, 1, [[H * 0.05, 3, 560, 0.75, 22], [H * 0.2, 3, 520, 0.9, 16], [H * 0.36, 4, 440, 0.85, 12], [H * 0.52, 4, 360, 0.6, 12]]);
  } else if (scene === 'rain') {
    cloudDeck(cols, 1, [[H * 0.02, 3, 600, 0.95, 20], [H * 0.16, 3, 560, 1, 16], [H * 0.31, 4, 460, 0.9, 12], [H * 0.45, 4, 380, 0.55, 14]]);
  } else if (scene === 'storm') {
    // Heavier and lower than rain: a towering, darker mass with brighter tops.
    cloudDeck(cols, 1, [[H * 0.0, 3, 640, 1, 18], [H * 0.12, 3, 600, 1, 14], [H * 0.26, 4, 500, 1, 12], [H * 0.4, 4, 420, 0.8, 12], [H * 0.52, 4, 360, 0.5, 14]]);
    const tops = night ? [cols[0], cols[0]] : [T.cloudDayHeavy[0], cols[0]];
    cloud(W * 0.3, H * 0.1, 520, 170, tops, theme === 'dark' ? 0.35 : 0.5, 16);
    cloud(W * 0.82, H * 0.2, 420, 130, tops, theme === 'dark' ? 0.3 : 0.4, 18);
  } else if (scene === 'haze') {
    for (let i = 0; i < 6; i++) {
      const y = H * (0.18 + i * 0.1) + (rnd() - 0.5) * 30;
      const c = layer(), b = c.getContext('2d');
      b.fillStyle = T.hazeBand;
      b.beginPath(); b.ellipse(W * (0.3 + rnd() * 0.4), y, W * (0.8 + rnd() * 0.4), 18 + rnd() * 22, 0, 0, 7); b.fill();
      ctx.save(); ctx.globalAlpha = 0.4 + rnd() * 0.35; ctx.filter = 'blur(30px)'; ctx.drawImage(c, 0, 0); ctx.restore();
    }
  } else if (scene === 'fog') {
    for (let i = 0; i < 9; i++) {
      const y = H * (0.08 + i * 0.075) + (rnd() - 0.5) * 30;
      const c = layer(), b = c.getContext('2d');
      b.fillStyle = T.fog;
      b.beginPath(); b.ellipse(W * (0.3 + rnd() * 0.4), y, W * (0.7 + rnd() * 0.4), 26 + rnd() * 30, 0, 0, 7); b.fill();
      ctx.save(); ctx.globalAlpha = 0.45 + rnd() * 0.4; ctx.filter = 'blur(26px)'; ctx.drawImage(c, 0, 0); ctx.restore();
    }
  }

  // Rain and snow are not painted: the app animates them over the sky (styles.css .fx), so nothing looks stuck.

  // Fine grain so the gradients do not band
  const img = ctx.getImageData(0, 0, W, H), d = img.data, amp = T.grain;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/webp', 0.82);
}

main().catch(e => { console.error(e); process.exit(1); });
