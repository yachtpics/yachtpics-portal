import { Client } from "basic-ftp";
import { Readable } from "stream";
import type { SiteFile } from "@/lib/sitePublish";

// Pushes generated pages to yachtpics.com over FTPS.
//
// Credentials come from env vars only — never hardcode them, never log them:
//   SITE_FTP_HOST      e.g. 173.201.181.158  (or ftp.yachtpics.com)
//   SITE_FTP_USER
//   SITE_FTP_PASSWORD
//   SITE_FTP_ROOT      defaults to /public_html
//
// If they're absent, publishing still generates the files — it just doesn't
// upload — so the output can be reviewed before anything goes live.

export function ftpConfigured(): boolean {
  return Boolean(process.env.SITE_FTP_HOST && process.env.SITE_FTP_USER && process.env.SITE_FTP_PASSWORD);
}

export async function uploadFiles(files: SiteFile[]): Promise<{ uploaded: string[]; error?: string }> {
  if (!ftpConfigured()) return { uploaded: [], error: "FTP is not configured" };

  // A cPanel FTP account scoped to public_html sees it as "/", while the main
  // account needs "/public_html". Normalise so either value works and we never
  // build a "//path".
  const root = (process.env.SITE_FTP_ROOT || "/public_html").replace(/\/+$/, "");

  // GoDaddy's FTP endpoint intermittently refuses or times out the control
  // socket — usually a brief throttle after a burst of connections. A single
  // blip shouldn't fail a publish, so retry the whole connect+upload a few
  // times. Timeout and attempt count stay under the route's 60s budget
  // (worst case ~20s + backoff + 20s). Re-uploading a file just overwrites it,
  // so retrying the full set is safe.
  const maxAttempts = 3;
  let lastError = "Upload failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new Client(20_000);
    const uploaded: string[] = [];
    try {
      await client.access({
        host: process.env.SITE_FTP_HOST!,
        user: process.env.SITE_FTP_USER!,
        password: process.env.SITE_FTP_PASSWORD!,
        secure: true,
        secureOptions: { rejectUnauthorized: false },
      });

      for (const f of files) {
        const full = `${root}/${f.path}`;
        const dir = full.slice(0, full.lastIndexOf("/"));
        await client.ensureDir(dir);
        await client.cd("/");
        await client.uploadFrom(Readable.from([f.content]), full);
        uploaded.push(f.path);
      }
      client.close();
      return { uploaded };
    } catch (e) {
      client.close();
      // Never echo the error verbatim to the client — it can carry credentials.
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg.replace(new RegExp(process.env.SITE_FTP_PASSWORD ?? "\0", "g"), "***");

      // Only retry transient network failures; a real auth or path error won't
      // fix itself, so fail fast on those.
      const transient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|timeout|closed|not connected/i.test(msg);
      if (!transient || attempt === maxAttempts) {
        return { uploaded, error: lastError };
      }
      // Brief backoff so GoDaddy's throttle window can clear.
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }

  return { uploaded: [], error: lastError };
}

// Deletes files from the site — used to retire a brokerage page whose links are
// dead or that we no longer want reachable by direct URL. A file that's already
// gone counts as deleted (idempotent). Same retry shape as uploadFiles.
export async function deleteFiles(paths: string[]): Promise<{ deleted: string[]; error?: string }> {
  if (!ftpConfigured()) return { deleted: [], error: "FTP is not configured" };

  const root = (process.env.SITE_FTP_ROOT || "/public_html").replace(/\/+$/, "");
  const maxAttempts = 3;
  let lastError = "Delete failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = new Client(20_000);
    const deleted: string[] = [];
    try {
      await client.access({
        host: process.env.SITE_FTP_HOST!,
        user: process.env.SITE_FTP_USER!,
        password: process.env.SITE_FTP_PASSWORD!,
        secure: true,
        secureOptions: { rejectUnauthorized: false },
      });

      for (const p of paths) {
        const full = `${root}/${p}`;
        try {
          await client.remove(full);
          deleted.push(p);
        } catch (e) {
          // "Already gone" is the outcome we want — treat a missing file (FTP
          // 550) as deleted rather than an error.
          const m = e instanceof Error ? e.message : String(e);
          if (/550|no such file|not found|cannot find/i.test(m)) {
            deleted.push(p);
            continue;
          }
          throw e;
        }
      }
      client.close();
      return { deleted };
    } catch (e) {
      client.close();
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg.replace(new RegExp(process.env.SITE_FTP_PASSWORD ?? "\0", "g"), "***");

      const transient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EPIPE|timeout|closed|not connected/i.test(msg);
      if (!transient || attempt === maxAttempts) {
        return { deleted, error: lastError };
      }
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }

  return { deleted: [], error: lastError };
}
