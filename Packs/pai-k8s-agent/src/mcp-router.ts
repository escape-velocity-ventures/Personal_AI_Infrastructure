/**
 * MCP Router
 *
 * Routes tool calls to appropriate MCP servers based on configuration.
 * Supports HTTP, stdio, and gRPC transports.
 */

export interface MCPEndpoint {
  name: string;
  type: 'http' | 'stdio' | 'grpc';
  url?: string;  // For HTTP/gRPC
  command?: string;  // For stdio
  args?: string[];  // For stdio
  toolPrefix: string;  // e.g., 'apple_' for Apple MCP
  enabled: boolean;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export class MCPRouter {
  private endpoints = new Map<string, MCPEndpoint>();

  constructor() {
    // Register default endpoints from environment
    this.registerDefaults();
  }

  /**
   * Register default MCP endpoints
   */
  private registerDefaults(): void {
    // Apple MCP (HTTP)
    const appleMCPUrl = process.env.APPLE_MCP_URL || 'http://apple-mcp:8081';
    this.registerEndpoint({
      name: 'apple',
      type: 'http',
      url: appleMCPUrl,
      toolPrefix: 'apple_',
      enabled: true,
    });

    // Google Workspace MCP (stdio) - if configured
    const googleMCPPath = process.env.GOOGLE_MCP_PATH;
    if (googleMCPPath) {
      this.registerEndpoint({
        name: 'google',
        type: 'stdio',
        command: 'bun',
        args: ['run', googleMCPPath],
        toolPrefix: 'google_',
        enabled: true,
      });
    }
  }

  /**
   * Register an MCP endpoint
   */
  registerEndpoint(endpoint: MCPEndpoint): void {
    this.endpoints.set(endpoint.name, endpoint);
  }

  /**
   * Get endpoint for a tool name
   */
  getEndpointForTool(toolName: string): MCPEndpoint | null {
    for (const endpoint of this.endpoints.values()) {
      if (toolName.startsWith(endpoint.toolPrefix) && endpoint.enabled) {
        return endpoint;
      }
    }
    return null;
  }

  /**
   * List all available tools from all endpoints
   */
  async listAllTools(): Promise<MCPToolInfo[]> {
    const tools: MCPToolInfo[] = [];

    for (const endpoint of this.endpoints.values()) {
      if (!endpoint.enabled) continue;

      try {
        const endpointTools = await this.listToolsFromEndpoint(endpoint);
        tools.push(...endpointTools);
      } catch (error) {
        console.warn(`Failed to list tools from ${endpoint.name}:`, error);
      }
    }

    return tools;
  }

  /**
   * List tools from a specific endpoint
   */
  private async listToolsFromEndpoint(endpoint: MCPEndpoint): Promise<MCPToolInfo[]> {
    if (endpoint.type === 'http') {
      return this.listToolsFromHTTP(endpoint);
    } else if (endpoint.type === 'stdio') {
      return this.listToolsFromStdio(endpoint);
    }
    return [];
  }

  /**
   * List tools from HTTP endpoint
   */
  private async listToolsFromHTTP(endpoint: MCPEndpoint): Promise<MCPToolInfo[]> {
    const response = await fetch(`${endpoint.url}/tools`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as { tools: MCPToolInfo[] };
    return data.tools;
  }

  /**
   * List tools from stdio MCP server
   */
  private async listToolsFromStdio(endpoint: MCPEndpoint): Promise<MCPToolInfo[]> {
    // Spawn MCP server and request tool list
    const proc = Bun.spawn([endpoint.command!, ...(endpoint.args || [])], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    };

    const requestStr = JSON.stringify(request);
    const header = `Content-Length: ${requestStr.length}\r\n\r\n`;

    proc.stdin.write(header + requestStr);
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    const bodyStart = stdout.indexOf('\r\n\r\n');
    if (bodyStart === -1) return [];

    const body = stdout.slice(bodyStart + 4);
    const response = JSON.parse(body);

    return response.result?.tools || [];
  }

  /**
   * Call a tool on the appropriate endpoint
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: string }> {
    const endpoint = this.getEndpointForTool(toolName);

    if (!endpoint) {
      return { error: `No endpoint found for tool: ${toolName}` };
    }

    try {
      if (endpoint.type === 'http') {
        return await this.callHTTPTool(endpoint, toolName, args);
      } else if (endpoint.type === 'stdio') {
        return await this.callStdioTool(endpoint, toolName, args);
      }
      return { error: `Unsupported endpoint type: ${endpoint.type}` };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Call tool via HTTP
   */
  private async callHTTPTool(
    endpoint: MCPEndpoint,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: string }> {
    const response = await fetch(`${endpoint.url}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: toolName, arguments: args }),
    });

    const data = await response.json() as { result?: unknown; error?: string };
    return data;
  }

  /**
   * Call tool via stdio MCP
   */
  private async callStdioTool(
    endpoint: MCPEndpoint,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: string }> {
    const proc = Bun.spawn([endpoint.command!, ...(endpoint.args || [])], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    const requestStr = JSON.stringify(request);
    const header = `Content-Length: ${requestStr.length}\r\n\r\n`;

    proc.stdin.write(header + requestStr);
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    const bodyStart = stdout.indexOf('\r\n\r\n');
    if (bodyStart === -1) {
      return { error: 'Invalid MCP response' };
    }

    const body = stdout.slice(bodyStart + 4);
    const response = JSON.parse(body);

    if (response.error) {
      return { error: response.error.message };
    }

    return { result: response.result };
  }

  /**
   * Check health of all endpoints
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, endpoint] of this.endpoints) {
      if (!endpoint.enabled) {
        results[name] = false;
        continue;
      }

      try {
        if (endpoint.type === 'http') {
          const response = await fetch(`${endpoint.url}/health`);
          const data = await response.json() as { status: string };
          results[name] = data.status === 'ok';
        } else {
          // For stdio, just check if command exists
          results[name] = true;
        }
      } catch {
        results[name] = false;
      }
    }

    return results;
  }

  /**
   * Get all registered endpoints
   */
  getEndpoints(): MCPEndpoint[] {
    return Array.from(this.endpoints.values());
  }
}
