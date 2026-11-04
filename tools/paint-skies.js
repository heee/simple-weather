// Paints the background skies in img/sky/ with a canvas in headless Chromium.
// Run: node tools/paint-skies.js   (needs Playwright; not part of the app shell)
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
      snow:   ['#C3CEDC', '#DAE2EB', '#EEF3F7']
    },
    night: {
      clear:  ['#A9B3D6', '#C9D0E6', '#EEF3F7'],
      partly: ['#AFB8D8', '#CCD3E7', '#EEF3F7'],
      cloudy: ['#B6BDD3', '#D2D7E6', '#EEF3F7'],
      fog:    ['#C2C8DA', '#D9DEEA', '#EEF3F7'],
      rain:   ['#A2AAC2', '#C6CCDD', '#EEF3F7'],
      snow:   ['#B9C0D8', '#D4D9E8', '#EEF3F7']
    },
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
      snow:   ['#28344C', '#1A2439', '#0B1220']
    },
    night: {
      clear:  ['#070E20', '#0A1326', '#0B1220'],
      partly: ['#0A1224', '#0B1427', '#0B1220'],
      cloudy: ['#121A2C', '#0E1626', '#0B1220'],
      fog:    ['#161E30', '#101828', '#0B1220'],
      rain:   ['#101828', '#0D1525', '#0B1220'],
      snow:   ['#141D31', '#0F1828', '#0B1220']
    },
    sun: ['rgba(255,200,140,.55)', 'rgba(200,140,100,.20)', 'rgba(200,140,100,0)'],
    cloudDay: ['#56708F', '#2B3D58'], cloudDayHeavy: ['#3E4E66', '#212D42'], cloudRain: ['#34425A', '#18223A'],
    cloudNight: ['#2C3754', '#151E33'], cloudNightRain: ['#252F47', '#111A2C'],
    star: '#F2F5FB', starGlow: 'rgba(200,215,255,0)', starAlpha: 1, band: 'rgba(160,178,235,.13)', bandDust: 'rgba(5,9,20,.22)', bandStar: '#DCE4FA',
    rain: 'rgba(160,185,220,.30)', snow: 'rgba(235,242,252,.9)', snowEdge: 'rgba(0,0,0,0)', fog: 'rgba(120,135,160,.28)', grain: 5
  }
};

const SCENES = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'snow'];

async function main() {
  const out = path.join(__dirname, '..', 'img', 'sky');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  for (const theme of Object.keys(THEMES)) {
    for (const time of ['day', 'night']) {
      for (const scene of SCENES) {
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
  let seed = { clear: 11, partly: 23, cloudy: 37, fog: 41, rain: 53, snow: 67 }[scene] + (time === 'night' ? 100 : 0);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const night = time === 'night';
  // Fade to the same color at zero alpha; fading to transparent black leaves grey fringes.
  const clear = c => c.replace(/[\d.]+\)$/, '0)');
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  // Sky
  const stops = T[time][scene];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, stops[0]); g.addColorStop(0.42, stops[1]); g.addColorStop(0.92, stops[2]); g.addColorStop(1, stops[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Sun haze (top right, behind the refresh button)
  if (!night && (scene === 'clear' || scene === 'partly')) {
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
  } else if (!night && scene !== 'clear') {
    // Diffuse brightening where the sun sits behind the clouds
    const sx = W * 0.8, sy = H * 0.05;
    const r = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.7);
    r.addColorStop(0, theme === 'light' ? 'rgba(255,255,255,.55)' : 'rgba(150,170,200,.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
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

  const cDay = scene === 'rain' ? T.cloudRain : scene === 'cloudy' || scene === 'snow' ? T.cloudDayHeavy : T.cloudDay;
  const cNight = scene === 'rain' ? T.cloudNightRain : T.cloudNight;
  const cols = night ? cNight : cDay;

  if (night) {
    if (scene === 'clear') stars(260, H * 0.8, 1);
    else if (scene === 'partly') stars(150, H * 0.75, 0.45);
    else if (scene === 'snow' || scene === 'fog') stars(18, H * 0.4, 0);
  }

  if (scene === 'partly') {
    cloud(W * 0.28, H * 0.31, 520, 190, cols, night ? 0.75 : 0.95, 10);
    cloud(W * 0.86, H * 0.47, 380, 120, cols, night ? 0.6 : 0.85, 12);
    cloud(W * 0.05, H * 0.6, 320, 90, cols, 0.55, 14);
    cloud(W * 0.62, H * 0.13, 300, 70, cols, night ? 0.35 : 0.5, 18);
  } else if (scene === 'cloudy' || scene === 'snow') {
    cloudDeck(cols, 1, [[H * 0.05, 3, 560, 0.75, 22], [H * 0.2, 3, 520, 0.9, 16], [H * 0.36, 4, 440, 0.85, 12], [H * 0.52, 4, 360, 0.6, 12]]);
  } else if (scene === 'rain') {
    cloudDeck(cols, 1, [[H * 0.02, 3, 600, 0.95, 20], [H * 0.16, 3, 560, 1, 16], [H * 0.31, 4, 460, 0.9, 12], [H * 0.45, 4, 380, 0.55, 14]]);
  } else if (scene === 'fog') {
    for (let i = 0; i < 9; i++) {
      const y = H * (0.08 + i * 0.075) + (rnd() - 0.5) * 30;
      const c = layer(), b = c.getContext('2d');
      b.fillStyle = T.fog;
      b.beginPath(); b.ellipse(W * (0.3 + rnd() * 0.4), y, W * (0.7 + rnd() * 0.4), 26 + rnd() * 30, 0, 0, 7); b.fill();
      ctx.save(); ctx.globalAlpha = 0.45 + rnd() * 0.4; ctx.filter = 'blur(26px)'; ctx.drawImage(c, 0, 0); ctx.restore();
    }
  }

  if (scene === 'rain') {
    const c = layer(), b = c.getContext('2d');
    b.strokeStyle = T.rain; b.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W * 1.1, y = H * 0.22 + rnd() * H * 0.6, len = 26 + rnd() * 34;
      b.globalAlpha = 0.35 + rnd() * 0.65; b.lineWidth = 1 + rnd() * 1.4;
      b.beginPath(); b.moveTo(x, y); b.lineTo(x - len * 0.28, y + len); b.stroke();
    }
    ctx.save(); ctx.filter = 'blur(0.6px)'; ctx.drawImage(c, 0, 0); ctx.restore();
  }
  if (scene === 'snow') {
    for (let i = 0; i < 170; i++) {
      const x = rnd() * W, y = H * 0.12 + rnd() * H * 0.68, r = 1.6 + Math.pow(rnd(), 2) * 5;
      const c = ctx;
      c.save(); c.filter = `blur(${r > 4.5 ? 2 : 0.6}px)`;
      c.fillStyle = T.snowEdge; c.beginPath(); c.arc(x, y + 0.8, r + 0.6, 0, 7); c.fill();
      c.fillStyle = T.snow; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.restore();
    }
  }

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
