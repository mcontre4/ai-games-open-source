import { z } from 'zod';

const fileTool = /^mcp__game_files__(read|write|edit|inspect_art)$/;
const textPart = z.object({ type: z.enum(['input_text', 'output_text']), text: z.string() });
const imagePart = z
  .object({
    type: z.literal('input_image'),
    image_url: z
      .string()
      .max(12_023)
      .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/),
    detail: z.enum(['auto', 'low', 'high', 'original']).optional(),
  })
  .strict();
const contentParts = z.array(z.union([textPart, imagePart])).max(32);
export const responsesBody = z
  .object({
    input: z.array(z.record(z.string(), z.unknown())).max(120),
    instructions: z.string().optional(),
    tools: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
    model: z.string().optional(),
    stream: z.boolean().optional(),
    store: z.boolean().optional(),
    parallel_tool_calls: z.boolean().optional(),
    reasoning: z.unknown().optional(),
    text: z.unknown().optional(),
    include: z.array(z.string()).optional(),
    prompt_cache_key: z.string().optional(),
    max_output_tokens: z.number().optional(),
    service_tier: z.string().optional(),
    tool_choice: z.unknown().optional(),
    client_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function normalizeToolOutput(raw: unknown) {
  const parts = contentParts.parse(raw);
  if (parts.some((part) => part.type === 'input_image')) return parts;
  return parts.map((part) => ('text' in part ? part.text : '')).join('\n');
}

// Retain native Responses reasoning history; flatten only the scoped MCP namespace.
// Server-owned model, reasoning and spending settings are applied by OpenRouterClient.
export function codexResponsesInput(raw: unknown): Record<string, unknown> {
  const body = responsesBody.parse(raw);
  const additionalTools = body.input
    .filter((item) => item.type === 'additional_tools')
    .flatMap((item) => z.array(z.record(z.string(), z.unknown())).parse(item.tools));
  const history = body.input.filter((item) => item.type !== 'additional_tools');
  for (const item of history) {
    if (
      !['reasoning', 'function_call', 'function_call_output', 'message', undefined].includes(
        item.type as string | undefined,
      )
    )
      throw new Error(`Unsupported Responses input type: ${String(item.type)}`);
    if ((!item.type || item.type === 'message') && !Array.isArray(item.content))
      throw new Error(
        `Responses message content must be bounded text/image parts; fields: ${Object.keys(item).join(',')}`,
      );
  }
  const input = history.map((item) => {
    if (item.type === 'reasoning')
      return z
        .object({
          type: z.literal('reasoning'),
          id: z.string().optional(),
          encrypted_content: z.string().nullish(),
          summary: z.array(z.unknown()).optional(),
        })
        .parse(item);
    if (item.type === 'function_call')
      return {
        type: 'function_call',
        call_id: z.string().parse(item.call_id),
        name: z
          .string()
          .regex(fileTool)
          .parse(item.namespace ? `${item.namespace}__${item.name}` : item.name),
        arguments: z.string().parse(item.arguments),
      };
    if (item.type === 'function_call_output')
      return {
        type: 'function_call_output',
        call_id: z.string().parse(item.call_id),
        output: typeof item.output === 'string' ? item.output : normalizeToolOutput(item.output),
      };
    return {
      type: 'message',
      role: z.enum(['system', 'developer', 'user', 'assistant']).parse(item.role),
      content: contentParts.parse(item.content),
    };
  });
  const tools = [...(body.tools ?? []), ...additionalTools]
    .flatMap((tool) => {
      if (tool.type === 'namespace' && tool.name === 'mcp__game_files')
        if (!Array.isArray(tool.tools))
          throw new Error(`Invalid file namespace fields: ${Object.keys(tool).join(',')}`);
      if (tool.type === 'namespace' && tool.name === 'mcp__game_files')
        return z
          .array(z.record(z.string(), z.unknown()))
          .parse(tool.tools)
          .map((member) => ({ ...member, name: `${tool.name}__${member.name}` }));
      return [tool];
    })
    .filter((tool) => tool.type === 'function' && fileTool.test(String(tool.name)))
    .map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    }));
  // Codex summarizes long conversations with an explicit empty tool set before
  // resuming a repair. This request can only produce text; missing tools or
  // unsupported tool sets must still fail rather than silently losing scope.
  const textOnly = body.tools?.length === 0 && additionalTools.length === 0;
  if (!tools.length && !textOnly) throw new Error('Scoped game file tools are required.');
  return {
    input,
    tools,
    instructions: body.instructions,
    tool_choice: tools.length ? 'auto' : 'none',
  };
}

export function codexResponse(raw: unknown, model: string) {
  const response = z
    .object({
      id: z.string(),
      status: z.string(),
      output: z.array(z.record(z.string(), z.unknown())),
      usage: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .parse(raw);
  if (response.status !== 'completed') throw new Error('Incomplete model output.');
  const output = response.output.map((item) => {
    if (item.type === 'function_call') {
      const name = z
        .string()
        .regex(fileTool)
        .parse(item.namespace ? `${item.namespace}__${item.name}` : item.name);
      z.string().parse(item.call_id);
      z.string().parse(item.arguments);
      return { ...item, name: name.split('__').at(-1), namespace: 'mcp__game_files' };
    }
    if (item.type === 'message') {
      z.literal('assistant').parse(item.role);
      z.array(z.object({ type: z.literal('output_text'), text: z.string() }))
        .min(1)
        .parse(item.content);
      return item;
    }
    if (item.type === 'reasoning') return item;
    throw new Error('Unsupported model tool output.');
  });
  if (!output.some((item) => item.type === 'function_call' || item.type === 'message'))
    throw new Error('Empty model output.');
  const counts = z
    .object({
      input_tokens: z.number().default(0),
      output_tokens: z.number().default(0),
      total_tokens: z.number().optional(),
    })
    .passthrough()
    .parse(response.usage ?? {});
  return {
    ...response,
    object: 'response',
    created_at: response.created_at ?? Math.floor(Date.now() / 1000),
    model,
    output,
    usage: {
      ...counts,
      total_tokens: counts.total_tokens ?? counts.input_tokens + counts.output_tokens,
    },
  };
}

export function codexResponseStream(response: ReturnType<typeof codexResponse>): string {
  const events: Record<string, unknown>[] = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
  ];
  response.output.forEach((item, index) => {
    events.push({
      type: 'response.output_item.added',
      output_index: index,
      item: {
        ...item,
        status: 'in_progress',
        ...(item.type === 'function_call'
          ? { arguments: '' }
          : item.type === 'message'
            ? { content: [] }
            : {}),
      },
    });
    if (item.type === 'function_call') {
      events.push({
        type: 'response.function_call_arguments.delta',
        item_id: item.id,
        output_index: index,
        delta: item.arguments,
      });
      events.push({
        type: 'response.function_call_arguments.done',
        item_id: item.id,
        output_index: index,
        arguments: item.arguments,
      });
    } else if (item.type === 'message') {
      const part = (item.content as { text: string }[])[0]!;
      events.push({
        type: 'response.content_part.added',
        item_id: item.id,
        output_index: index,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      });
      events.push({
        type: 'response.output_text.delta',
        item_id: item.id,
        output_index: index,
        content_index: 0,
        delta: part.text,
      });
      events.push({
        type: 'response.output_text.done',
        item_id: item.id,
        output_index: index,
        content_index: 0,
        text: part.text,
      });
      events.push({
        type: 'response.content_part.done',
        item_id: item.id,
        output_index: index,
        content_index: 0,
        part,
      });
    }
    events.push({ type: 'response.output_item.done', output_index: index, item });
  });
  events.push({ type: 'response.completed', response });
  return events
    .map(
      (event, sequence_number) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
    )
    .join('');
}
