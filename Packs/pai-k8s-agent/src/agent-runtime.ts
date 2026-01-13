/**
 * Agent Runtime
 *
 * Implements a ReAct-style agent loop:
 * 1. Receive user input
 * 2. Think (LLM generates response or tool calls)
 * 3. Act (execute tools if requested)
 * 4. Observe (add tool results to context)
 * 5. Repeat until done or max turns
 */

import type {
  ModelRouter,
  ChatMessage,
  CompletionRequest,
  EffortLevel,
  StreamChunk,
} from 'pai-llm-provider';
import { SessionManager } from './session-manager';
import { ToolExecutor } from './tool-executor';
import type { AgentConfig, AgentResponse } from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools.
When you need to perform actions, use the available tools.
Always explain what you're doing before using tools.
After using tools, summarize the results for the user.`;

export interface AgentRuntimeConfig {
  llm: ModelRouter;
  sessionManager: SessionManager;
  toolExecutor: ToolExecutor;
  config: AgentConfig;
}

export class AgentRuntime {
  private llm: ModelRouter;
  private sessions: SessionManager;
  private tools: ToolExecutor;
  private config: AgentConfig;

  constructor(options: AgentRuntimeConfig) {
    this.llm = options.llm;
    this.sessions = options.sessionManager;
    this.tools = options.toolExecutor;
    this.config = options.config;
  }

  /**
   * Process a user query with streaming responses
   */
  async *query(
    prompt: string,
    sessionId?: string,
    effort?: EffortLevel
  ): AsyncGenerator<AgentResponse, void, unknown> {
    // Get or create session
    const session = await this.sessions.getOrCreate(
      sessionId,
      this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT
    );

    yield {
      type: 'chunk',
      sessionId: session.id,
      content: '', // Session started
    };

    // Add user message
    await this.sessions.addMessage(session.id, {
      role: 'user',
      content: prompt,
    });

    // Run agent loop
    let turns = 0;
    const maxTurns = this.config.maxTurns || 10;

    while (turns < maxTurns) {
      turns++;

      // Get current messages
      const messages = await this.sessions.getMessages(session.id);

      // Prepare completion request
      const request: CompletionRequest = {
        messages,
        tools: await this.tools.getToolDefinitions(),
        tool_choice: 'auto',
        effort: effort || this.config.defaultEffort,
        stream: true,
      };

      // Stream LLM response
      let assistantContent = '';
      let toolCalls: ChatMessage['tool_calls'] = [];
      let finishReason: string | null = null;

      for await (const chunk of this.llm.stream(request)) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        // Accumulate content
        if (choice.delta.content) {
          assistantContent += choice.delta.content;
          yield {
            type: 'chunk',
            sessionId: session.id,
            content: choice.delta.content,
          };
        }

        // Accumulate tool calls
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            // Find or create tool call entry
            let existing = toolCalls?.find((t) => t.id === tc.id);
            if (!existing && tc.id) {
              existing = {
                id: tc.id,
                type: 'function',
                function: { name: '', arguments: '' },
              };
              toolCalls = toolCalls || [];
              toolCalls.push(existing);
            }
            if (existing) {
              if (tc.function.name) {
                existing.function.name += tc.function.name;
              }
              if (tc.function.arguments) {
                existing.function.arguments += tc.function.arguments;
              }
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // Add assistant message to session
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
      await this.sessions.addMessage(session.id, assistantMessage);

      // Check if we need to execute tools
      if (finishReason === 'tool_calls' && toolCalls && toolCalls.length > 0) {
        // Execute each tool call
        for (const tc of toolCalls) {
          yield {
            type: 'tool_call',
            sessionId: session.id,
            toolCall: {
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}'),
            },
          };

          // Execute the tool
          const result = await this.tools.execute(
            tc.function.name,
            JSON.parse(tc.function.arguments || '{}')
          );

          yield {
            type: 'tool_result',
            sessionId: session.id,
            toolResult: {
              id: tc.id,
              result: result.success ? result.result : { error: result.error },
            },
          };

          // Add tool result to session
          await this.sessions.addMessage(session.id, {
            role: 'tool',
            content: JSON.stringify(
              result.success ? result.result : { error: result.error }
            ),
            tool_call_id: tc.id,
          });
        }

        // Continue the loop to get LLM's response to tool results
        continue;
      }

      // No tool calls, we're done
      break;
    }

    yield {
      type: 'complete',
      sessionId: session.id,
    };
  }

  /**
   * Non-streaming query (for simpler use cases)
   */
  async querySync(
    prompt: string,
    sessionId?: string,
    effort?: EffortLevel
  ): Promise<{ response: string; sessionId: string }> {
    let response = '';
    let finalSessionId = '';

    for await (const msg of this.query(prompt, sessionId, effort)) {
      finalSessionId = msg.sessionId;
      if (msg.type === 'chunk' && msg.content) {
        response += msg.content;
      }
    }

    return { response, sessionId: finalSessionId };
  }

  /**
   * Get session history
   */
  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    return this.sessions.getMessages(sessionId);
  }

  /**
   * Clear a session
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.sessions.delete(sessionId);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.llm.healthCheck();
  }
}
