// Bulk email via Resend's batch endpoint — up to 100 emails per HTTP request.
// This replaces firing one request per recipient, which blew past Resend's
// per-second rate limit on large sends (the announcement: 68 of 83 rejected).
// One request per 100 recipients = no rate-limit problem, no function timeout.

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const CHUNK = 100;

export type BatchEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
};

export type BatchResult = { ok: boolean; id?: string; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends all messages via Resend's batch API, returning a per-message result in
 * the same order. Chunks of 100; a small gap between chunks keeps even very
 * large sends under the API rate limit.
 */
export async function sendResendBatch(messages: BatchEmail[]): Promise<BatchResult[]> {
  const results: BatchResult[] = new Array(messages.length);

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            from: m.from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            ...(m.headers ? { headers: m.headers } : {}),
          }))
        ),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const err = String(data?.message ?? data?.error?.message ?? `Resend batch error ${res.status}`).slice(0, 200);
        for (let j = 0; j < chunk.length; j++) results[i + j] = { ok: false, error: err };
      } else {
        const ids: { id?: string }[] = Array.isArray(data?.data) ? data.data : [];
        for (let j = 0; j < chunk.length; j++) {
          const id = ids[j]?.id;
          results[i + j] = id ? { ok: true, id } : { ok: false, error: "No id returned by Resend" };
        }
      }
    } catch (e) {
      const err = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      for (let j = 0; j < chunk.length; j++) results[i + j] = { ok: false, error: err };
    }

    if (i + CHUNK < messages.length) await sleep(600);
  }

  return results;
}
