/**
 * Messages the Connect flow sends back to Admin → YouTube as `?error=<code>`.
 * Only codes travel in the URL (never free text), so a crafted link can't put
 * words on the admin's page. Safe for client components.
 */
export const YOUTUBE_CONNECT_ERRORS: Record<string, string> = {
  not_set_up: "YouTube isn't set up yet. The steps are in docs/youtube-setup.md.",
  migration: "The database update for YouTube hasn't been applied yet.",
  denied: "Google sign-in was cancelled, so nothing was connected.",
  state: "That sign-in link had expired or didn't match. Press Connect a channel again.",
  exchange: "Google didn't accept the sign-in. Press Connect a channel again.",
  no_refresh:
    "Google didn't give a long-lived permission. Disconnect the Portal in your Google account's security settings and connect again.",
  no_channel:
    "This Google account has no YouTube channel. Create the channel in YouTube first, or pick the channel's Brand Account on Google's screen.",
  channel_read: "Connected to Google, but couldn't read the YouTube channel. Try again in a minute.",
  scope: "Google didn't give permission to upload. Press Connect a channel again and tick both boxes on Google's screen.",
  save: "Couldn't save the channel. Try again.",
};

export function youtubeConnectError(code: string | null | undefined): string | null {
  if (!code) return null;
  return YOUTUBE_CONNECT_ERRORS[code] ?? "Something went wrong connecting the channel. Try again.";
}
