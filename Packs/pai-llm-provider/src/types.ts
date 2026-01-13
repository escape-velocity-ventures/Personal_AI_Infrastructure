/**
 * PAI LLM Provider Types
 *
 * Defines interfaces for LLM provider abstraction supporting
 * OpenAI-compatible APIs (vLLM, Ollama, etc.)
 */

export type EffortLevel = 'quick' | 'standard' | 'determined';

export interface ModelConfig {
  /** Model identifier (e.g., "Qwen/Qwen2.5-72B-Instruct") */
  model: string;
  /** API endpoint URL */
  endpoint: string;
  /** Optional API key */
  apiKey?: string;
  /** Max tokens for this model tier */
  maxTokens?: number;
  /** Context window size */
  contextLength?: number;
}

export interface ProviderConfig {
  /** Default endpoint for all models */
  defaultEndpoint: string;
  /** Optional default API key */
  defaultApiKey?: string;
  /** Model mapping by effort level */
  models: {
    quick: ModelConfig;
    standard: ModelConfig;
    determined: ModelConfig;
  };
  /** Fallback provider config (e.g., cloud API) */
  fallback?: {
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Override effort level for this request */
  effort?: EffortLevel;
}

export interface CompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }[];
}

export interface LLMProvider {
  /** Complete a chat request */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /** Stream a chat completion */
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk, void, unknown>;

  /** Check if provider is available */
  healthCheck(): Promise<boolean>;

  /** Get current model config for effort level */
  getModelConfig(effort: EffortLevel): ModelConfig;
}
