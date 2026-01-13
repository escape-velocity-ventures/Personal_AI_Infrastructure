/**
 * PAI State Service
 *
 * Distributed state management for PAI with Redis and PostgreSQL.
 *
 * @example
 * ```typescript
 * import { StateService } from 'pai-state-service';
 *
 * // Create from environment variables
 * const state = StateService.fromEnv();
 * await state.connect();
 *
 * // Create session
 * const session = await state.createSession('You are a helpful assistant.');
 *
 * // Add message
 * await state.addMessage(session.id, {
 *   role: 'user',
 *   content: 'Hello!',
 * });
 *
 * // Update realtime state
 * await state.setStatus('processing', 'Handling user query');
 *
 * // Log event
 * await state.logEvent('query_completed', { tokens: 150 }, session.id);
 *
 * // Clean up
 * await state.disconnect();
 * ```
 */

// Types
export type {
  StateConfig,
  SessionData,
  MessageData,
  ToolCallData,
  RealtimeState,
  StateEvent,
  MemoryEntry,
  MetricEntry,
} from './types';

// Clients
export { RedisStateClient } from './redis-client';
export { PostgresStateClient } from './postgres-client';

// Main service
export { StateService } from './state-service';
