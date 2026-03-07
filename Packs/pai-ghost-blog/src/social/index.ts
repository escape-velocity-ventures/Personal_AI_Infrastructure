/**
 * Social backend factory — resolves platform backends and credentials from k8s secrets.
 */

import { $ } from "bun";
import type { SocialBackend, SocialCredentials } from "./types.js";
import { TwitterBackend } from "./twitter.js";
import { LinkedInBackend } from "./linkedin.js";

export { type SocialBackend, type SocialCredentials, type SocialPost, type SocialResult, type SocialMetrics } from "./types.js";

// Platform registry
const BACKENDS: Record<string, () => SocialBackend> = {
  twitter: () => new TwitterBackend(),
  linkedin: () => new LinkedInBackend(),
};

/** Secret name and key mappings per platform */
const CREDENTIAL_MAP: Record<string, { secret: string; keys: { accessToken: string; refreshToken?: string } }> = {
  twitter: {
    secret: "social-credentials",
    keys: { accessToken: "TWITTER_ACCESS_TOKEN", refreshToken: "TWITTER_REFRESH_TOKEN" },
  },
  linkedin: {
    secret: "social-credentials",
    keys: { accessToken: "LINKEDIN_ACCESS_TOKEN", refreshToken: "LINKEDIN_REFRESH_TOKEN" },
  },
};

const NAMESPACES = ["content-engine", "tinkerbelle-production-blue", "tinkerbelle-production-green", "default"];

/**
 * Resolve a k8s secret field, trying namespaces in order.
 */
async function resolveSecretField(secretName: string, field: string): Promise<string | undefined> {
  for (const ns of NAMESPACES) {
    try {
      const result = await $`kubectl get secret ${secretName} -n ${ns} -o jsonpath={.data.${field}}`.text();
      const trimmed = result.trim();
      if (trimmed) {
        return Buffer.from(trimmed, "base64").toString("utf-8");
      }
    } catch {
      // Try next namespace
    }
  }
  return undefined;
}

/**
 * Get credentials for a platform from k8s secrets.
 */
export async function getCredentials(platform: string): Promise<SocialCredentials> {
  const config = CREDENTIAL_MAP[platform];
  if (!config) {
    throw new Error(`No credential configuration for platform: ${platform}`);
  }

  const accessToken = await resolveSecretField(config.secret, config.keys.accessToken);
  if (!accessToken) {
    throw new Error(
      `Could not resolve ${config.keys.accessToken} from secret "${config.secret}" in any namespace. ` +
      `Ensure the secret exists: kubectl create secret generic ${config.secret} -n <namespace> ` +
      `--from-literal=${config.keys.accessToken}=<token>`
    );
  }

  const refreshToken = config.keys.refreshToken
    ? await resolveSecretField(config.secret, config.keys.refreshToken)
    : undefined;

  return {
    platform,
    accessToken,
    refreshToken: refreshToken ?? undefined,
  };
}

/**
 * Create and authenticate a social backend for the given platform.
 */
export async function createBackend(platform: string): Promise<SocialBackend> {
  const factory = BACKENDS[platform];
  if (!factory) {
    throw new Error(
      `Unknown platform: "${platform}". Available: ${Object.keys(BACKENDS).join(", ")}`
    );
  }

  const backend = factory();
  const credentials = await getCredentials(platform);
  await backend.authenticate(credentials);
  return backend;
}

/**
 * List available platform names.
 */
export function listPlatforms(): string[] {
  return Object.keys(BACKENDS);
}
