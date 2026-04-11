/**
 * scheduler.ts — Scheduled message consumer for Harmony outbound_messages
 *
 * Processes queued messages from Supabase outbound_messages table:
 * 1. Queries messages where status='queued' and scheduled_at <= now
 * 2. Resolves channel config to determine platform
 * 3. Creates backend via factory, authenticates, publishes
 * 4. Updates message status to 'sent' or 'failed'
 *
 * Designed to be called from CLI (tier-cli schedule consume) or CronJob.
 */

import type { SocialBackend, SocialPost, SocialResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Row shape from outbound_messages table */
export interface OutboundMessage {
  id: string;
  business_id: string;
  channel_id: string;
  route_id: string | null;
  content: {
    title?: string;
    body?: string;
    text?: string;
    media?: Array<{ url: string; alt?: string; type?: string }>;
    link?: string;
    hashtags?: string[];
    thread?: string[];
    carousel?: Array<{ url: string; alt?: string; type?: string }>;
  };
  status: string;
  external_id: string | null;
  error_message: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape from outbound_channels table */
export interface OutboundChannel {
  id: string;
  business_id: string;
  name: string;
  channel_type: string;
  platform: string;
  config: Record<string, unknown>;
  credentials_ref: string | null;
  is_active: boolean;
}

/** Result of processing a single message */
export interface ProcessResult {
  messageId: string;
  platform: string;
  status: "sent" | "failed";
  externalId?: string;
  error?: string;
}

/** Options for the scheduler */
export interface SchedulerOptions {
  /** Maximum number of messages to process per run */
  batchSize?: number;
  /** If true, log progress to console */
  verbose?: boolean;
}

/** Supabase client interface — minimal surface needed by the scheduler */
export interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
}

/** Minimal query builder interface matching Supabase JS client */
export interface SupabaseQueryBuilder {
  select(columns?: string): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  lte(column: string, value: string): SupabaseQueryBuilder;
  update(data: Record<string, unknown>): SupabaseQueryBuilder;
  single(): SupabaseQueryBuilder;
  limit(count: number): SupabaseQueryBuilder;
  order(column: string, opts?: { ascending?: boolean }): SupabaseQueryBuilder;
  then<T>(
    onfulfilled: (value: { data: unknown; error: unknown }) => T
  ): Promise<T>;
}

/** Factory function type for creating social backends */
export type BackendFactory = (platform: string) => Promise<SocialBackend>;

// ============================================================================
// Default backend factory — uses the index.ts createBackend
// ============================================================================

let _defaultFactory: BackendFactory | null = null;

async function getDefaultFactory(): Promise<BackendFactory> {
  if (!_defaultFactory) {
    const { createBackend } = await import("./index.js");
    _defaultFactory = createBackend;
  }
  return _defaultFactory;
}

// ============================================================================
// Message → SocialPost conversion
// ============================================================================

function messageToPost(msg: OutboundMessage): SocialPost {
  const content = msg.content;
  return {
    text: content.text ?? content.body ?? content.title ?? "",
    media: content.media?.map((m) => ({
      url: m.url,
      alt: m.alt,
      type: m.type as "image" | "video" | "reel" | undefined,
    })),
    link: content.link,
    hashtags: content.hashtags,
    thread: content.thread,
    carousel: content.carousel?.map((m) => ({
      url: m.url,
      alt: m.alt,
      type: m.type as "image" | "video" | "reel" | undefined,
    })),
  };
}

// ============================================================================
// Core: Process scheduled posts
// ============================================================================

/**
 * Process all queued outbound messages whose scheduled_at has passed.
 *
 * @param supabase - Supabase client instance
 * @param opts - Scheduler options
 * @param backendFactory - Optional factory override (for testing)
 * @returns Array of processing results
 */
export async function processScheduledPosts(
  supabase: SupabaseClient,
  opts: SchedulerOptions = {},
  backendFactory?: BackendFactory
): Promise<ProcessResult[]> {
  const batchSize = opts.batchSize ?? 50;
  const verbose = opts.verbose ?? false;
  const factory = backendFactory ?? (await getDefaultFactory());

  // 1. Query queued messages where scheduled_at <= now
  const now = new Date().toISOString();
  const { data: messages, error: queryError } = await supabase
    .from("outbound_messages")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(batchSize) as unknown as {
    data: OutboundMessage[] | null;
    error: { message: string } | null;
  };

  if (queryError) {
    throw new Error(`Failed to query scheduled messages: ${queryError.message}`);
  }

  if (!messages || messages.length === 0) {
    if (verbose) {
      console.log("No scheduled messages due for processing.");
    }
    return [];
  }

  if (verbose) {
    console.log(`Processing ${messages.length} queued message(s)...`);
  }

  const results: ProcessResult[] = [];

  // 2. Process each message
  for (const msg of messages) {
    const result = await processOneMessage(supabase, msg, factory, verbose);
    results.push(result);
  }

  return results;
}

/**
 * Process a single outbound message:
 * - Resolve channel config to get platform
 * - Create backend, authenticate, publish
 * - Update message status
 */
async function processOneMessage(
  supabase: SupabaseClient,
  msg: OutboundMessage,
  factory: BackendFactory,
  verbose: boolean
): Promise<ProcessResult> {
  try {
    // Mark as 'sending' to prevent double-processing
    await supabase
      .from("outbound_messages")
      .update({ status: "sending" })
      .eq("id", msg.id);

    // Resolve channel to get platform
    const { data: channel, error: channelError } = await supabase
      .from("outbound_channels")
      .select("*")
      .eq("id", msg.channel_id)
      .single() as unknown as {
      data: OutboundChannel | null;
      error: { message: string } | null;
    };

    if (channelError || !channel) {
      throw new Error(
        `Channel ${msg.channel_id} not found: ${channelError?.message ?? "no data"}`
      );
    }

    if (!channel.is_active) {
      throw new Error(`Channel "${channel.name}" (${channel.platform}) is inactive`);
    }

    const platform = channel.platform;

    if (verbose) {
      console.log(`  Publishing message ${msg.id} via ${platform}...`);
    }

    // Create backend and publish
    const backend = await factory(platform);
    const post = messageToPost(msg);
    const publishResult: SocialResult = await backend.publish(post);

    if (!publishResult.success) {
      throw new Error(publishResult.error ?? "Publish returned success=false");
    }

    // Update message status to 'sent'
    await supabase
      .from("outbound_messages")
      .update({
        status: "sent",
        external_id: publishResult.postId ?? null,
        sent_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", msg.id);

    const result: ProcessResult = {
      messageId: msg.id,
      platform,
      status: "sent",
      externalId: publishResult.postId,
    };

    if (verbose) {
      console.log(`  Sent: ${msg.id} → ${platform} (${publishResult.postId ?? "no external ID"})`);
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Update message status to 'failed'
    await supabase
      .from("outbound_messages")
      .update({
        status: "failed",
        error_message: errorMsg,
      })
      .eq("id", msg.id);

    const result: ProcessResult = {
      messageId: msg.id,
      platform: "unknown",
      status: "failed",
      error: errorMsg,
    };

    if (verbose) {
      console.log(`  Failed: ${msg.id} — ${errorMsg}`);
    }

    return result;
  }
}
