/**
 * Basic Usage Example
 *
 * Demonstrates how to use the PAI LLM Provider with vLLM or Ollama.
 *
 * Run with:
 *   # For Ollama (local)
 *   USE_OLLAMA=true bun run examples/basic-usage.ts
 *
 *   # For vLLM (cluster)
 *   VLLM_ENDPOINT=http://vllm-service:8000/v1 bun run examples/basic-usage.ts
 */

import { ModelRouter, OLLAMA_CONFIG } from '../src';

async function main() {
  console.log('PAI LLM Provider - Basic Usage Example\n');

  // Create router from environment or use Ollama for local testing
  const router =
    process.env.USE_OLLAMA === 'true'
      ? new ModelRouter(OLLAMA_CONFIG)
      : ModelRouter.fromEnv();

  // Health check
  console.log('Checking provider health...');
  const healthy = await router.healthCheck();
  if (!healthy) {
    console.error('No LLM providers are available. Make sure vLLM or Ollama is running.');
    process.exit(1);
  }
  console.log('Provider is healthy!\n');

  // Simple completion
  console.log('--- Simple Completion (quick effort) ---');
  const response = await router.complete({
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Be concise.' },
      { role: 'user', content: 'What is 2 + 2?' },
    ],
    effort: 'quick',
  });
  console.log(`Response: ${response.choices[0].message.content}`);
  console.log(`Model: ${response.model}`);
  if (response.usage) {
    console.log(`Tokens: ${response.usage.total_tokens}`);
  }
  console.log();

  // Streaming completion
  console.log('--- Streaming Completion (standard effort) ---');
  process.stdout.write('Response: ');
  for await (const chunk of router.stream({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Write a haiku about AI.' },
    ],
    effort: 'standard',
  })) {
    const content = chunk.choices[0]?.delta.content;
    if (content) {
      process.stdout.write(content);
    }
  }
  console.log('\n');

  // Tool calling example (if model supports it)
  console.log('--- Tool Calling Example ---');
  try {
    const toolResponse = await router.complete({
      messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      effort: 'standard',
    });

    const message = toolResponse.choices[0].message;
    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log('Model requested tool call:');
      for (const tc of message.tool_calls) {
        console.log(`  Function: ${tc.function.name}`);
        console.log(`  Arguments: ${tc.function.arguments}`);
      }
    } else {
      console.log(`Response: ${message.content}`);
    }
  } catch (error) {
    console.log('Tool calling not supported by this model or configuration');
  }

  console.log('\nDone!');
}

main().catch(console.error);
