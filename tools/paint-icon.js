// Paints the app icons in icons/ in the same soft style as img/sky/.
// Run: node tools/paint-icon.js   (needs Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = [
  ['icon-512.png', 512, 1],
  ['icon-192.png', 192, 1],
  ['apple-touch-icon.png', 180, 1],
  ['icon-maskable-512.png', 512, 0.8] // Android crops to a circle: keep the art inside the middle 80%
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas><canvas id="o"></canvas>');
  for (const [name, size, scale] of OUT) {
    const url = await page.evaluate(paint, { size, scale });
    const file = path.join(__dirname, '..', 'icons', name);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(name, size + 'px', Math.round(fs.statSync(file).size / 1024) + ' KB');
  }
  await browser.close();
}

// Runs in the browser: paint at 1024 px, then downscale for crisp small sizes.
function paint({ size, scale }) {
  const S = 1024;
  const cv = document.getElementById('c');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const layer = () => { const c = document.createElement('canvas'); c.width = S; c.height = S; return c; };
  const radial = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };

  // Night-blue sky, a little lighter at the top like the dark-theme backgrounds.
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#22406B'); bg.addColorStop(0.55, '#14233D'); bg.addColorStop(1, '#0A1120');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);

  // Faint Milky Way across the top right.
  const band = layer(), b = band.getContext('2d');
  b.translate(S * 0.62, S * 0.3); b.rotate(-0.6);
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * S * 1.4, y = (rnd() - 0.5) * 130, r = 90 + rnd() * 160;
    const g = b.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(160,178,235,.10)'); g.addColorStop(1, 'rgba(160,178,235,0)');
    b.fillStyle = g; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
  }
  b.fillStyle = '#DCE4FA';
  for (let i = 0; i < 700; i++) {
    const x = (rnd() - 0.5) * S * 1.4, y = (rnd() + rnd() + rnd() - 1.5) * 120;
    b.globalAlpha = 0.12 + rnd() * 0.3; b.beginPath(); b.arc(x, y, 1 + rnd() * 1.4, 0, 7); b.fill();
  }
  ctx.save(); ctx.filter = 'blur(1.5px)'; ctx.drawImage(band, 0, 0); ctx.restore();

  // Stars, sun and cloud are painted around the centre and scaled for the maskable safe zone.
  ctx.save();
  ctx.translate(S / 2, S / 2); ctx.scale(scale, scale); ctx.translate(-S / 2, -S / 2);

  // A few bright stars (sized to survive downscaling) in the open sky.
  for (const [x, y, r] of [[0.70, 0.13, 9], [0.82, 0.24, 12], [0.90, 0.36, 7], [0.60, 0.07, 6], [0.16, 0.84, 7], [0.13, 0.20, 6], [0.93, 0.13, 5]]) {
    ctx.fillStyle = radial(x * S, y * S, r * 4.5, [[0, 'rgba(235,242,255,.55)'], [1, 'rgba(235,242,255,0)']]);
    ctx.beginPath(); ctx.arc(x * S, y * S, r * 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#F2F5FB'; ctx.beginPath(); ctx.arc(x * S, y * S, r, 0, 7); ctx.fill();
  }

  // Sun: wide warm halo, then a glowing disc with a soft edge.
  const sx = S * 0.4, sy = S * 0.4, sr = S * 0.17;
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = radial(sx, sy, sr * 3.2, [[0, 'rgba(255,205,140,.55)'], [0.35, 'rgba(255,170,100,.18)'], [1, 'rgba(255,170,100,0)']]);
  ctx.fillRect(-S, -S, 3 * S, 3 * S); // oversized so the halo is not clipped when scaled down
  ctx.restore();
  const disc = layer(), d = disc.getContext('2d');
  const dg = d.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, 0, sx, sy, sr);
  dg.addColorStop(0, '#FFF3CF'); dg.addColorStop(0.55, '#FFD98A'); dg.addColorStop(1, '#FFC062');
  d.fillStyle = dg; d.beginPath(); d.arc(sx, sy, sr, 0, 7); d.fill();
  ctx.save(); ctx.filter = 'blur(3px)'; ctx.drawImage(disc, 0, 0); ctx.restore();

  // Cloud: soft shadow, then overlapping puffs lit from above.
  const cx = S * 0.55, cy = S * 0.63, k0 = 0.78; // k0 scales the cloud
  const puffs = [[-0.27, 0.05, 0.13], [-0.12, -0.06, 0.17], [0.07, -0.12, 0.2], [0.24, -0.01, 0.15], [0.33, 0.07, 0.1]].map(([x, y, r]) => [cx + x * S * k0, cy + y * S * k0, r * S * k0]);
  const shape = c => {
    puffs.forEach(([x, y, r]) => { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
    const l = cx - S * 0.38 * k0, rr = cx + S * 0.42 * k0, top = cy - S * 0.02 * k0, bot = cy + S * 0.15 * k0, k = S * 0.08 * k0;
    c.beginPath(); c.moveTo(l + k, top); c.lineTo(rr - k, top); c.quadraticCurveTo(rr, top, rr, top + k);
    c.lineTo(rr, bot - k); c.quadraticCurveTo(rr, bot, rr - k, bot); c.lineTo(l + k, bot);
    c.quadraticCurveTo(l, bot, l, bot - k); c.lineTo(l, top + k); c.quadraticCurveTo(l, top, l + k, top); c.fill();
  };
  const sh = layer(), s = sh.getContext('2d');
  s.fillStyle = 'rgba(3,8,20,.55)'; s.translate(0, S * 0.03); shape(s);
  ctx.save(); ctx.filter = 'blur(28px)'; ctx.drawImage(sh, 0, 0); ctx.restore();
  const cl = layer(), c = cl.getContext('2d');
  const cg = c.createLinearGradient(0, cy - S * 0.33 * k0, 0, cy + S * 0.16 * k0);
  cg.addColorStop(0, '#FFFFFF'); cg.addColorStop(0.55, '#F1F5FA'); cg.addColorStop(1, '#C9D6E6');
  c.fillStyle = cg; shape(c);
  // warm rim where the sun lights the cloud's upper left
  c.globalCompositeOperation = 'source-atop';
  const rim = c.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 2.2);
  rim.addColorStop(0, 'rgba(255,214,150,.55)'); rim.addColorStop(1, 'rgba(255,214,150,0)');
  c.fillStyle = rim; c.fillRect(0, 0, S, S);
  ctx.save(); ctx.filter = 'blur(2px)'; ctx.drawImage(cl, 0, 0); ctx.restore();
  ctx.restore();

  // Downscale in halves for a clean small icon.
  let src = cv, w = S;
  const o = document.getElementById('o');
  while (w / 2 >= size) {
    const t = document.createElement('canvas'); t.width = t.height = w / 2;
    const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, w / 2, w / 2);
    src = t; w /= 2;
  }
  o.width = o.height = size;
  const oc = o.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(src, 0, 0, size, size);
  return o.toDataURL('image/png');
}

main().catch(e => { console.error(e); process.exit(1); });
