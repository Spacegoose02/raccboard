// Generates the PWA and Android launcher icons from one SVG.
// Usage: node scripts/icons.js   (run again after changing the artwork or colors)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const BG = '#2c333a';

// Raccoon-mask face drawn in a 512x512 box.
const face = `
  <path d="M120 200 L150 70 L235 160 Z" fill="#8a96a3"/>
  <path d="M392 200 L362 70 L277 160 Z" fill="#8a96a3"/>
  <path d="M140 170 L156 104 L205 156 Z" fill="#1d2125"/>
  <path d="M372 170 L356 104 L307 156 Z" fill="#1d2125"/>
  <ellipse cx="256" cy="280" rx="170" ry="140" fill="#aeb8c3"/>
  <ellipse cx="256" cy="345" rx="95" ry="75" fill="#eef1f4"/>
  <path d="M92 262 C140 196 214 196 256 236 C298 196 372 196 420 262 C384 318 310 330 256 300 C202 330 128 318 92 262 Z" fill="#1d2125"/>
  <path d="M220 170 C236 200 276 200 292 170 L280 236 L232 236 Z" fill="#eef1f4"/>
  <circle cx="190" cy="262" r="26" fill="#ffffff"/>
  <circle cx="322" cy="262" r="26" fill="#ffffff"/>
  <circle cx="195" cy="266" r="12" fill="#1d2125"/>
  <circle cx="327" cy="266" r="12" fill="#1d2125"/>
  <ellipse cx="256" cy="330" rx="26" ry="18" fill="#1d2125"/>
  <path d="M256 348 L256 372 M226 380 C240 392 272 392 286 380" stroke="#1d2125" stroke-width="8" fill="none" stroke-linecap="round"/>`;

// scale: how much of the canvas the face fills; bg: 'rounded' | 'full' | 'none'
function svg({ scale = 1, bg = 'rounded' }) {
  const off = (512 - 512 * scale) / 2;
  const back = bg === 'rounded' ? `<rect width="512" height="512" rx="112" fill="${BG}"/>`
    : bg === 'full' ? `<rect width="512" height="512" fill="${BG}"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${back}<g transform="translate(${off} ${off}) scale(${scale})">${face}</g></svg>`);
}

async function png(def, size, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(svg(def), { density: 300 }).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}

const pub = 'client/public';
fs.writeFileSync(`${pub}/favicon.svg`, svg({ scale: 0.92 }).toString());
await png({ scale: 0.92 }, 192, `${pub}/icons/icon-192.png`);
await png({ scale: 0.92 }, 512, `${pub}/icons/icon-512.png`);
await png({ scale: 0.72, bg: 'full' }, 512, `${pub}/icons/maskable-512.png`); // face inside the 80% safe zone
await png({ scale: 0.86, bg: 'full' }, 180, `${pub}/icons/apple-touch-icon.png`);

// Android launcher icons (only if the Capacitor project exists).
const res = 'android/app/src/main/res';
if (fs.existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, m] of Object.entries(dens)) {
    await png({ scale: 0.86, bg: 'rounded' }, 48 * m, `${res}/mipmap-${d}/ic_launcher.png`);
    await png({ scale: 0.86, bg: 'rounded' }, 48 * m, `${res}/mipmap-${d}/ic_launcher_round.png`);
    // Adaptive icon foreground: 108dp canvas, art within the central 66dp.
    await png({ scale: 0.6, bg: 'none' }, 108 * m, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
  }
  // Splash screens: the face centered on the brand background, at each existing size.
  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = `${res}/${dir}/splash.png`;
    if (!fs.existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    const size = Math.round(Math.min(width, height) * 0.4);
    const logo = await sharp(svg({ scale: 1, bg: 'none' }), { density: 300 }).resize(size, size).png().toBuffer();
    const out = await sharp({ create: { width, height, channels: 4, background: BG } })
      .composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
    fs.writeFileSync(file, out);
    console.log('wrote', file);
  }
  const bgXml = `${res}/values/ic_launcher_background.xml`;
  fs.writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  console.log('wrote', bgXml);
}
