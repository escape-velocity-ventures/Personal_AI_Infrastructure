/**
 * OpenAI-Compatible Client
 *
 * Wraps the OpenAI SDK to work with any OpenAI-compatible endpoint
 * including vLLM, Ollama, LM Studio, etc.
 */

import OpenAI from 'openai';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ModelConfig,
} from './types';

export class OpenAICompatibleClient {
  private client: OpenAI;
  private modelConfig: ModelConfig;

  constructor(config: ModelConfig) {
    this.modelConfig = config;
    this.client = new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.apiKey || 'not-needed', // vLLM doesn't require API key
    });
  }

  /**
   * Send a completion request
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: this.modelConfig.model,
      messages: request.messages.map(this.toOpenAIMessage),
      tools: request.tools,
      tool_choice: request.tool_choice,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.modelConfig.maxTokens ?? 4096,
      stream: false,
    });

    return {
      id: response.id,
      model: response.model,
      choices: response.choices.map((choice) => ({
        index: choice.index,
        message: this.fromOpenAIMessage(choice.message),
        finish_reason: choice.finish_reason as CompletionResponse['choices'][0]['finish_reason'],
      })),
      usage: response.usage
        ? {
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Stream a completion request
   */
  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const stream = await this.client.chat.completions.create({
      model: this.modelConfig.model,
      messages: request.messages.map(this.toOpenAIMessage),
      tools: request.tools,
      tool_choice: request.tool_choice,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.modelConfig.maxTokens ?? 4096,
      stream: true,
    });

    for await (const chunk of stream) {
      yield {
        id: chunk.id,
        model: chunk.model,
        choices: chunk.choices.map((choice) => ({
          index: choice.index,
          delta: {
            role: choice.delta.role as ChatMessage['role'] | undefined,
            content: choice.delta.content ?? undefined,
            tool_calls: choice.delta.tool_calls?.map((tc) => ({
              id: tc.id ?? '',
              type: 'function' as const,
              function: {
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              },
            })),
          },
          finish_reason: choice.finish_reason as StreamChunk['choices'][0]['finish_reason'],
        })),
      };
    }
  }

  /**
   * Check if the endpoint is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to list models - most OpenAI-compatible APIs support this
      await this.client.models.list();
      return true;
    } catch {
      // Fallback: try a minimal completion
      try {
        await this.client.chat.completions.create({
          model: this.modelConfig.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get the current model configuration
   */
  getConfig(): ModelConfig {
    return this.modelConfig;
  }

  /**
   * Update the model configuration (e.g., switch models)
   */
  updateConfig(config: Partial<ModelConfig>): void {
    this.modelConfig = { ...this.modelConfig, ...config };
    if (config.endpoint || config.apiKey) {
      this.client = new OpenAI({
        baseURL: this.modelConfig.endpoint,
        apiKey: this.modelConfig.apiKey || 'not-needed',
      });
    }
  }

  private toOpenAIMessage(msg: ChatMessage): OpenAI.ChatCompletionMessageParam {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id ?? '',
      };
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
    }

    return {
      role: msg.role,
      content: msg.content,
    } as OpenAI.ChatCompletionMessageParam;
  }

  private fromOpenAIMessage(msg: OpenAI.ChatCompletionMessage): ChatMessage {
    return {
      role: msg.role as ChatMessage['role'],
      content: msg.content ?? '',
      tool_calls: msg.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };
  }
}
