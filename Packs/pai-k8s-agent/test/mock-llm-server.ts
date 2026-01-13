/**
 * Mock LLM Server
 *
 * Simulates an OpenAI-compatible API for testing without a real LLM.
 * Supports basic chat completions and tool calling.
 */

const PORT = 11434;

// Simple response patterns
const RESPONSES: Record<string, string> = {
  default: "I'm a mock LLM response for testing purposes.",
  greeting: "Hello! I'm Kai, your AI assistant. How can I help you today?",
  list_files: "I'll list the files for you using the list_files tool.",
  math: "Let me calculate that for you.",
};

// Check if message requests a tool
function shouldUseTool(content: string): { name: string; args: Record<string, unknown> } | null {
  const lower = content.toLowerCase();

  if (lower.includes('list') && (lower.includes('file') || lower.includes('director'))) {
    return {
      name: 'list_files',
      args: { path: '.', pattern: '*' },
    };
  }

  if (lower.includes('read') && lower.includes('file')) {
    // Extract filename if mentioned
    const match = content.match(/read\s+(?:file\s+)?["']?([^\s"']+)["']?/i);
    return {
      name: 'read_file',
      args: { path: match?.[1] || 'package.json' },
    };
  }

  if (lower.includes('run') || lower.includes('execute') || lower.includes('bash')) {
    const match = content.match(/(?:run|execute|bash)\s+["']?([^"']+)["']?/i);
    return {
      name: 'bash',
      args: { command: match?.[1] || 'echo "Hello from mock"' },
    };
  }

  return null;
}

// Generate response based on input
function generateResponse(messages: any[]): string {
  const lastMessage = messages[messages.length - 1];
  const content = lastMessage?.content?.toLowerCase() || '';

  // Check for tool results - generate summary
  if (lastMessage?.role === 'tool') {
    const toolResult = lastMessage.content;
    try {
      const parsed = JSON.parse(toolResult);
      if (Array.isArray(parsed)) {
        return `I found ${parsed.length} items: ${parsed.slice(0, 5).join(', ')}${parsed.length > 5 ? '...' : ''}`;
      }
      if (parsed.stdout) {
        return `Command executed successfully. Output:\n${parsed.stdout}`;
      }
      if (typeof parsed === 'string') {
        return `Here's the content:\n${parsed.slice(0, 200)}${parsed.length > 200 ? '...' : ''}`;
      }
    } catch {
      return `Tool completed. Result: ${toolResult.slice(0, 100)}`;
    }
    return `The operation completed successfully.`;
  }

  if (content.includes('hello') || content.includes('hi ') || content === 'hi') {
    return RESPONSES.greeting;
  }

  if (content.includes('list') && content.includes('file')) {
    return RESPONSES.list_files;
  }

  return RESPONSES.default;
}

// Create streaming chunks
function* createStreamChunks(content: string, model: string, id: string) {
  const words = content.split(' ');

  for (let i = 0; i < words.length; i++) {
    const word = words[i] + (i < words.length - 1 ? ' ' : '');
    yield {
      id,
      object: 'chat.completion.chunk',
      model,
      choices: [{
        index: 0,
        delta: { content: word },
        finish_reason: null,
      }],
    };
  }

  // Final chunk
  yield {
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop',
    }],
  };
}

// Create tool call streaming chunks
function* createToolCallChunks(toolCall: { name: string; args: Record<string, unknown> }, model: string, id: string) {
  const toolCallId = `call_${Math.random().toString(36).slice(2, 11)}`;
  const argsStr = JSON.stringify(toolCall.args);

  // First chunk: tool call start
  yield {
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{
      index: 0,
      delta: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          index: 0,
          id: toolCallId,
          type: 'function',
          function: { name: toolCall.name, arguments: '' },
        }],
      },
      finish_reason: null,
    }],
  };

  // Arguments in chunks
  for (let i = 0; i < argsStr.length; i += 10) {
    yield {
      id,
      object: 'chat.completion.chunk',
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: argsStr.slice(i, i + 10) },
          }],
        },
        finish_reason: null,
      }],
    };
  }

  // Final chunk
  yield {
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'tool_calls',
    }],
  };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Models endpoint
    if (url.pathname === '/v1/models') {
      return Response.json({
        object: 'list',
        data: [
          { id: 'mock-model', object: 'model', owned_by: 'test' },
          { id: 'qwen2.5:7b', object: 'model', owned_by: 'test' },
        ],
      });
    }

    // Chat completions
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await req.json();
      const { messages, model = 'mock-model', stream = false, tools } = body;
      const id = `chatcmpl-${Math.random().toString(36).slice(2, 11)}`;

      // Check if we should use a tool
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const toolCall = tools && lastUserMsg ? shouldUseTool(lastUserMsg.content) : null;

      if (stream) {
        // Streaming response
        const encoder = new TextEncoder();

        return new Response(
          new ReadableStream({
            async start(controller) {
              const chunks = toolCall
                ? createToolCallChunks(toolCall, model, id)
                : createStreamChunks(generateResponse(messages), model, id);

              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                await new Promise(r => setTimeout(r, 20)); // Simulate latency
              }

              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            },
          }
        );
      }

      // Non-streaming response
      if (toolCall) {
        const toolCallId = `call_${Math.random().toString(36).slice(2, 11)}`;
        return Response.json({
          id,
          object: 'chat.completion',
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: toolCallId,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.args),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });
      }

      const response = generateResponse(messages);
      return Response.json({
        id,
        object: 'chat.completion',
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: response },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: response.split(' ').length, total_tokens: 10 + response.split(' ').length },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Mock LLM Server running on http://localhost:${PORT}`);
console.log('Endpoints:');
console.log(`  GET  /v1/models`);
console.log(`  POST /v1/chat/completions`);
console.log('\nPress Ctrl+C to stop');
