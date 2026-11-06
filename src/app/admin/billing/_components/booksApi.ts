/** Small fetch wrapper for /api/admin/books/* — returns an error message or null. */
export async function booksCall(url: string, method: "POST" | "PATCH" | "PUT", body: unknown): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { error: (data && typeof data.error === "string" ? data.error : null) ?? `Something went wrong (${res.status}).`, data };
    return { error: null, data };
  } catch {
    return { error: "Couldn't reach the Portal — check your connection and try again.", data: null };
  }
}

export const money = (n: number | null | undefined) =>
  n == null ? "" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const fieldClass =
  "w-full rounded-ctl px-3 py-2 text-sm bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40 disabled:opacity-50";
