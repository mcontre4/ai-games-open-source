import { Script } from 'node:vm';
import ts from 'typescript';
import type { GameView } from '../../domain/src/index.ts';
import { CSP, validPath, PACKAGE_LIMIT } from '../../game-sdk/src/package.ts';

// The validator and signer must execute identical local-file output. Data
// images keep Canvas pixel reads/WebGL uploads origin-clean under file://.
export function prepareLocalGameFiles(input: Record<string, Uint8Array>, view: GameView = '2d') {
  const files = { ...input };
  delete files['manifest.json'];
  for (const path of Object.keys(files))
    if (!validPath(path)) throw new Error(`Invalid output path: ${path}`);
  if (!files['index.html'] || !files['game.js'] || Object.keys(files).length > 256)
    throw new Error('Incomplete output.');
  const source = new TextDecoder().decode(files['game.js']);
  new Script(source, { filename: 'game.js' });
  if (view === '2d') {
    const ast = ts.createSourceFile(
      'game.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const edits: { start: number; end: number; value: string }[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const path = node.text.replace(/^\.\//, '');
        const match = /^assets\/.+\.(png|jpe?g|webp)$/.exec(path);
        const bytes = match && files[path];
        if (bytes) {
          const mime = match[1] === 'jpg' || match[1] === 'jpeg' ? 'jpeg' : match[1];
          edits.push({
            start: node.getStart(ast),
            end: node.getEnd(),
            value: JSON.stringify(
              `data:image/${mime};base64,${Buffer.from(bytes).toString('base64')}`,
            ),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    let local = source;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      local = local.slice(0, edit.start) + edit.value + local.slice(edit.end);
    files['game.js'] = new TextEncoder().encode(local);
  }
  let html = new TextDecoder()
    .decode(files['index.html'])
    .replace(/\s+crossorigin(?:=["']?[^\s>"']*["']?)?/gi, '')
    .replace(/type=["']module["']/gi, 'defer')
    .replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  if (!/<head[\s>]/i.test(html)) throw new Error('Game requires an HTML head.');
  html = html.replace(
    /<head([^>]*)>/i,
    `<head$1><meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  );
  if (view !== '2d') {
    const artwork = files['assets/background.png'];
    if (!artwork || !/<body[\s>]/i.test(html))
      throw new Error('3D package requires bundled artwork and an HTML body.');
    if (!/id=["']game-artwork["']/.test(html))
      html = html.replace(
        /<body([^>]*)>/i,
        `<body$1><img id="game-artwork" hidden alt="" src="data:image/png;base64,${Buffer.from(artwork).toString('base64')}" />`,
      );
  }
  files['index.html'] = new TextEncoder().encode(html);
  const assets = Object.values(files);
  if (
    assets.reduce((size, bytes) => size + bytes.length, 0) > PACKAGE_LIMIT ||
    assets.some((bytes) => bytes.length > 10 * 1024 * 1024)
  )
    throw new Error('Package exceeds limits.');
  return files;
}
