/**
 * Facebook / Instagram publishing — the one place for its switches.
 *
 * Everything here must work with the env vars missing: the feature then
 * reports "not configured" and the UI hides itself. Nothing throws at import.
 */

/** Graph API version, used by every Meta call. Change it here only. */
export const GRAPH_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
export const FB_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

/**
 * Open Social accounts + "Post to Facebook / Instagram" to brokers.
 *
 * false = admin only. Meta's App Review hasn't approved the app yet, so only
 * people with a role on the Meta app (Charlie) can connect. When this flips
 * to true, brokers see Profile → Social accounts and can post their own
 * delivered Reel Service reels — and the broker Help page MUST be updated in
 * the same change (see CLAUDE.md, Help page rule).
 */
export const SOCIAL_PUBLISHING_FOR_BROKERS = false;

/** Permissions asked for at Connect. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

export function metaAppId(): string | null {
  return process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || null;
}

export function metaAppSecret(): string | null {
  return process.env.META_APP_SECRET || null;
}

/**
 * Optional: a Facebook Login for Business configuration ID. When set, the
 * login dialog uses `config_id` (permissions come from that configuration)
 * instead of the `scope` list above.
 */
export function metaLoginConfigId(): string | null {
  return process.env.META_LOGIN_CONFIG_ID || null;
}

/** App ID present — enough to show the section (as "not configured" if the rest is missing). */
export function metaAppIdConfigured(): boolean {
  return !!metaAppId();
}

/** Everything needed to connect and post: app id, app secret and the token key. */
export function metaConfigured(): boolean {
  return !!(metaAppId() && metaAppSecret() && process.env.SOCIAL_TOKEN_KEY);
}

export function metaMissingConfig(): string[] {
  const out: string[] = [];
  if (!metaAppId()) out.push("META_APP_ID");
  if (!metaAppSecret()) out.push("META_APP_SECRET");
  if (!process.env.SOCIAL_TOKEN_KEY) out.push("SOCIAL_TOKEN_KEY");
  return out;
}

export const SOCIAL_PLATFORMS = ["facebook", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialPostStatus = "scheduled" | "posting" | "posted" | "failed" | "cancelled";

/** Instagram's caption limit (Facebook's is far higher). */
export const MAX_CAPTION = 2200;
