// Explicit deterministic runtime fixture, never a live-generation substitute.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { validateGameInBrowser } from '../packages/adapters/src/generation/browser-validation.ts';
import sharp from 'sharp';
const root = resolve('packages/game-template/dist');
const files: Record<string, Uint8Array> = {};
for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (file.isFile()) {
    const path = resolve(file.parentPath, file.name);
    files[relative(root, path)] = await readFile(path);
  }
}
const mode = process.argv[2];
if (mode === 'delayed-progression' || mode === 'local-pixel-reads' || mode === 'outside-file') {
  // A deterministic game that completes a gesture after a travel animation.
  // Its early and earned-progress frames have different visible canvas colors.
  for (const path of Object.keys(files)) delete files[path];
  files['index.html'] = new TextEncoder().encode(`<html><head><style>
    body{margin:0}canvas{width:100vw;height:100vh}nav{position:absolute;top:0}
    #paused{display:none}
    </style></head><body><canvas></canvas><nav><button id="play">Play</button>
    <button id="pause">Pause</button><span id="paused">Paused</span>
    <span id="score">0</span></nav><script src="game.js"></script></body></html>`);
  files['game.js'] = new TextEncoder().encode(`
    const canvas=document.querySelector('canvas'), context=canvas.getContext('2d');
    canvas.width=innerWidth; canvas.height=innerHeight;
    let playing=false, scheduled=false;
    function draw(complete){
      const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height);
      gradient.addColorStop(0,complete?'#008000':'#800000');
      gradient.addColorStop(1,complete?'#00ff00':'#ff0000');
      context.fillStyle=gradient;context.fillRect(0,0,canvas.width,canvas.height);
    }
    draw(false);
    document.querySelector('#play').onclick=()=>{playing=true};
    document.querySelector('#pause').onclick=()=>{
      const paused=document.querySelector('#paused');
      paused.style.display=paused.style.display==='block'?'none':'block';
    };
    canvas.onpointerup=()=>{
      if(!playing||scheduled)return;scheduled=true;
      setTimeout(()=>{document.querySelector('#score').textContent='1';setTimeout(()=>draw(true),500)},4500);
    };
    // saveState: the minimal fixture exercises capture timing, not SDK integration.
  `);
  if (mode === 'local-pixel-reads') {
    files['assets/pixel.png'] = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#dd9933' },
    })
      .png()
      .toBuffer();
    const source = new TextDecoder().decode(files['game.js']);
    files['game.js'] = new TextEncoder().encode(
      source.replace(
        '    draw(false);',
        `
      if(!document.URL.startsWith('file:'))throw new Error('Fixture must run from a real file URL.');
      const art=new Image();art.src='assets/pixel.png';
      art.onload=()=>{context.drawImage(art,0,0);context.getImageData(0,0,1,1);};
      draw(false);`,
      ),
    );
  }
  if (mode === 'outside-file') {
    files['game.js'] = new TextEncoder().encode(
      new TextDecoder().decode(files['game.js']) +
        "const external=new Image();external.src='file:///outside-game-scope/probe.png';",
    );
  }
}
if (mode === 'unused-sprites' || mode === 'rendered-sprites') {
  files['assets/sprites.png'] = await sharp(files['assets/hovercraft.png'])
    .resize(512, 512, { fit: 'contain', background: '#00000000' })
    .extend({ right: 512, bottom: 512, background: '#00000000' })
    .png()
    .toBuffer();
  if (mode === 'rendered-sprites') {
    const original = new TextDecoder().decode(files['game.js']);
    const changed = original.replace(
      /this\.load\.image\((['"`])craft\1,\s*(['"`])assets\/hovercraft\.png\2\)/,
      "this.load.spritesheet('craft','assets/sprites.png',{frameWidth:512,frameHeight:512})",
    );
    if (changed === original) throw new Error('Fixture sprite loader replacement failed.');
    files['game.js'] = new TextEncoder().encode(changed);
  }
}
if (mode === 'unused-sprites' || mode === 'outside-file') {
  try {
    await validateGameInBrowser(files);
  } catch (error) {
    if (
      String(error).includes(
        mode === 'outside-file'
          ? 'External network request.'
          : 'sprites.png is not rendered during play',
      )
    )
      process.exit(0);
    throw error;
  }
  throw new Error('An unused sprite sheet incorrectly passed publication.');
} else {
  const visuals = await validateGameInBrowser(files);
  if (visuals.length !== 6) throw new Error('Missing browser visual review captures.');
  for (const orientation of ['portrait', 'landscape'])
    for (const phase of ['menu', 'play', 'later-play']) {
      const capture = visuals.find(
        (frame) => frame.orientation === orientation && frame.phase === phase,
      );
      if (!capture || capture.bytes.byteLength > 32_000)
        throw new Error('Missing or oversized visual capture.');
      const metadata = await sharp(capture.bytes).metadata();
      if (metadata.format !== 'jpeg' || Math.max(metadata.width!, metadata.height!) > 512)
        throw new Error('Invalid browser visual capture.');
      if (mode === 'delayed-progression' && phase !== 'menu') {
        const pixel = await sharp(capture.bytes)
          .extract({
            left: Math.floor(metadata.width! / 2),
            top: Math.floor(metadata.height! / 2),
            width: 1,
            height: 1,
          })
          .raw()
          .toBuffer();
        if (phase === 'play' ? pixel[0]! <= pixel[1]! : pixel[1]! <= pixel[0]!)
          throw new Error(`The ${orientation} ${phase} capture missed real delayed progression.`);
      }
    }
}
