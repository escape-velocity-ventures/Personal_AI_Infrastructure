/**
 * Model Router
 *
 * Routes requests to appropriate models based on effort level.
 * Supports fallback to cloud providers if local inference fails.
 */

import { OpenAICompatibleClient } from './openai-client';
import type {
  EffortLevel,
  ProviderConfig,
  ModelConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  LLMProvider,
} from './types';

/**
 * Default configuration for vLLM deployment
 */
export const DEFAULT_VLLM_CONFIG: ProviderConfig = {
  defaultEndpoint: 'http://vllm-service:8000/v1',
  models: {
    quick: {
      model: 'Qwen/Qwen2.5-7B-Instruct',
      endpoint: 'http://vllm-service:8000/v1',
      maxTokens: 2048,
      contextLength: 32768,
    },
    standard: {
      model: 'Qwen/Qwen2.5-32B-Instruct',
      endpoint: 'http://vllm-service:8000/v1',
      maxTokens: 4096,
      contextLength: 32768,
    },
    determined: {
      model: 'Qwen/Qwen2.5-72B-Instruct',
      endpoint: 'http://vllm-service:8000/v1',
      maxTokens: 8192,
      contextLength: 65536,
    },
  },
};

/**
 * Alternative config for Ollama (local development)
 */
export const OLLAMA_CONFIG: ProviderConfig = {
  defaultEndpoint: 'http://localhost:11434/v1',
  models: {
    quick: {
      model: 'qwen2.5:7b',
      endpoint: 'http://localhost:11434/v1',
      maxTokens: 2048,
      contextLength: 32768,
    },
    standard: {
      model: 'qwen2.5:32b',
      endpoint: 'http://localhost:11434/v1',
      maxTokens: 4096,
      contextLength: 32768,
    },
    determined: {
      model: 'qwen2.5:72b',
      endpoint: 'http://localhost:11434/v1',
      maxTokens: 8192,
      contextLength: 65536,
    },
  },
};

export class ModelRouter implements LLMProvider {
  private config: ProviderConfig;
  private clients: Map<EffortLevel, OpenAICompatibleClient>;
  private fallbackClient?: OpenAICompatibleClient;
  private currentEffort: EffortLevel = 'standard';

  constructor(config: ProviderConfig = DEFAULT_VLLM_CONFIG) {
    this.config = config;
    this.clients = new Map();

    // Initialize clients for each effort level
    for (const effort of ['quick', 'standard', 'determined'] as EffortLevel[]) {
      const modelConfig = config.models[effort];
      this.clients.set(effort, new OpenAICompatibleClient(modelConfig));
    }

    // Initialize fallback client if configured
    if (config.fallback) {
      this.fallbackClient = new OpenAICompatibleClient({
        model: config.fallback.model,
        endpoint: config.fallback.endpoint,
        apiKey: config.fallback.apiKey,
      });
    }
  }

  /**
   * Set the default effort level for requests
   */
  setEffort(effort: EffortLevel): void {
    this.currentEffort = effort;
  }

  /**
   * Get the current effort level
   */
  getEffort(): EffortLevel {
    return this.currentEffort;
  }

  /**
   * Get model config for an effort level
   */
  getModelConfig(effort: EffortLevel): ModelConfig {
    return this.config.models[effort];
  }

  /**
   * Complete a chat request, routing to appropriate model
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const effort = request.effort ?? this.currentEffort;
    const client = this.clients.get(effort)!;

    try {
      return await client.complete(request);
    } catch (error) {
      // Try fallback if available
      if (this.fallbackClient) {
        console.warn(
          `Primary model failed for effort=${effort}, falling back to cloud provider`,
          error
        );
        return await this.fallbackClient.complete(request);
      }
      throw error;
    }
  }

  /**
   * Stream a chat completion
   */
  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const effort = request.effort ?? this.currentEffort;
    const client = this.clients.get(effort)!;

    try {
      yield* client.stream(request);
    } catch (error) {
      // Try fallback if available
      if (this.fallbackClient) {
        console.warn(
          `Primary model failed for effort=${effort}, falling back to cloud provider`,
          error
        );
        yield* this.fallbackClient.stream(request);
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if the provider is healthy
   */
  async healthCheck(): Promise<boolean> {
    // Check at least one model is available
    for (const [effort, client] of this.clients) {
      const healthy = await client.healthCheck();
      if (healthy) {
        console.log(`Health check passed for effort=${effort}`);
        return true;
      }
    }

    // Check fallback
    if (this.fallbackClient) {
      const fallbackHealthy = await this.fallbackClient.healthCheck();
      if (fallbackHealthy) {
        console.log('Health check passed for fallback provider');
        return true;
      }
    }

    return false;
  }

  /**
   * Check health of all configured models
   */
  async healthCheckAll(): Promise<Record<EffortLevel | 'fallback', boolean>> {
    const results: Record<string, boolean> = {};

    for (const [effort, client] of this.clients) {
      results[effort] = await client.healthCheck();
    }

    if (this.fallbackClient) {
      results.fallback = await this.fallbackClient.healthCheck();
    }

    return results as Record<EffortLevel | 'fallback', boolean>;
  }

  /**
   * Create a router from environment variables
   */
  static fromEnv(): ModelRouter {
    const endpoint = process.env.VLLM_ENDPOINT || process.env.LLM_ENDPOINT;
    const apiKey = process.env.VLLM_API_KEY || process.env.LLM_API_KEY;

    // Check for Ollama
    if (process.env.USE_OLLAMA === 'true' || process.env.LLM_PROVIDER === 'ollama') {
      const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/v1';
      return new ModelRouter({
        ...OLLAMA_CONFIG,
        defaultEndpoint: ollamaEndpoint,
        models: {
          quick: { ...OLLAMA_CONFIG.models.quick, endpoint: ollamaEndpoint },
          standard: { ...OLLAMA_CONFIG.models.standard, endpoint: ollamaEndpoint },
          determined: { ...OLLAMA_CONFIG.models.determined, endpoint: ollamaEndpoint },
        },
      });
    }

    // Default to vLLM config
    if (endpoint) {
      return new ModelRouter({
        ...DEFAULT_VLLM_CONFIG,
        defaultEndpoint: endpoint,
        defaultApiKey: apiKey,
        models: {
          quick: { ...DEFAULT_VLLM_CONFIG.models.quick, endpoint, apiKey },
          standard: { ...DEFAULT_VLLM_CONFIG.models.standard, endpoint, apiKey },
          determined: { ...DEFAULT_VLLM_CONFIG.models.determined, endpoint, apiKey },
        },
      });
    }

    return new ModelRouter(DEFAULT_VLLM_CONFIG);
  }
}
