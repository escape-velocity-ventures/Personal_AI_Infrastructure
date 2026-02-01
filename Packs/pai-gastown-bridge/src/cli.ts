#!/usr/bin/env bun
/**
 * pai-gastown-bridge CLI
 *
 * Usage:
 *   bun run cli.ts detect              # Show current Gas Town context
 *   bun run cli.ts check <feature>     # Check if feature should run
 *   bun run cli.ts matrix              # Show feature matrix for current role
 *   bun run cli.ts matrix --all        # Show full matrix for all roles
 */

import { parseArgs } from 'util';
import { detectGasTown } from './detect';
import { shouldRun, getContext } from './should-run';
import { getRoleConfig, ALL_FEATURES, ALL_ROLES, DEFAULT_MATRIX } from './matrix';
import type { PAIFeature, GasTownRole } from './types';

function printHelp(): void {
  console.log(`
pai-gastown-bridge - Gas Town / PAI Integration

USAGE:
  bun run cli.ts <command> [options]

COMMANDS:
  detect              Show current Gas Town context
  check <feature>     Check if a PAI feature should run
  matrix              Show feature matrix for current role
  matrix --all        Show full matrix for all roles

FEATURES:
  identity, voice, memory-sync, security, infra-routing,
  observability, telos, session, tab-titles

ENVIRONMENT VARIABLES:
  PAI_GT_FORCE_ENABLE=feature1,feature2   Force enable features
  PAI_GT_FORCE_DISABLE=feature1,feature2  Force disable features

EXAMPLES:
  bun run cli.ts detect
  bun run cli.ts check identity
  bun run cli.ts check voice
  bun run cli.ts matrix
  bun run cli.ts matrix --all
`);
}

function cmdDetect(): void {
  const ctx = detectGasTown();

  console.log('\n🔍 Gas Town Context Detection\n');

  if (!ctx.isGasTown) {
    console.log('  Status: Not in Gas Town directory');
    console.log(`  CWD:    ${process.cwd()}`);
    console.log('\n  PAI will use default (full) configuration.\n');
    return;
  }

  console.log('  Status:  In Gas Town ✓');
  console.log(`  Role:    ${ctx.role || '(none detected)'}`);
  console.log(`  Rig:     ${ctx.rig || '(top-level)'}`);
  if (ctx.member) {
    console.log(`  Member:  ${ctx.member}`);
  }
  console.log(`  GT Root: ${ctx.gasTownRoot}`);
  if (ctx.rigRoot) {
    console.log(`  Rig Root: ${ctx.rigRoot}`);
  }
  console.log();
}

function cmdCheck(feature: string): void {
  if (!ALL_FEATURES.includes(feature as PAIFeature)) {
    console.error(`Error: Unknown feature "${feature}"`);
    console.error(`Valid features: ${ALL_FEATURES.join(', ')}`);
    process.exit(1);
  }

  const result = shouldRun({ feature: feature as PAIFeature });

  console.log('\n🔍 Feature Check\n');
  console.log(`  Feature:    ${feature}`);
  console.log(`  Should Run: ${result.shouldRun ? '✓ Yes' : '✗ No'}`);
  console.log(`  Reason:     ${result.reason}`);

  if (result.context.isGasTown) {
    console.log(`  GT Role:    ${result.context.role || '(none)'}`);
    console.log(`  GT Rig:     ${result.context.rig || '(top-level)'}`);
  } else {
    console.log('  Context:    Not in Gas Town');
  }
  console.log();

  // Exit with appropriate code for scripting
  process.exit(result.shouldRun ? 0 : 1);
}

function cmdMatrix(showAll: boolean): void {
  console.log('\n📊 PAI Feature Matrix\n');

  if (showAll) {
    // Show full matrix for all roles
    const header = ['Feature', ...ALL_ROLES, 'Default'];
    const rows: string[][] = [];

    for (const feature of ALL_FEATURES) {
      const row = [feature];
      for (const role of ALL_ROLES) {
        const state = DEFAULT_MATRIX.roles[role][feature];
        row.push(formatState(state));
      }
      row.push(formatState(DEFAULT_MATRIX.default[feature]));
      rows.push(row);
    }

    printTable(header, rows);
  } else {
    // Show matrix for current role
    const ctx = getContext();
    const role = ctx.role;
    const config = getRoleConfig(role);

    if (ctx.isGasTown && role) {
      console.log(`  Current Role: ${role}`);
    } else if (ctx.isGasTown) {
      console.log('  Current Role: (none detected, using default)');
    } else {
      console.log('  Context: Not in Gas Town (using default)');
    }
    console.log();

    const rows: string[][] = [];
    for (const feature of ALL_FEATURES) {
      const result = shouldRun({ feature });
      rows.push([
        feature,
        formatState(config[feature]),
        result.shouldRun ? '✓' : '✗',
        result.reason,
      ]);
    }

    printTable(['Feature', 'Matrix', 'Run?', 'Reason'], rows);
  }
  console.log();
}

function formatState(state: string): string {
  switch (state) {
    case 'enabled':
      return '✓';
    case 'disabled':
      return '✗';
    case 'minimal':
      return '~';
    default:
      return state;
  }
}

function printTable(header: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = header.map((h, i) => {
    const colValues = [h, ...rows.map((r) => r[i] || '')];
    return Math.max(...colValues.map((v) => v.length));
  });

  // Print header
  const headerLine = header.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(`  ${headerLine}`);
  console.log(`  ${widths.map((w) => '─'.repeat(w)).join('──')}`);

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  ');
    console.log(`  ${line}`);
  }
}

// Main
function main(): void {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      all: { type: 'boolean', short: 'a' },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = positionals[0];

  switch (command) {
    case 'detect':
      cmdDetect();
      break;
    case 'check':
      if (!positionals[1]) {
        console.error('Error: check requires a feature name');
        console.error(`Usage: bun run cli.ts check <feature>`);
        process.exit(1);
      }
      cmdCheck(positionals[1]);
      break;
    case 'matrix':
      cmdMatrix(values.all === true);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main();
