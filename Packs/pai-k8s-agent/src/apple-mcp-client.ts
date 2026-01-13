/**
 * Apple MCP Client
 *
 * Client for calling Apple ecosystem tools via HTTP.
 * Connects to the apple-mcp service running on Mac Mini nodes.
 */

export interface AppleMCPTool {
  name: string;
  description: string;
}

export interface AppleMCPCallResult {
  result?: unknown;
  error?: string;
}

export class AppleMCPClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Default to K8s service URL or localhost for development
    this.baseUrl = baseUrl || process.env.APPLE_MCP_URL || 'http://apple-mcp:8081';
  }

  /**
   * Check if the Apple MCP service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json() as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * List all available Apple MCP tools
   */
  async listTools(): Promise<AppleMCPTool[]> {
    const response = await fetch(`${this.baseUrl}/tools`);

    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.statusText}`);
    }

    const data = await response.json() as { tools: AppleMCPTool[] };
    return data.tools;
  }

  /**
   * Call an Apple MCP tool
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, arguments: args }),
    });

    const data = await response.json() as AppleMCPCallResult;

    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  }

  /**
   * Convenience methods for common operations
   */

  // Calendar
  async getCalendarEvents(startDate: Date, endDate: Date, calendar?: string): Promise<unknown> {
    return this.callTool('apple_calendar_events', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      calendar,
    });
  }

  async getTodayEvents(calendar?: string): Promise<unknown> {
    return this.callTool('apple_calendar_today', { calendar });
  }

  async createCalendarEvent(params: {
    title: string;
    startDate: Date;
    endDate: Date;
    calendar?: string;
    location?: string;
    notes?: string;
    isAllDay?: boolean;
  }): Promise<unknown> {
    return this.callTool('apple_calendar_create', {
      ...params,
      startDate: params.startDate.toISOString(),
      endDate: params.endDate.toISOString(),
    });
  }

  // Reminders
  async getReminders(listName?: string, includeCompleted?: boolean): Promise<unknown> {
    return this.callTool('apple_reminders_all', { listName, includeCompleted });
  }

  async getTodayReminders(): Promise<unknown> {
    return this.callTool('apple_reminders_today', {});
  }

  async createReminder(params: {
    name: string;
    listName?: string;
    body?: string;
    dueDate?: Date;
    priority?: number;
  }): Promise<unknown> {
    return this.callTool('apple_reminders_create', {
      ...params,
      dueDate: params.dueDate?.toISOString(),
    });
  }

  async completeReminder(name: string): Promise<unknown> {
    return this.callTool('apple_reminders_complete', { name });
  }

  // Contacts
  async searchContacts(query: string): Promise<unknown> {
    return this.callTool('apple_contacts_search', { query });
  }

  async getContact(name: string): Promise<unknown> {
    return this.callTool('apple_contacts_get', { name });
  }

  // Notes
  async getNotes(folderName?: string, limit?: number): Promise<unknown> {
    return this.callTool('apple_notes_list', { folderName, limit });
  }

  async getNote(name: string): Promise<unknown> {
    return this.callTool('apple_notes_get', { name });
  }

  async searchNotes(query: string, limit?: number): Promise<unknown> {
    return this.callTool('apple_notes_search', { query, limit });
  }

  async createNote(params: { name: string; body: string; folderName?: string }): Promise<unknown> {
    return this.callTool('apple_notes_create', params);
  }
}

// Singleton instance for convenience
let defaultClient: AppleMCPClient | null = null;

export function getAppleMCPClient(): AppleMCPClient {
  if (!defaultClient) {
    defaultClient = new AppleMCPClient();
  }
  return defaultClient;
}
