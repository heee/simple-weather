// Paints the app icons in icons/ in the same soft style as img/sky/: a crescent moon and three stars.
// Run: node tools/paint-icon.js   (needs Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// iOS can drop home-screen icons that carry an alpha channel, so write plain RGB PNGs.
function rgbPNG(size, rgba) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

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
    const pixels = await page.evaluate(paint, { size, scale });
    const file = path.join(__dirname, '..', 'icons', name);
    fs.writeFileSync(file, rgbPNG(size, Buffer.from(pixels, 'base64')));
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
  const layer = () => { const c = document.createElement('canvas'); c.width = S; c.height = S; return c; };
  const radial = (x, y, r, stops) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };

  // Night-blue sky, a little lighter at the top like the dark-theme backgrounds (full bleed).
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#22406B'); bg.addColorStop(0.6, '#14233D'); bg.addColorStop(1, '#0A1120');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);

  // Crescent and stars are painted around the centre and scaled for the maskable safe zone.
  ctx.save();
  ctx.translate(S / 2, S / 2); ctx.scale(scale, scale); ctx.translate(-S / 2, -S / 2);
  const big = 3 * S; // oversized fills so glows are never clipped when scaled down

  // Pale-gold crescent, lit on the left like the in-app moon icon. It is drawn once, then its visible
  // outline is measured and the crescent shifted so that outline sits in the centre of the icon.
  const mr = S * 0.25;
  const crescent = (mx, my) => {
    const disc = layer(), d = disc.getContext('2d');
    const dg = d.createRadialGradient(mx - mr * 0.5, my, 0, mx, my, mr);
    dg.addColorStop(0, '#FFF8E2'); dg.addColorStop(0.6, '#F7E6B4'); dg.addColorStop(1, '#E9CF8C');
    d.fillStyle = dg; d.beginPath(); d.arc(mx, my, mr, 0, 7); d.fill();
    d.globalCompositeOperation = 'destination-out';
    d.beginPath(); d.arc(mx + mr * 0.42, my - mr * 0.2, mr * 0.86, 0, 7); d.fill();
    return disc;
  };
  const probe = crescent(S / 2, S / 2).getContext('2d').getImageData(0, 0, S, S).data;
  let x0 = S, x1 = 0, y0 = S, y1 = 0;
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    if (probe[(yy * S + xx) * 4 + 3] > 127) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  const mx = S / 2 + (S / 2 - (x0 + x1) / 2), my = S / 2 + (S / 2 - (y0 + y1) / 2);
  const disc = crescent(mx, my);

  // Soft moonlight around the crescent, then the crescent with a glow hugging it.
  ctx.fillStyle = radial(S / 2, S / 2, S * 0.5, [[0, 'rgba(255,236,200,.14)'], [1, 'rgba(255,236,200,0)']]);
  ctx.fillRect(-S, -S, big, big);
  ctx.save(); ctx.filter = 'blur(22px)'; ctx.globalAlpha = 0.5; ctx.drawImage(disc, 0, 0); ctx.restore();
  ctx.save(); ctx.filter = 'blur(2px)'; ctx.drawImage(disc, 0, 0); ctx.restore();

  // Three soft stars, sized to survive downscaling.
  for (const [x, y, r] of [[0.74, 0.26, 12], [0.82, 0.45, 7], [0.66, 0.14, 6]]) {
    ctx.fillStyle = radial(x * S, y * S, r * 5, [[0, 'rgba(235,242,255,.5)'], [1, 'rgba(235,242,255,0)']]);
    ctx.beginPath(); ctx.arc(x * S, y * S, r * 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#F2F5FB'; ctx.beginPath(); ctx.arc(x * S, y * S, r, 0, 7); ctx.fill();
  }
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
  const px = oc.getImageData(0, 0, size, size).data;
  let bin = '';
  for (let i = 0; i < px.length; i += 8192) bin += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
  return btoa(bin);
}

main().catch(e => { console.error(e); process.exit(1); });
