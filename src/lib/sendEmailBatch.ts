// Bulk email via Resend's batch endpoint — up to 100 emails per HTTP request.
// This replaces firing one request per recipient, which blew past Resend's
// per-second rate limit on large sends (the announcement: 68 of 83 rejected).
// One request per 100 recipients = no rate-limit problem, no function timeout.
//
// Resend's batch endpoint is all-or-nothing: if ANY recipient address is
// malformed, the whole batch is rejected. So we validate addresses up front and
// only send the valid ones — a single bad email can never sink everyone else.

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const CHUNK = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * the same order. Invalid addresses are skipped (marked failed) so they can't
 * fail the batch for everyone. Chunks of 100, with a gap between chunks.
 */
export async function sendResendBatch(messages: BatchEmail[]): Promise<BatchResult[]> {
  const results: BatchResult[] = new Array(messages.length);

  // Partition: only well-formed addresses go to Resend.
  const validIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (EMAIL_RE.test((messages[i].to ?? "").trim())) validIdx.push(i);
    else results[i] = { ok: false, error: "Invalid email address" };
  }

  for (let c = 0; c < validIdx.length; c += CHUNK) {
    const chunkIdx = validIdx.slice(c, c + CHUNK);
    try {
      const res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          chunkIdx.map((i) => {
            const m = messages[i];
            return {
              from: m.from,
              to: [m.to.trim()],
              subject: m.subject,
              html: m.html,
              ...(m.headers ? { headers: m.headers } : {}),
            };
          })
        ),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const err = String(data?.message ?? data?.error?.message ?? `Resend batch error ${res.status}`).slice(0, 200);
        for (const i of chunkIdx) results[i] = { ok: false, error: err };
      } else {
        const ids: { id?: string }[] = Array.isArray(data?.data) ? data.data : [];
        chunkIdx.forEach((i, j) => {
          const id = ids[j]?.id;
          results[i] = id ? { ok: true, id } : { ok: false, error: "No id returned by Resend" };
        });
      }
    } catch (e) {
      const err = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      for (const i of chunkIdx) results[i] = { ok: false, error: err };
    }

    if (c + CHUNK < validIdx.length) await sleep(600);
  }

  return results;
}
