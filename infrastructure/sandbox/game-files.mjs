import { createInterface } from 'node:readline';
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';

// This MCP server is the agent's only file interface. No shell or arbitrary paths.
const readable = new Set([
  'src/Game.ts',
  'src/sdk.ts',
  'src/main.ts',
  'src/runtime.ts',
  'src/style.css',
  'index.html',
  'public/game.json',
]);
async function pathFor(path, writing) {
  if (typeof path !== 'string') throw new Error('Invalid path.');
  path = path.replace(/^\/workspace\//, '');
  if (writing ? !['src/Game.ts', 'public/game.json'].includes(path) : !readable.has(path))
    throw new Error('File access denied.');
  const target = resolve('/workspace', path);
  if ((await lstat(target)).isSymbolicLink() || (await realpath(target)) !== target)
    throw new Error('Symbolic links are forbidden.');
  return target;
}
const tools = ['read', 'write', 'edit', 'inspect_art'].map((name) => ({
  name,
  description:
    name === 'inspect_art'
      ? 'View the trusted background or sprite sheet as an image. Path must be background or sprites. Inspect each once before composing gameplay.'
      : name === 'read'
        ? 'Read a game source or starter file.'
        : name === 'edit'
          ? 'Replace one exact unique text span in Game.ts or game.json. Prefer this for repairs instead of rewriting complete files. Read the current file first; oldText must match exactly once.'
          : 'Replace Game.ts or game.json with complete UTF-8 content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      ...(name === 'write' ? { content: { type: 'string' } } : {}),
      ...(name === 'edit' ? { oldText: { type: 'string' }, newText: { type: 'string' } } : {}),
    },
    required:
      name === 'write'
        ? ['path', 'content']
        : name === 'edit'
          ? ['path', 'oldText', 'newText']
          : ['path'],
    additionalProperties: false,
  },
}));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  try {
    if (request.method === 'initialize')
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'game-files', version: '1.0.0' },
      };
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') {
      const { name, arguments: args } = request.params;
      if (!['read', 'write', 'edit', 'inspect_art'].includes(name))
        throw new Error('Unknown tool.');
      if (name === 'inspect_art') {
        if (!['background', 'sprites'].includes(args.path))
          throw new Error('Artwork access denied.');
        const path = `/workspace/visuals/${args.path}.jpg`;
        if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
          throw new Error('Symbolic links are forbidden.');
        const bytes = await readFile(path);
        if (bytes.length > 9000 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
          throw new Error('Invalid artwork preview.');
        result = {
          content: [{ type: 'image', mimeType: 'image/jpeg', data: bytes.toString('base64') }],
        };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
        continue;
      }
      const path = await pathFor(args.path, name !== 'read');
      if (name === 'write' || name === 'edit') {
        let content = args.content;
        if (name === 'edit') {
          if (
            typeof args.oldText !== 'string' ||
            !args.oldText.length ||
            typeof args.newText !== 'string' ||
            Buffer.byteLength(args.oldText) > 100_000 ||
            Buffer.byteLength(args.newText) > 100_000
          )
            throw new Error('Invalid edit text.');
          const current = await readFile(path, 'utf8');
          const at = current.indexOf(args.oldText);
          if (at < 0 || at !== current.lastIndexOf(args.oldText))
            throw new Error(
              'Edit requires exactly one matching text span. Read the current file and use a unique exact match.',
            );
          content = current.slice(0, at) + args.newText + current.slice(at + args.oldText.length);
        }
        if (typeof content !== 'string' || Buffer.byteLength(content) > 100_000)
          throw new Error('Content exceeds limit.');
        // Atomic replacement prevents a checkpoint from capturing a truncated file.
        await writeFile(`${path}.tmp`, content);
        await (await import('node:fs/promises')).rename(`${path}.tmp`, path);
        if (process.env.GENERATION_CHECKPOINTS_REQUIRED === 'true') {
          const saved = await fetch(`${process.env.GENERATION_GATEWAY_URL}/checkpoint`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.GENERATION_GRANT}` },
            signal: AbortSignal.timeout(120_000),
          });
          if (!saved.ok)
            throw new Error('Progress checkpoint failed. The worker will preserve this workspace.');
        }
      }
      result = {
        content: [
          { type: 'text', text: name === 'read' ? await readFile(path, 'utf8') : 'File saved.' },
        ],
      };
    } else if (request.method === 'ping') result = {};
    else throw new Error('Unknown method.');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { isError: true, content: [{ type: 'text', text: error.message }] },
      }) + '\n',
    );
  }
}
