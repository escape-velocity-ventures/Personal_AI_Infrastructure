/**
 * Tool Executor
 *
 * Executes tools from various sources:
 * - Built-in tools (bash, file ops)
 * - Apple MCP tools (via HTTP)
 * - MCP servers (stdio, gRPC)
 * - Custom registered tools
 */

import type { Tool } from 'pai-llm-provider';
import type { ToolDefinition, MCPServerConfig } from './types';
import { AppleMCPClient } from './apple-mcp-client';

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Built-in tool implementations
 */
const BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  bash: {
    name: 'bash',
    description: 'Execute a bash command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' },
      },
      required: ['command'],
    },
    execute: async (args) => {
      const { command, timeout = 30000 } = args as {
        command: string;
        timeout?: number;
      };
      const proc = Bun.spawn(['bash', '-c', command], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Command timed out')), timeout)
      );

      try {
        const result = await Promise.race([proc.exited, timeoutPromise]);
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        return {
          exitCode: result,
          stdout,
          stderr,
        };
      } catch (error) {
        proc.kill();
        throw error;
      }
    },
  },

  read_file: {
    name: 'read_file',
    description: 'Read contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const { path } = args as { path: string };
      const file = Bun.file(path);
      if (!(await file.exists())) {
        throw new Error(`File not found: ${path}`);
      }
      return await file.text();
    },
  },

  write_file: {
    name: 'write_file',
    description: 'Write contents to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const { path, content } = args as { path: string; content: string };
      await Bun.write(path, content);
      return { success: true, path };
    },
  },

  list_files: {
    name: 'list_files',
    description: 'List files in a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
        pattern: { type: 'string', description: 'Glob pattern' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const { path, pattern } = args as { path: string; pattern?: string };
      const glob = new Bun.Glob(pattern || '*');
      const files: string[] = [];
      for await (const file of glob.scan({ cwd: path })) {
        files.push(file);
      }
      return files;
    },
  },
};

export class ToolExecutor {
  private tools = new Map<string, ToolDefinition>();
  private mcpServers = new Map<string, MCPServerConfig>();
  private appleMCPClient: AppleMCPClient;
  private appleMCPEnabled = false;

  constructor() {
    // Register built-in tools
    for (const [name, tool] of Object.entries(BUILTIN_TOOLS)) {
      this.tools.set(name, tool);
    }

    // Initialize Apple MCP client
    this.appleMCPClient = new AppleMCPClient();

    // Check if Apple MCP is available
    this.initAppleMCP();
  }

  /**
   * Initialize Apple MCP connection
   */
  private async initAppleMCP(): Promise<void> {
    try {
      const healthy = await this.appleMCPClient.healthCheck();
      if (healthy) {
        this.appleMCPEnabled = true;
        console.log('Apple MCP service connected');
      }
    } catch {
      console.log('Apple MCP service not available');
    }
  }

  /**
   * Register a custom tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register an MCP server
   */
  registerMCPServer(config: MCPServerConfig): void {
    this.mcpServers.set(config.name, config);
  }

  /**
   * Get all available tools as LLM tool definitions
   */
  async getToolDefinitions(filter?: string[]): Promise<Tool[]> {
    const definitions: Tool[] = [];

    // Add built-in tools
    for (const [name, tool] of this.tools) {
      if (filter && !filter.includes(name)) continue;

      definitions.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      });
    }

    // Add Apple MCP tools if available
    if (this.appleMCPEnabled || await this.appleMCPClient.healthCheck()) {
      this.appleMCPEnabled = true;
      try {
        const appleTools = await this.appleMCPClient.listTools();
        for (const tool of appleTools) {
          if (filter && !filter.includes(tool.name)) continue;

          definitions.push({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: { type: 'object', properties: {}, required: [] },
            },
          });
        }
      } catch {
        // Apple MCP not available, skip
      }
    }

    return definitions;
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // Check for Apple MCP tools (apple_*)
    if (name.startsWith('apple_')) {
      return this.executeAppleMCPTool(name, args);
    }

    // Check for MCP-prefixed tools (mcp__servername__toolname)
    if (name.startsWith('mcp__')) {
      return this.executeMCPTool(name, args);
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      const result = await tool.execute(args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute an Apple MCP tool via HTTP
   */
  private async executeAppleMCPTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.appleMCPEnabled) {
      // Try to connect
      await this.initAppleMCP();
      if (!this.appleMCPEnabled) {
        return {
          success: false,
          error: 'Apple MCP service not available. Make sure it is running on a Mac Mini node.',
        };
      }
    }

    try {
      const result = await this.appleMCPClient.callTool(name, args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute an MCP tool
   */
  private async executeMCPTool(
    fullName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // Parse mcp__servername__toolname
    const parts = fullName.split('__');
    if (parts.length !== 3) {
      return {
        success: false,
        error: `Invalid MCP tool name format: ${fullName}`,
      };
    }

    const [, serverName, toolName] = parts;
    const server = this.mcpServers.get(serverName);

    if (!server) {
      return {
        success: false,
        error: `Unknown MCP server: ${serverName}`,
      };
    }

    try {
      // For now, only support stdio MCP servers
      if (server.type === 'stdio') {
        return await this.executeStdioMCPTool(server, toolName, args);
      } else if (server.type === 'grpc') {
        return await this.executeGrpcMCPTool(server, toolName, args);
      } else {
        return {
          success: false,
          error: `Unsupported MCP server type: ${server.type}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute a tool via stdio MCP server
   */
  private async executeStdioMCPTool(
    server: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // Spawn MCP server process
    const proc = Bun.spawn([server.command!, ...(server.args || [])], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Send JSON-RPC request
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const requestStr = JSON.stringify(request);
    const header = `Content-Length: ${requestStr.length}\r\n\r\n`;

    proc.stdin.write(header + requestStr);
    proc.stdin.end();

    // Read response
    const stdout = await new Response(proc.stdout).text();

    // Parse JSON-RPC response (skip Content-Length header)
    const bodyStart = stdout.indexOf('\r\n\r\n');
    if (bodyStart === -1) {
      return { success: false, error: 'Invalid MCP response format' };
    }

    const body = stdout.slice(bodyStart + 4);
    const response = JSON.parse(body);

    if (response.error) {
      return { success: false, error: response.error.message };
    }

    return { success: true, result: response.result };
  }

  /**
   * Execute a tool via gRPC MCP server (for Apple MCP)
   */
  private async executeGrpcMCPTool(
    server: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    // TODO: Implement gRPC client for Apple MCP
    // This will call apple-mcp.default.svc.cluster.local:50051
    return {
      success: false,
      error: 'gRPC MCP not yet implemented',
    };
  }
}
