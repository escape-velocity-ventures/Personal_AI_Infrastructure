/**
 * PAI LLM Provider
 *
 * OpenAI-compatible LLM provider abstraction for PAI.
 * Supports vLLM, Ollama, and other OpenAI-compatible backends.
 *
 * @example
 * ```typescript
 * import { ModelRouter, DEFAULT_VLLM_CONFIG } from 'pai-llm-provider';
 *
 * const router = new ModelRouter(DEFAULT_VLLM_CONFIG);
 *
 * // Simple completion
 * const response = await router.complete({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   effort: 'quick',
 * });
 *
 * // Streaming completion
 * for await (const chunk of router.stream({
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   effort: 'standard',
 * })) {
 *   process.stdout.write(chunk.choices[0]?.delta.content ?? '');
 * }
 * ```
 */

// Types
export type {
  EffortLevel,
  ModelConfig,
  ProviderConfig,
  ChatMessage,
  ToolCall,
  Tool,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  LLMProvider,
} from './types';

// Client
export { OpenAICompatibleClient } from './openai-client';

// Router
export { ModelRouter, DEFAULT_VLLM_CONFIG, OLLAMA_CONFIG } from './model-router';

/**
 * Create a default LLM provider from environment variables
 *
 * Environment variables:
 * - VLLM_ENDPOINT or LLM_ENDPOINT: API endpoint URL
 * - VLLM_API_KEY or LLM_API_KEY: Optional API key
 * - USE_OLLAMA=true or LLM_PROVIDER=ollama: Use Ollama instead
 * - OLLAMA_ENDPOINT: Ollama endpoint (default: http://localhost:11434/v1)
 */
export function createProvider() {
  const { ModelRouter } = require('./model-router');
  return ModelRouter.fromEnv();
}
