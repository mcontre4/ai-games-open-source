import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const dir = 'packages/game-template/public/assets';
await mkdir(dir, { recursive: true });
const svg = (body: string, w = 1280, h = 720) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const raster = async (name: string, body: string, w?: number, h?: number) =>
  sharp(Buffer.from(svg(body, w, h)))
    .png()
    .toFile(`${dir}/${name}.png`);
await raster(
  'background',
  `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#090e2b"/><stop offset=".6" stop-color="#26355d"/><stop offset="1" stop-color="#12263a"/></linearGradient><radialGradient id="glow"><stop stop-color="#a4fce0" stop-opacity=".38"/><stop offset="1" stop-color="#a4fce0" stop-opacity="0"/></radialGradient></defs><path fill="url(#sky)" d="M0 0h1280v720H0z"/><ellipse cx="920" cy="380" rx="500" ry="300" fill="url(#glow)"/><circle cx="990" cy="156" r="65" fill="#c6fff1" opacity=".75"/><circle cx="968" cy="142" r="67" fill="#111a3a"/>${Array.from({ length: 100 }, (_, i) => `<circle cx="${(i * 127.31) % 1280}" cy="${(i * 83.7) % 350}" r="${i % 3 === 0 ? 1.7 : 0.8}" fill="#dafff3" opacity="${0.2 + (i % 5) * 0.12}"/>`).join('')}<path d="M0 492Q270 340 450 500T950 460T1400 500V720H0" fill="#10243c"/><path d="M0 560Q300 440 640 560T1280 540V720H0" fill="#143340"/><path d="M0 625h1280" stroke="#73fed0" stroke-opacity=".12"/>`,
);
for (const [name, h, density] of [
  ['city', 720, 28],
  ['near', 360, 12],
] as const) {
  let body = '';
  for (let i = 0; i < density; i++) {
    const width = 24 + ((i * 17) % 72),
      x = (i * 1280) / density,
      height = 100 + ((i * 91) % (h - 140)),
      y = h - height;
    body += `<path d="M${x} ${h}V${y + 15}h${width * 0.2}v-15h${width * 0.6}v15h${width * 0.2}V${h}" fill="${name === 'city' ? '#101b32' : '#091526'}"/><path d="M${x + width} ${y + 22}V${h}" stroke="#7bffdf" stroke-opacity=".22"/>`;
    for (let row = 0; row < (height - 30) / 17; row++)
      for (let col = 0; col < width / 13 - 1; col++)
        if ((i + row + col) % 3)
          body += `<path d="M${x + 7 + col * 13} ${y + 28 + row * 17}h4v7h-4z" fill="${(i + row) % 4 === 0 ? '#eaa4ff' : '#78eddf'}" opacity="${0.12 + (row % 3) * 0.12}"/>`;
    if (i % 3 === 0)
      body += `<path d="M${x + 5} ${y - 25}v25M${x + 3} ${y - 25}h4" stroke="#be9ef4" stroke-width="2"/>`;
  }
  await raster(name, body, 1280, h);
}
await raster(
  'hovercraft',
  `<defs><linearGradient id="h" x2="0" y2="1"><stop stop-color="#f4fff7"/><stop offset=".5" stop-color="#97d9d0"/><stop offset="1" stop-color="#1e6474"/></linearGradient><radialGradient id="g"><stop stop-color="#6ffff2"/><stop offset="1" stop-color="#4efddc" stop-opacity="0"/></radialGradient></defs><ellipse cx="110" cy="100" rx="104" ry="34" fill="url(#g)"/><path d="M38 52L111 36l75 31 26 12-25 10H64L22 76z" fill="url(#h)" stroke="#c8fff1" stroke-width="2"/><path d="M84 49l28-10 42 21H73z" fill="#153857" stroke="#8fedff"/><path d="M60 91h123l-16 9H79z" fill="#64fbdc"/><path d="M24 64L0 60 12 80l27 7z" fill="#b8ffdf"/><path d="M137 69h30m-107 7h50" stroke="#f4ffff" stroke-width="3"/><circle cx="179" cy="79" r="3" fill="#e4fffc"/>`,
  240,
  130,
);
await raster(
  'crystal',
  `<defs><linearGradient id="c" x2="1" y2="1"><stop stop-color="#ecfff8"/><stop offset=".4" stop-color="#91ffe0"/><stop offset="1" stop-color="#137879"/></linearGradient></defs><path d="M48 5l35 42-35 67L13 47z" fill="url(#c)"/><path d="M48 5v109M13 47h70M48 5L31 47l17 67 17-67z" fill="none" stroke="#d4ffef" stroke-width="2" opacity=".7"/>`,
  96,
  120,
);
await raster(
  'obstacle',
  `<defs><linearGradient id="o" x2="1"><stop stop-color="#172841"/><stop offset="1" stop-color="#364258"/></linearGradient></defs><path d="M15 18L76 8l18 19v136l-18 16-61-10L5 148V36z" fill="url(#o)" stroke="#667893" stroke-width="2"/><path d="M13 46h75M13 131h75" stroke="#fb95aa" stroke-width="6"/><path d="M22 61h56v57H22z" fill="#0e192e" stroke="#9c6481"/><path d="M28 74l14 14-14 15m18-29 14 14-14 15m18-29 14 14-14 15" stroke="#faacc1" fill="none" stroke-width="4"/>`,
  100,
  190,
);
console.log('Deterministic Neon Comet artwork built.');
