import { normKey } from "./zohoCsv";
import type { BillingClient, DupeGroup } from "./types";

/** Order-independent key for a dismissed pair (matches the table's client_a < client_b). */
export function pairKey(a: string, b: string): string {
  return a < b ? a + "|" + b : b + "|" + a;
}

/**
 * Possible duplicates: clients sharing a normalized name or a normalized
 * email. A group drops out once every pair in it has been marked "Keep both".
 */
export function findDupeGroups(clients: BillingClient[], dismissed: { client_a: string; client_b: string }[]): DupeGroup[] {
  const gone: Record<string, true> = {};
  dismissed.forEach((d) => { gone[pairKey(d.client_a, d.client_b)] = true; });

  const groups: DupeGroup[] = [];
  const collect = (reason: "name" | "email", keyOf: (c: BillingClient) => string) => {
    const m: Record<string, string[]> = {};
    clients.forEach((c) => {
      const k = keyOf(c);
      if (!k) return;
      (m[k] = m[k] || []).push(c.id);
    });
    Object.keys(m).forEach((k) => {
      const ids = m[k];
      if (ids.length < 2) return;
      let open = false;
      for (let i = 0; i < ids.length && !open; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (!gone[pairKey(ids[i], ids[j])]) { open = true; break; }
        }
      }
      if (open) groups.push({ key: reason + ":" + k, reason, value: k, ids });
    });
  };
  collect("email", (c) => normKey(c.email));
  collect("name", (c) => normKey(c.display_name));

  // A name group that is exactly an email group already shown adds nothing.
  const seen: Record<string, true> = {};
  return groups.filter((g) => {
    const sig = g.ids.slice().sort().join(",");
    if (seen[sig]) return false;
    seen[sig] = true;
    return true;
  });
}
