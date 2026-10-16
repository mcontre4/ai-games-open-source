import { expect, it } from 'vitest';
import {
  codexResponsesInput,
  codexResponse,
  codexResponseStream,
} from '../../packages/adapters/src/ai/codex-protocol.ts';

const tools = [
  {
    type: 'namespace',
    name: 'mcp__game_files',
    tools: [
      { type: 'function', name: 'read', parameters: { type: 'object' } },
      { type: 'function', name: 'write', parameters: { type: 'object' } },
    ],
  },
  { type: 'function', name: 'exec_command' },
  { type: 'custom', name: 'apply_patch' },
  { type: 'web_search' },
];
const call = {
  id: 'fc_1',
  type: 'function_call',
  name: 'mcp__game_files__write',
  call_id: 'a',
  arguments: '{"path":"src/Game.ts","content":"game"}',
};
const reasoning = {
  type: 'reasoning',
  id: 'rs_1',
  encrypted_content: 'opaque reasoning',
  summary: [],
};
const message = {
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
};
const response = {
  id: 'resp_1',
  status: 'completed',
  output: [reasoning, call, message],
  usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
};

it('preserves native reasoning history and exposes only scoped file tools', () => {
  const input = [
    { role: 'user', content: [{ type: 'input_text', text: 'Create a game.' }] },
    reasoning,
    { ...call, name: 'write', namespace: 'mcp__game_files' },
    {
      type: 'function_call_output',
      call_id: 'a',
      output: [{ type: 'input_text', text: 'Saved.' }],
    },
  ];
  const result = codexResponsesInput({ instructions: 'Game instructions.', tools, input });
  expect(result.tools).toMatchObject([
    { type: 'function', name: 'mcp__game_files__read' },
    { type: 'function', name: 'mcp__game_files__write' },
  ]);
  expect(result.input).toEqual([
    { ...input[0], type: 'message' },
    reasoning,
    { type: 'function_call', call_id: 'a', name: call.name, arguments: call.arguments },
    { type: 'function_call_output', call_id: 'a', output: 'Saved.' },
  ]);
});
it('rejects unsupported history, routing controls and model shell calls', () => {
  expect(() => codexResponsesInput({ input: [] })).toThrow('Scoped game file tools');
  expect(() =>
    codexResponsesInput({ input: [], tools, provider: { allow_fallbacks: true } }),
  ).toThrow();
  expect(() => codexResponsesInput({ input: [], tools: tools.slice(1) })).toThrow();
  expect(() =>
    codexResponsesInput({ tools, input: [{ type: 'custom_tool_call', name: 'apply_patch' }] }),
  ).toThrow();
  expect(() =>
    codexResponse({ ...response, output: [{ ...call, name: 'exec_command' }] }, 'test'),
  ).toThrow();
  expect(() =>
    codexResponse({ ...response, output: [{ type: 'web_search_call' }] }, 'test'),
  ).toThrow();
});
it('allows explicit text-only Codex compaction while retaining scoped history checks', () => {
  const input = [
    reasoning,
    call,
    { type: 'function_call_output', call_id: 'a', output: 'Saved.' },
    {
      role: 'user',
      content: [{ type: 'input_text', text: 'Summarize progress for the next turn.' }],
    },
  ];
  expect(codexResponsesInput({ input, tools: [], tool_choice: 'auto' })).toMatchObject({
    input: [
      reasoning,
      { type: call.type, name: call.name, call_id: call.call_id },
      input[2],
      input[3],
    ],
    tools: [],
    tool_choice: 'none',
  });
  expect(() =>
    codexResponsesInput({
      tools: [],
      input: [{ type: 'function_call', call_id: 'shell', name: 'exec_command', arguments: '{}' }],
    }),
  ).toThrow();
  expect(() =>
    codexResponsesInput({
      tools: [],
      input: [{ type: 'additional_tools', tools: tools.slice(1) }],
    }),
  ).toThrow('Scoped game file tools');
});
it('emits Responses SSE including native reasoning, namespaced file calls, text and settled usage', () => {
  const normalized = codexResponse(response, 'test-model');
  expect(normalized.output[1]).toMatchObject({ name: 'write', namespace: 'mcp__game_files' });
  const events = codexResponseStream(normalized)
    .trim()
    .split('\n\n')
    .map((event) => JSON.parse(event.split('\ndata: ')[1]!));
  expect(events[0].type).toBe('response.created');
  expect(events.at(-1)).toMatchObject({
    type: 'response.completed',
    response: { model: 'test-model', usage: response.usage },
  });
  expect(
    events.find((event) => event.type === 'response.function_call_arguments.delta').delta,
  ).toContain('src/Game.ts');
  expect(events.filter((event) => event.type === 'response.output_item.done')).toHaveLength(3);
  expect(events.find((event) => event.type === 'response.output_item.done').item).toEqual(
    reasoning,
  );
});
it('fails closed on truncated or reasoning-only output', () => {
  expect(() => codexResponse({ ...response, status: 'incomplete' }, 'test')).toThrow('Incomplete');
  expect(() => codexResponse({ ...response, output: [reasoning] }, 'test')).toThrow('Empty');
});
it('retains parallel file calls in stateless Responses history', () => {
  const result = codexResponsesInput({
    tools,
    input: [
      call,
      { ...call, call_id: 'b' },
      { type: 'function_call_output', call_id: 'a', output: 'Saved first.' },
      { type: 'function_call_output', call_id: 'b', output: 'Saved second.' },
    ],
  });
  expect(result.input).toHaveLength(4);
});

it('normalizes GPT-6.1 Sol Responses Lite additional_tools without broadening allowed tools', () => {
  const result = codexResponsesInput({
    input: [
      { type: 'additional_tools', role: 'developer', tools },
      { role: 'user', content: [{ type: 'input_text', text: 'Create a game.' }] },
    ],
  });
  expect(result.tools).toHaveLength(2);
  expect(result.input).toHaveLength(1);
  expect(result.tools).toMatchObject([
    { name: 'mcp__game_files__read' },
    { name: 'mcp__game_files__write' },
  ]);
});

it('transports bounded JPEG artwork through scoped image tool results and message history', () => {
  const image = {
    type: 'input_image',
    image_url: 'data:image/jpeg;base64,/9j/AAAA',
    detail: 'low',
  };
  const result = codexResponsesInput({
    tools: [...tools, { type: 'function', name: 'mcp__game_files__inspect_art' }],
    input: [
      {
        type: 'function_call_output',
        call_id: 'image',
        output: [{ type: 'input_text', text: 'Artwork' }, image],
      },
      { role: 'user', content: [image] },
    ],
  });
  expect(result.input).toMatchObject([
    { output: [{ text: 'Artwork' }, image] },
    { content: [image] },
  ]);
  expect(result.tools).toHaveLength(3);
});
it.each([
  'https://example.com/image.jpg',
  'file:///private/key',
  'data:image/svg+xml;base64,AAAA',
  'data:image/jpeg;base64,/9j/' + 'A'.repeat(12000),
])('rejects external, non-raster or oversized visual input %s', (url) => {
  expect(() =>
    codexResponsesInput({
      tools,
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: url }] }],
    }),
  ).toThrow();
});

it('transports scoped exact edits while excluding unrestricted patch tools', () => {
  const editCall = {
    ...call,
    name: 'edit',
    namespace: 'mcp__game_files',
    arguments: JSON.stringify({ path: 'src/Game.ts', oldText: 'old span', newText: 'new span' }),
  };
  const request = codexResponsesInput({
    tools: [
      {
        type: 'namespace',
        name: 'mcp__game_files',
        tools: [{ type: 'function', name: 'edit', parameters: { type: 'object' } }],
      },
      { type: 'function', name: 'apply_patch' },
    ],
    input: [editCall],
  });
  expect(request.tools).toMatchObject([{ name: 'mcp__game_files__edit' }]);
  expect(request.input).toMatchObject([
    { type: 'function_call', name: 'mcp__game_files__edit', arguments: editCall.arguments },
  ]);
  expect(
    codexResponse(
      { ...response, output: [{ ...call, name: 'mcp__game_files__edit' }] },
      'test-model',
    ).output,
  ).toMatchObject([{ name: 'edit', namespace: 'mcp__game_files' }]);
});
