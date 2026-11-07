"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { contactName, type BillingClientContact } from "@/lib/books/types";
import { booksCall, booksGet, fieldClass } from "./booksApi";

type Form = { first_name: string; last_name: string; email: string; phone: string; mobile: string; role: string; send_by_default: boolean };
const EMPTY: Form = { first_name: "", last_name: "", email: "", phone: "", mobile: "", role: "", send_by_default: true };

const toForm = (c: BillingClientContact): Form => ({
  first_name: c.first_name ?? "",
  last_name: c.last_name ?? "",
  email: c.email ?? "",
  phone: c.phone ?? "",
  mobile: c.mobile ?? "",
  role: c.role ?? "",
  send_by_default: !!c.send_by_default,
});

/**
 * "Contacts" on a client (Zoho's contact persons): who's who at the client
 * and who gets the invoices. The primary contact mirrors the client's email
 * and phone; "Gets invoices" = pre-ticked in the Send dialog.
 */
export default function ClientContacts({ clientId, onReady }: { clientId: string; onReady?: (ready: boolean) => void }) {
  const router = useRouter();
  const [list, setList] = useState<BillingClientContact[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // contact id or "new"
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const r = await booksGet(`/api/admin/books/clients/${clientId}/contacts`);
    if (r.error) { setLoadErr(r.error); setList([]); if (onReady) onReady(false); return; }
    setLoadErr(null);
    if (onReady) onReady(true);
    setList((r.data?.contacts as BillingClientContact[]) ?? []);
  };
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = async () => { setEditing(null); await load(); router.refresh(); };

  const save = async () => {
    setBusy("save"); setError(null);
    const r = editing === "new"
      ? await booksCall(`/api/admin/books/clients/${clientId}/contacts`, "POST", form)
      : await booksCall(`/api/admin/books/clients/${clientId}/contacts/${editing}`, "PATCH", form);
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    await done();
  };

  const patch = async (c: BillingClientContact, body: Record<string, unknown>) => {
    setBusy(c.id); setError(null);
    const r = await booksCall(`/api/admin/books/clients/${clientId}/contacts/${c.id}`, "PATCH", body);
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    await load();
    if ("is_primary" in body) router.refresh();
  };

  const remove = async (c: BillingClientContact) => {
    if (!window.confirm(`Remove ${contactName(c) || c.email || "this contact"} from this client?`)) return;
    setBusy(c.id); setError(null);
    const r = await booksCall(`/api/admin/books/clients/${clientId}/contacts/${c.id}`, "DELETE");
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    await load();
  };

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === "send_by_default" ? e.target.checked : e.target.value } as Form);

  const formView = (
    <div className="space-y-3 border border-hairline rounded-card p-3 bg-white">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><span className="label-caps">First name</span><input className={fieldClass + " mt-1"} value={form.first_name} onChange={set("first_name")} /></label>
        <label className="block"><span className="label-caps">Last name</span><input className={fieldClass + " mt-1"} value={form.last_name} onChange={set("last_name")} /></label>
        <label className="block sm:col-span-2"><span className="label-caps">Email</span><input className={fieldClass + " mt-1"} type="email" value={form.email} onChange={set("email")} /></label>
        <label className="block"><span className="label-caps">Phone</span><input className={fieldClass + " mt-1"} value={form.phone} onChange={set("phone")} /></label>
        <label className="block"><span className="label-caps">Mobile</span><input className={fieldClass + " mt-1"} value={form.mobile} onChange={set("mobile")} /></label>
        <label className="block sm:col-span-2"><span className="label-caps">Role</span><input className={fieldClass + " mt-1"} value={form.role} onChange={set("role")} placeholder="e.g. Accounts payable, Assistant" /></label>
        <label className="flex items-center gap-2 sm:col-span-2 text-sm text-ink-700">
          <input type="checkbox" checked={form.send_by_default} onChange={set("send_by_default")} /> Gets invoices (ticked when you send)
        </label>
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy === "save"}>{busy === "save" ? "Saving…" : editing === "new" ? "Add contact" : "Save contact"}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null); }} disabled={busy === "save"}>Cancel</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps">Contacts</span>
        {editing !== "new" && !loadErr && (
          <Button size="sm" variant="secondary" onClick={() => { setError(null); setForm(EMPTY); setEditing("new"); }}>Add contact</Button>
        )}
      </div>
      <p className="text-small text-ink-500">
        Who gets this client&apos;s invoices. Tick &ldquo;Gets invoices&rdquo; for each person who should be pre-ticked when you send — for example the
        billing contact when the broker is named on the invoice but someone else pays it. Contacts brought in from Zoho start unticked (except the primary one).
      </p>
      {list === null ? (
        <p className="text-small text-ink-400">Loading contacts…</p>
      ) : loadErr ? (
        <p className="text-small text-warn-700">{loadErr}</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline rounded-card bg-white">
          {list.length === 0 && <li className="px-3 py-2.5 text-small text-ink-500">No contacts yet. Add one, or give the client an email above.</li>}
          {list.map((c) => (
            <li key={c.id} className="px-3 py-2.5">
              {editing === c.id ? formView : (
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink-900">{contactName(c) || c.email || "Unnamed"}</span>
                      {c.is_primary && <Badge tone="accent">Primary</Badge>}
                      {c.role && <span className="text-small text-ink-500">{c.role}</span>}
                    </div>
                    <p className="text-small text-ink-500 break-words mt-0.5">{[c.email, c.phone || c.mobile].filter(Boolean).join(" · ") || "No email"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    <label className={`inline-flex items-center gap-1.5 text-small mr-2 ${c.email ? "text-ink-700" : "text-ink-400"}`} title={c.email ? "" : "Add an email first"}>
                      <input type="checkbox" checked={!!c.send_by_default} disabled={busy === c.id || !c.email} onChange={(e) => patch(c, { send_by_default: e.target.checked })} />
                      Gets invoices
                    </label>
                    {!c.is_primary && c.email && <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => patch(c, { is_primary: true })}>Make primary</Button>}
                    <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => { setError(null); setForm(toForm(c)); setEditing(c.id); }}>Edit</Button>
                    {!c.is_primary && <Button size="sm" variant="ghost" className="text-danger-700" disabled={busy === c.id} onClick={() => remove(c)}>Remove</Button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "new" && formView}
      {error && editing === null && <p className="text-sm text-danger-700">{error}</p>}
    </div>
  );
}
