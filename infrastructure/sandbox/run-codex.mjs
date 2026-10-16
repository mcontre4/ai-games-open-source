import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';

const cancelling = process.argv[2] === 'cancel';
const id = process.argv[cancelling ? 3 : 2];
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Invalid run id.');
const pidFile = `/tmp/codex-${id}.pid`;
if (cancelling) {
  try {
    process.kill(-Number(await readFile(pidFile, 'utf8')), 'SIGKILL');
  } catch {}
  process.exit(0);
}
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { instructions, prompt } = JSON.parse(input);
await mkdir(process.env.CODEX_HOME, { recursive: true });
const instructionsFile = `${process.env.CODEX_HOME}/game-instructions.md`;
await writeFile(
  instructionsFile,
  `${instructions}\nUse game_files read, write and edit tools for source access and inspect_art for supplied artwork.`,
);
// Metadata for pinned CLI 0.162.1: ordinary Responses + direct MCP tools.
// Sol's bundled ChatGPT profile otherwise hides these tools behind Code Mode.
const catalog = JSON.parse(await readFile('/opt/codex-model.json', 'utf8'));
catalog.slug = process.env.GENERATION_MODEL;
catalog.model_messages = { instructions_template: instructions };
const catalogFile = `${process.env.CODEX_HOME}/models.json`;
await writeFile(catalogFile, JSON.stringify({ models: [catalog] }));
const config = `model_catalog_json = ${JSON.stringify(catalogFile)}
model = ${JSON.stringify(process.env.GENERATION_MODEL)}
model_provider = "gateway"
model_instructions_file = ${JSON.stringify(instructionsFile)}
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
model_context_window = 64000
model_auto_compact_token_limit = 60000
[features]
shell_tool = false
multi_agent = false
apps = false
plugins = false
view_image = false
enable_request_compression = false
[model_providers.gateway]
name = "Controlled OpenRouter gateway"
base_url = ${JSON.stringify(process.env.GENERATION_GATEWAY_URL)}
env_key = "GENERATION_GRANT"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
[mcp_servers.game_files]
command = "node"
args = ["/opt/game-files.mjs"]
required = true
[mcp_servers.game_files.tools.read]
approval_mode = "approve"
output_token_limit = 24000
[mcp_servers.game_files.tools.inspect_art]
approval_mode = "approve"
[mcp_servers.game_files.tools.write]
approval_mode = "approve"
[mcp_servers.game_files.tools.edit]
approval_mode = "approve"
`;
await writeFile(`${process.env.CODEX_HOME}/config.toml`, config);
const stateFile = `${process.env.CODEX_HOME}/state.json`;
const state = JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
const args = state.threadId
  ? ['exec', 'resume', '--skip-git-repo-check', '--json', state.threadId, '-']
  : ['exec', '--skip-git-repo-check', '--json', '-'];
const child = spawn('codex', args, {
  detached: true,
  stdio: ['pipe', 'pipe', 'inherit'],
});
await writeFile(pidFile, String(child.pid));
child.stdin.end(JSON.stringify({ untrustedGameRequest: prompt }));
const events = (async () => {
  for await (const line of createInterface({ input: child.stdout })) {
    const event = JSON.parse(line);
    if (event.type === 'thread.started') {
      if (!/^[a-f0-9-]{36}$/.test(event.thread_id)) throw new Error('Invalid CLI thread id.');
      state.threadId = event.thread_id;
      await writeFile(`${stateFile}.tmp`, JSON.stringify(state));
      await (await import('node:fs/promises')).rename(`${stateFile}.tmp`, stateFile);
    }
    await appendFile(`${process.env.CODEX_HOME}/events.jsonl`, line + '\n', { mode: 0o600 });
    process.stdout.write(line + '\n');
  }
})();
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
await events;
await rm(pidFile, { force: true });
process.exit(code ?? 1);
