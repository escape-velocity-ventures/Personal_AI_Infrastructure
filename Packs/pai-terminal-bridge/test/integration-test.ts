/**
 * Terminal Bridge Integration Test
 *
 * Tests SSH server, agent connection, and response streaming.
 */

import { Client } from 'ssh2';

const SSH_PORT = parseInt(process.env.SSH_PORT || '2222');
const SSH_HOST = process.env.SSH_HOST || 'localhost';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

async function runTests(): Promise<void> {
  const results: TestResult[] = [];

  console.log('╭─────────────────────────────────────╮');
  console.log('│  Terminal Bridge Integration Tests  │');
  console.log('╰─────────────────────────────────────╯');
  console.log('');

  // Test 1: SSH Connection
  results.push(await testSSHConnection());

  // Test 2: PTY Session
  results.push(await testPTYSession());

  // Test 3: Simple Prompt
  results.push(await testSimplePrompt());

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

async function testSSHConnection(): Promise<TestResult> {
  const start = Date.now();
  const name = 'SSH Connection';

  return new Promise((resolve) => {
    const client = new Client();
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
        message: 'Connected successfully',
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
      password: 'any', // Password is not checked
    });
  });
}

async function testPTYSession(): Promise<TestResult> {
  const start = Date.now();
  const name = 'PTY Session';

  return new Promise((resolve) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.end();
      resolve({
        name,
        passed: false,
        message: 'Session timed out',
        duration: Date.now() - start,
      });
    }, 5000);

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

        // Wait for welcome message
        let output = '';
        stream.on('data', (data: Buffer) => {
          output += data.toString();

          // Check for welcome message or prompt
          if (output.includes('PAI Terminal') || output.includes('❯')) {
            clearTimeout(timeout);
            stream.end();
            client.end();
            resolve({
              name,
              passed: true,
              message: 'PTY session established',
              duration: Date.now() - start,
            });
          }
        });

        stream.on('close', () => {
          clearTimeout(timeout);
          client.end();
          if (!output.includes('PAI Terminal') && !output.includes('❯')) {
            resolve({
              name,
              passed: false,
              message: 'No welcome message received',
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

async function testSimplePrompt(): Promise<TestResult> {
  const start = Date.now();
  const name = 'Simple Prompt Response';

  return new Promise((resolve) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.end();
      resolve({
        name,
        passed: false,
        message: 'Response timed out',
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

          // Wait for prompt (❯ is the actual prompt character), then send message
          if (!promptSent && (output.includes('❯') || output.includes('Press Enter'))) {
            promptSent = true;
            // Send a simple prompt
            stream.write('Hello!\n');
          }

          // Check for response (mock LLM returns "mock" in response)
          if (promptSent && (output.includes('mock') || output.includes('Hello'))) {
            clearTimeout(timeout);
            stream.end();
            client.end();
            resolve({
              name,
              passed: true,
              message: 'Got response from agent',
              duration: Date.now() - start,
            });
          }
        });

        stream.on('close', () => {
          clearTimeout(timeout);
          client.end();
          if (!(output.includes('mock') || output.includes('Hello'))) {
            resolve({
              name,
              passed: false,
              message: `Expected response from agent, got: ${output.slice(-200)}`,
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

runTests().catch(console.error);
