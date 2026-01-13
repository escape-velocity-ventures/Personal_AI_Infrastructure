/**
 * Integration Test for Phase 1 + Phase 2
 *
 * Tests:
 * 1. LLM Provider (pai-llm-provider)
 * 2. Agent Runtime (pai-k8s-agent)
 *
 * Run with:
 *   # Start mock server first in another terminal:
 *   bun run test/mock-llm-server.ts
 *
 *   # Then run this test:
 *   bun run test/integration-test.ts
 */

import { ModelRouter, OLLAMA_CONFIG } from 'pai-llm-provider';
import { AgentRuntime, SessionManager, ToolExecutor } from '../src';

const TEST_ENDPOINT = 'http://localhost:11434/v1';

async function testLLMProvider() {
  console.log('\n========================================');
  console.log('Phase 1: Testing LLM Provider');
  console.log('========================================\n');

  const router = new ModelRouter({
    ...OLLAMA_CONFIG,
    defaultEndpoint: TEST_ENDPOINT,
    models: {
      quick: { ...OLLAMA_CONFIG.models.quick, endpoint: TEST_ENDPOINT },
      standard: { ...OLLAMA_CONFIG.models.standard, endpoint: TEST_ENDPOINT },
      determined: { ...OLLAMA_CONFIG.models.determined, endpoint: TEST_ENDPOINT },
    },
  });

  // Test 1: Health check
  console.log('Test 1: Health Check');
  const healthy = await router.healthCheck();
  console.log(`  Result: ${healthy ? '✅ PASS' : '❌ FAIL'}`);
  if (!healthy) {
    console.error('  LLM server not available. Start mock server first:');
    console.error('  bun run test/mock-llm-server.ts');
    process.exit(1);
  }

  // Test 2: Simple completion
  console.log('\nTest 2: Simple Completion');
  try {
    const response = await router.complete({
      messages: [{ role: 'user', content: 'Hello!' }],
      effort: 'quick',
    });
    console.log(`  Response: "${response.choices[0].message.content}"`);
    console.log(`  Model: ${response.model}`);
    console.log(`  Result: ✅ PASS`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 3: Streaming completion
  console.log('\nTest 3: Streaming Completion');
  try {
    let content = '';
    process.stdout.write('  Response: "');
    for await (const chunk of router.stream({
      messages: [{ role: 'user', content: 'Say hello' }],
      effort: 'quick',
    })) {
      const text = chunk.choices[0]?.delta.content || '';
      content += text;
      process.stdout.write(text);
    }
    console.log('"');
    console.log(`  Result: ${content.length > 0 ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  return router;
}

async function testAgentRuntime(router: ModelRouter) {
  console.log('\n========================================');
  console.log('Phase 2: Testing Agent Runtime');
  console.log('========================================\n');

  const sessions = new SessionManager();
  const tools = new ToolExecutor();

  const runtime = new AgentRuntime({
    llm: router,
    sessionManager: sessions,
    toolExecutor: tools,
    config: {
      port: 8080,
      defaultEffort: 'quick',
      maxTurns: 5,
      systemPrompt: 'You are a helpful assistant for testing.',
    },
  });

  // Test 4: Session management
  console.log('Test 4: Session Management');
  try {
    const session = await sessions.create('Test system prompt');
    console.log(`  Session ID: ${session.id}`);
    await sessions.addMessage(session.id, { role: 'user', content: 'Test message' });
    const messages = await sessions.getMessages(session.id);
    console.log(`  Messages: ${messages.length}`);
    console.log(`  Result: ${messages.length === 2 ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 5: Tool executor - built-in tools
  console.log('\nTest 5: Tool Executor (Built-in)');
  try {
    const toolNames = tools.getToolNames();
    console.log(`  Available tools: ${toolNames.join(', ')}`);

    // Test list_files
    const result = await tools.execute('list_files', { path: '.' });
    console.log(`  list_files result: ${result.success ? 'success' : 'failed'}`);
    if (result.success && Array.isArray(result.result)) {
      console.log(`  Found ${(result.result as string[]).length} files`);
    }
    console.log(`  Result: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 6: Tool executor - bash
  console.log('\nTest 6: Tool Executor (Bash)');
  try {
    const result = await tools.execute('bash', { command: 'echo "Hello from test"' });
    console.log(`  bash result: ${result.success ? 'success' : 'failed'}`);
    if (result.success && typeof result.result === 'object') {
      const r = result.result as { stdout: string };
      console.log(`  stdout: ${r.stdout.trim()}`);
    }
    console.log(`  Result: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 7: Agent query (simple)
  console.log('\nTest 7: Agent Query (Simple)');
  try {
    const { response, sessionId } = await runtime.querySync('Hello!');
    console.log(`  Session: ${sessionId}`);
    console.log(`  Response: "${response.slice(0, 100)}${response.length > 100 ? '...' : ''}"`);
    console.log(`  Result: ${response.length > 0 ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 8: Agent query with tool use
  console.log('\nTest 8: Agent Query (With Tool Use)');
  try {
    let toolCallSeen = false;
    let toolResultSeen = false;
    let finalResponse = '';

    for await (const msg of runtime.query('List files in current directory')) {
      if (msg.type === 'tool_call') {
        console.log(`  Tool call: ${msg.toolCall?.name}(${JSON.stringify(msg.toolCall?.arguments)})`);
        toolCallSeen = true;
      }
      if (msg.type === 'tool_result') {
        console.log(`  Tool result received`);
        toolResultSeen = true;
      }
      if (msg.type === 'chunk' && msg.content) {
        finalResponse += msg.content;
      }
    }
    console.log(`  Final response: "${finalResponse.slice(0, 80)}..."`);
    console.log(`  Tool call seen: ${toolCallSeen ? '✅' : '❌'}`);
    console.log(`  Tool result seen: ${toolResultSeen ? '✅' : '❌'}`);
    console.log(`  Result: ${toolCallSeen && toolResultSeen ? '✅ PASS' : '⚠️ PARTIAL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }

  // Test 9: Session persistence
  console.log('\nTest 9: Session Persistence');
  try {
    const { sessionId } = await runtime.querySync('My name is TestUser');

    // Query again with same session
    const { response } = await runtime.querySync('What did I just tell you?', sessionId);

    const history = await runtime.getHistory(sessionId);
    console.log(`  Session history: ${history.length} messages`);
    console.log(`  Result: ${history.length >= 4 ? '✅ PASS' : '❌ FAIL'}`);
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error}`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  PAI Phase 1+2 Integration Test        ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    const router = await testLLMProvider();
    await testAgentRuntime(router);

    console.log('\n========================================');
    console.log('All tests completed!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\nTest suite failed:', error);
    process.exit(1);
  }
}

main();
