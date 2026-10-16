import { readFile, writeFile, readdir, lstat, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
const mode = process.argv[2];
const allowed =
  /^(state\.json|events\.jsonl|sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[a-zA-Z0-9_-]+\.jsonl)$/;
const context = Object.create(null);
let total = 0;
async function add(path, root, result, relative) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024)
    throw new Error('Invalid checkpoint file.');
  const bytes = await readFile(path);
  total += bytes.length;
  if (total > 30 * 1024 * 1024 || Object.keys(result).length >= 256)
    throw new Error('Checkpoint exceeds limit.');
  // Grants are regenerated on resume and must never enter the archive.
  result[relative] =
    root === '/codex'
      ? Buffer.from(
          bytes
            .toString('utf8')
            .replaceAll(process.env.GENERATION_GRANT || '\0', '[redacted-grant]'),
        ).toString('base64')
      : bytes.toString('base64');
}
async function walk(root, relative, result) {
  for (const entry of await readdir(`${root}/${relative}`, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  )) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Checkpoint contains a symbolic link.');
    if (entry.isDirectory()) await walk(root, name, result);
    else {
      if (root === '/codex' && !allowed.test(name)) throw new Error('Invalid session file.');
      if (root === '/workspace' && !/^public\/assets\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(name))
        throw new Error('Invalid artwork file.');
      await add(`${root}/${name}`, root, result, name);
    }
  }
}
if (mode === 'export') {
  const source = Object.create(null);
  for (const path of ['src/Game.ts', 'public/game.json'])
    await add(`/workspace/${path}`, '/workspace', source, path);
  await walk('/workspace', 'public/assets', source);
  await walk('/codex', 'sessions', context);
  for (const path of ['state.json', 'events.jsonl']) {
    try {
      await add(`/codex/${path}`, '/codex', context, path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  process.stdout.write(JSON.stringify({ source, context }));
} else if (mode === 'import') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (input.length > 45 * 1024 * 1024) throw new Error('Context exceeds limit.');
  const files = JSON.parse(input);
  for (const [path, encoded] of Object.entries(files)) {
    if (!allowed.test(path) || typeof encoded !== 'string')
      throw new Error('Invalid context path.');
    let bytes = Buffer.from(encoded, 'base64');
    total += bytes.length;
    if (bytes.length > 10 * 1024 * 1024 || total > 30 * 1024 * 1024)
      throw new Error('Context exceeds limit.');
    if (path.endsWith('.jsonl')) {
      // Snapshot may race the last append. Keep all complete records only.
      const lines = bytes.toString('utf8').split('\n');
      if (lines.at(-1)) lines.pop();
      for (const line of lines.filter(Boolean)) JSON.parse(line);
      bytes = Buffer.from(lines.filter(Boolean).join('\n') + '\n');
    } else {
      const state = JSON.parse(bytes.toString('utf8'));
      if (state.threadId && !/^[a-f0-9-]{36}$/.test(state.threadId))
        throw new Error('Invalid thread.');
      if (state.baseline && !/^[a-f0-9]{64}  \/workspace\/src\/Game\.ts$/.test(state.baseline))
        throw new Error('Invalid source baseline.');
    }
    const target = `/codex/${path}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, bytes, { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  }
} else throw new Error('Invalid checkpoint operation.');
