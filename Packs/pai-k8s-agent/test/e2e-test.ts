/**
 * PAI End-to-End Integration Test
 *
 * Tests the full stack:
 * - Mock LLM Server
 * - Agent Service (WebSocket + HTTP)
 * - Terminal Bridge (SSH)
 * - Apple MCP Service (HTTP)
 */

import { Client as SSHClient } from 'ssh2';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8080';
const APPLE_MCP_URL = process.env.APPLE_MCP_URL || 'http://localhost:8081';
const SSH_HOST = process.env.SSH_HOST || 'localhost';
const SSH_PORT = parseInt(process.env.SSH_PORT || '2222');

async function runTests(): Promise<void> {
  const results: TestResult[] = [];

  console.log('╭─────────────────────────────────────╮');
  console.log('│  PAI End-to-End Integration Tests   │');
  console.log('╰─────────────────────────────────────╯');
  console.log('');

  // Test 1: Agent Health
  results.push(await testAgentHealth());

  // Test 2: Agent Query (HTTP)
  results.push(await testAgentQuery());

  // Test 3: Apple MCP Health
  results.push(await testAppleMCPHealth());

  // Test 4: Apple MCP Tools
  results.push(await testAppleMCPTools());

  // Test 5: Apple MCP Call
  results.push(await testAppleMCPCall());

  // Test 6: Terminal Bridge SSH
  results.push(await testTerminalBridgeSSH());

  // Test 7: Full Flow (SSH -> Agent -> Apple MCP)
  results.push(await testFullFlow());

  // Print results
  console.log('\n─────────────────────────────────────');
  console.log('Results:\n');

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m ${result.name} (${result.duration}ms)`);
    if (!result.passed) {
      console.log(`  └─ ${result.message}`);
    }
    if (result.passed) passed++;
    else failed++;
  }

  console.log(`\n${passed}/${results.length} tests passed`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function testAgentHealth(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Agent Health Check';

  try {
    const response = await fetch(`${AGENT_URL}/health`);
    const data = await response.json() as { status: string };

    return {
      name,
      passed: data.status === 'ok' || data.status === 'degraded',
      message: `Status: ${data.status}`,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAgentQuery(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Agent HTTP Query';

  try {
    const response = await fetch(`${AGENT_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Say "test successful"',
        type: 'query',
      }),
    });

    const data = await response.json() as { response?: string; error?: string };

    return {
      name,
      passed: !data.error && !!data.response,
      message: data.error || 'Query successful',
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAppleMCPHealth(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Apple MCP Health Check';

  try {
    const response = await fetch(`${APPLE_MCP_URL}/health`);
    const data = await response.json() as { status: string };

    return {
      name,
      passed: data.status === 'ok',
      message: `Status: ${data.status}`,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAppleMCPTools(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Apple MCP List Tools';

  try {
    const response = await fetch(`${APPLE_MCP_URL}/tools`);
    const data = await response.json() as { tools: Array<{ name: string }> };

    const hasCalendar = data.tools.some((t) => t.name.includes('calendar'));
    const hasReminders = data.tools.some((t) => t.name.includes('reminders'));

    return {
      name,
      passed: hasCalendar && hasReminders,
      message: `Found ${data.tools.length} tools`,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAppleMCPCall(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Apple MCP Call Tool';

  try {
    const response = await fetch(`${APPLE_MCP_URL}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'apple_calendar_list',
        arguments: {},
      }),
    });

    const data = await response.json() as { result?: unknown; error?: string };

    return {
      name,
      passed: !data.error && Array.isArray(data.result),
      message: data.error || `Got ${(data.result as unknown[])?.length || 0} calendars`,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testTerminalBridgeSSH(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Terminal Bridge SSH Connection';

  return new Promise((resolve) => {
    const client = new SSHClient();
    const timeout = setTimeout(() => {
      client.end();
      resolve({
        name,
        passed: false,
        message: 'Connection timed out',
        duration: Date.now() - start,
      });
    }, 5000);

    client.on('ready', () => {
      clearTimeout(timeout);
      client.end();
      resolve({
        name,
        passed: true,
        message: 'SSH connection successful',
        duration: Date.now() - start,
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        name,
        passed: false,
        message: err.message,
        duration: Date.now() - start,
      });
    });

    client.connect({
      host: SSH_HOST,
      port: SSH_PORT,
      username: 'pai',
      password: 'any',
    });
  });
}

async function testFullFlow(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Full Flow (SSH -> Agent)';

  return new Promise((resolve) => {
    const client = new SSHClient();
    const timeout = setTimeout(() => {
      client.end();
      resolve({
        name,
        passed: false,
        message: 'Flow timed out',
        duration: Date.now() - start,
      });
    }, 15000);

    client.on('ready', () => {
      client.shell((err, stream) => {
        if (err) {
          clearTimeout(timeout);
          client.end();
          resolve({
            name,
            passed: false,
            message: err.message,
            duration: Date.now() - start,
          });
          return;
        }

        let output = '';
        let promptSent = false;

        stream.on('data', (data: Buffer) => {
          output += data.toString();

          // Wait for prompt, then send simple message
          if (!promptSent && output.includes('❯')) {
            promptSent = true;
            stream.write('Hi\n');
          }

          // Check for response (any response from agent)
          if (promptSent && (output.includes('Kai:') || output.includes('Hello') || output.includes('mock'))) {
            clearTimeout(timeout);
            stream.end();
            client.end();
            resolve({
              name,
              passed: true,
              message: 'Full flow completed successfully',
              duration: Date.now() - start,
            });
          }
        });

        stream.on('close', () => {
          clearTimeout(timeout);
          client.end();
          if (!output.includes('Kai:') && !output.includes('Hello') && !output.includes('mock')) {
            resolve({
              name,
              passed: false,
              message: 'No agent response received',
              duration: Date.now() - start,
            });
          }
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        name,
        passed: false,
        message: err.message,
        duration: Date.now() - start,
      });
    });

    client.connect({
      host: SSH_HOST,
      port: SSH_PORT,
      username: 'pai',
      password: 'any',
    });
  });
}

// Run tests
runTests().catch(console.error);
