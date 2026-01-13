/**
 * Terminal Renderer
 *
 * Formats agent responses for terminal display.
 * Handles streaming text, tool calls, and status updates.
 */

import type { AgentMessage } from './types';

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

export class TerminalRenderer {
  private isStreaming = false;
  private lineBuffer = '';

  /**
   * Format agent message for terminal display
   */
  render(msg: AgentMessage): string {
    switch (msg.type) {
      case 'chunk':
        return this.renderChunk(msg.content || '');

      case 'tool_call':
        return this.renderToolCall(msg.toolCall!);

      case 'tool_result':
        return this.renderToolResult(msg.toolResult!);

      case 'complete':
        return this.renderComplete();

      case 'error':
        return this.renderError(msg.error || 'Unknown error');

      default:
        return '';
    }
  }

  /**
   * Render streaming text chunk
   */
  private renderChunk(content: string): string {
    if (!this.isStreaming && content) {
      this.isStreaming = true;
      return `\n${COLORS.cyan}Aurelia:${COLORS.reset} ${content}`;
    }
    return content;
  }

  /**
   * Render tool call
   */
  private renderToolCall(toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): string {
    this.endStreaming();

    const args = Object.entries(toolCall.arguments)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    return `\n${COLORS.yellow}⚙ ${COLORS.bold}${toolCall.name}${COLORS.reset}${COLORS.dim}(${args})${COLORS.reset}\n`;
  }

  /**
   * Render tool result
   */
  private renderToolResult(toolResult: { id: string; result: unknown }): string {
    const result = toolResult.result;
    let output = '';

    if (typeof result === 'string') {
      output = result.length > 200 ? result.slice(0, 200) + '...' : result;
    } else if (Array.isArray(result)) {
      output = `[${result.length} items]`;
    } else if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      if ('error' in obj) {
        return `${COLORS.red}✗ Error: ${obj.error}${COLORS.reset}\n`;
      }
      if ('stdout' in obj) {
        output = String(obj.stdout).trim();
        if (output.length > 200) {
          output = output.slice(0, 200) + '...';
        }
      } else {
        output = JSON.stringify(result).slice(0, 100);
      }
    } else {
      output = String(result);
    }

    return `${COLORS.dim}→ ${output}${COLORS.reset}\n`;
  }

  /**
   * Render completion
   */
  private renderComplete(): string {
    this.endStreaming();
    return `\n${COLORS.green}✓${COLORS.reset}\n`;
  }

  /**
   * Render error
   */
  private renderError(error: string): string {
    this.endStreaming();
    return `\n${COLORS.red}✗ Error: ${error}${COLORS.reset}\n`;
  }

  /**
   * End streaming mode
   */
  private endStreaming(): void {
    if (this.isStreaming) {
      this.isStreaming = false;
      this.lineBuffer = '';
    }
  }

  /**
   * Get prompt string
   */
  getPrompt(): string {
    return `${COLORS.green}❯${COLORS.reset} `;
  }

  /**
   * Get welcome message
   */
  getWelcome(sessionId?: string): string {
    const lines = [
      '',
      `${COLORS.cyan}${COLORS.bold}╭─────────────────────────────────────╮${COLORS.reset}`,
      `${COLORS.cyan}${COLORS.bold}│${COLORS.reset}  ${COLORS.bold}PAI Terminal Bridge${COLORS.reset}               ${COLORS.cyan}${COLORS.bold}│${COLORS.reset}`,
      `${COLORS.cyan}${COLORS.bold}│${COLORS.reset}  ${COLORS.dim}Connected to Aurelia${COLORS.reset}                   ${COLORS.cyan}${COLORS.bold}│${COLORS.reset}`,
      `${COLORS.cyan}${COLORS.bold}╰─────────────────────────────────────╯${COLORS.reset}`,
      '',
    ];

    if (sessionId) {
      lines.push(`${COLORS.dim}Session: ${sessionId.slice(0, 8)}...${COLORS.reset}`);
    }

    lines.push(`${COLORS.dim}Type your message and press Enter. Ctrl+C to exit.${COLORS.reset}`);
    lines.push('');

    return lines.join('\r\n');
  }

  /**
   * Get disconnected message
   */
  getDisconnected(): string {
    return `\n${COLORS.red}Disconnected from PAI Agent. Reconnecting...${COLORS.reset}\n`;
  }

  /**
   * Get reconnected message
   */
  getReconnected(): string {
    return `\n${COLORS.green}Reconnected to PAI Agent.${COLORS.reset}\n`;
  }

  /**
   * Clear screen
   */
  getClearScreen(): string {
    return '\x1b[2J\x1b[H';
  }
}
