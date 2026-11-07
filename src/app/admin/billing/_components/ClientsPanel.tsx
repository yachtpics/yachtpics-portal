"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { BillingClient, DupeGroup, StaffView } from "@/lib/books/types";
import { booksCall, fieldClass, money } from "./booksApi";
import ClientContacts from "./ClientContacts";

type Form = {
  display_name: string;
  company_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  mobile: string;
  status: "active" | "inactive";
  notes: string;
};

const EMPTY: Form = { display_name: "", company_name: "", first_name: "", last_name: "", email: "", phone: "", mobile: "", status: "active", notes: "" };

function toForm(c: BillingClient): Form {
  return {
    display_name: c.display_name ?? "",
    company_name: c.company_name ?? "",
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    mobile: c.mobile ?? "",
    status: c.status,
    notes: c.notes ?? "",
  };
}

const PAGE = 60;

export default function ClientsPanel({
  clients,
  brokerNames,
  dupeGroups,
  staff,
}: {
  clients: BillingClient[];
  brokerNames: Record<string, string>;
  dupeGroups: DupeGroup[];
  staff: StaffView;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null); // client id or "new"
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Contacts (20261108c) loaded for the client being edited: its email / phone
  // are then edited on the primary contact, not here (one place, no overwrite).
  const [contactsReady, setContactsReady] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!needle) return true;
      return [c.display_name, c.company_name, c.email, c.phone, c.mobile, c.first_name, c.last_name]
        .some((v) => (v ?? "").toLowerCase().indexOf(needle) !== -1);
    });
  }, [clients, q, status]);

  const open = (c: BillingClient | null) => {
    setError(null);
    setContactsReady(false);
    if (c) { setEditing(c.id); setForm(toForm(c)); } else { setEditing("new"); setForm(EMPTY); }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { ...form };
    if (editing !== "new" && contactsReady) { delete body.email; delete body.phone; delete body.mobile; }
    const { error: err } = editing === "new"
      ? await booksCall("/api/admin/books/clients", "POST", body)
      : await booksCall(`/api/admin/books/clients/${editing}`, "PATCH", body);
    setBusy(false);
    if (err) { setError(err); return; }
    setEditing(null);
    router.refresh();
  };

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value } as Form);

  const formView = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="label-caps">Name on invoices</span>
          <input className={fieldClass + " mt-1"} value={form.display_name} onChange={set("display_name")} placeholder="e.g. John Varga" />
        </label>
        <label className="block">
          <span className="label-caps">First name</span>
          <input className={fieldClass + " mt-1"} value={form.first_name} onChange={set("first_name")} />
        </label>
        <label className="block">
          <span className="label-caps">Last name</span>
          <input className={fieldClass + " mt-1"} value={form.last_name} onChange={set("last_name")} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Company</span>
          <input className={fieldClass + " mt-1"} value={form.company_name} onChange={set("company_name")} />
        </label>
        {editing !== "new" && contactsReady ? (
          <p className="sm:col-span-2 text-small text-ink-500">Email and phone are on the primary contact below.</p>
        ) : (
          <>
            <label className="block sm:col-span-2">
              <span className="label-caps">Email</span>
              <input className={fieldClass + " mt-1"} type="email" value={form.email} onChange={set("email")} />
            </label>
            <label className="block">
              <span className="label-caps">Phone</span>
              <input className={fieldClass + " mt-1"} value={form.phone} onChange={set("phone")} />
            </label>
            <label className="block">
              <span className="label-caps">Mobile</span>
              <input className={fieldClass + " mt-1"} value={form.mobile} onChange={set("mobile")} />
            </label>
          </>
        )}
        <label className="block">
          <span className="label-caps">Status</span>
          <select className={fieldClass + " mt-1"} value={form.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Notes</span>
          <textarea className={fieldClass + " mt-1 min-h-[72px]"} value={form.notes} onChange={set("notes")} />
        </label>
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing === "new" ? "Add client" : "Save"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
      </div>
      <p className="text-small text-ink-500">If the email matches a Portal login, the client is linked to that broker automatically.</p>
      {editing && editing !== "new" && (
        <div className="border-t border-hairline pt-3">
          <ClientContacts clientId={editing} onReady={setContactsReady} />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {staff.isOwner && dupeGroups.length > 0 && <DupesPanel groups={dupeGroups} clients={clients} />}

      <Card>
        <CardHeader
          title="Clients"
          kicker="Shared by both logins"
          description={`${filtered.length} of ${clients.length}`}
          action={editing !== "new" && <Button size="sm" variant="secondary" onClick={() => open(null)}>Add client</Button>}
        />
        <CardBody className="space-y-4">
          {editing === "new" && <div className="border border-hairline rounded-card p-4 bg-ink-50">{formView}</div>}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={fieldClass + " sm:max-w-xs"}
              placeholder="Search name, company, email, phone"
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
            />
            <div className="inline-flex rounded-ctl border border-hairline-strong p-0.5 self-start">
              {(["active", "inactive", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatus(s); setShown(PAGE); }}
                  className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors duration-base ease-quiet ${status === s ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-ink-500 py-6">No clients yet. Run the Zoho seed, or add one above.</p>
          ) : (
            <ul className="divide-y divide-hairline border-y border-hairline">
              {filtered.slice(0, shown).map((c) => (
                <li key={c.id} className="py-3">
                  {editing === c.id ? (
                    <div className="py-1">{formView}</div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{c.display_name}</span>
                          {c.status === "inactive" && <Badge>Inactive</Badge>}
                          {c.broker_profile_id && (
                            <Badge tone="info" title="Matched to a Portal login by email">
                              Portal · {brokerNames[c.broker_profile_id] ?? "linked"}
                            </Badge>
                          )}
                          {c.zoho_open_balance != null && c.zoho_open_balance > 0 && (
                            <Badge tone="warn" title="Open in Zoho — finish it there">Zoho open {money(c.zoho_open_balance)}</Badge>
                          )}
                        </div>
                        <p className="text-small text-ink-500 mt-0.5 break-words">
                          {[c.company_name && c.company_name !== c.display_name ? c.company_name : null, c.email, c.phone || c.mobile].filter(Boolean).join(" · ") || "No contact details"}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => open(c)}>Edit</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {filtered.length > shown && (
            <Button size="sm" variant="secondary" onClick={() => setShown(shown + PAGE)}>Show more ({filtered.length - shown} left)</Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function DupesPanel({ groups, clients }: { groups: DupeGroup[]; clients: BillingClient[] }) {
  const router = useRouter();
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byId: Record<string, BillingClient> = {};
  clients.forEach((c) => { byId[c.id] = c; });

  const merge = async (g: DupeGroup, keepId: string) => {
    const keep = byId[keepId];
    const others = g.ids.filter((id) => id !== keepId && byId[id]);
    if (!keep || !others.length) return;
    if (!window.confirm(`Keep "${keep.display_name}" and merge ${others.length === 1 ? "the other record" : `the other ${others.length}`} into it? Empty details are filled in from the others, then they're removed.`)) return;
    setBusy(g.key); setError(null);
    const { error: err } = await booksCall("/api/admin/books/clients/merge", "POST", { survivorId: keepId, otherIds: others });
    setBusy(null);
    if (err) setError(err); else router.refresh();
  };

  const keepBoth = async (g: DupeGroup) => {
    setBusy(g.key); setError(null);
    const { error: err } = await booksCall("/api/admin/books/clients/dismiss", "POST", { ids: g.ids });
    setBusy(null);
    if (err) setError(err); else router.refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Possible duplicates"
        kicker="Review once"
        description={`${groups.length} ${groups.length === 1 ? "group shares" : "groups share"} a name or an email. Exact copies (same name and email) were already merged on import.`}
        action={<Button size="sm" variant="secondary" onClick={() => setOpenList(!openList)}>{openList ? "Hide" : "Review"}</Button>}
      />
      {openList && (
        <CardBody className="space-y-4">
          {error && <p className="text-sm text-danger-700">{error}</p>}
          {groups.map((g) => (
            <div key={g.key} className="border border-hairline rounded-card">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-hairline bg-ink-50 rounded-t-card">
                <p className="text-small text-ink-600 min-w-0 truncate">
                  <span className="label-caps mr-2">Same {g.reason}</span>{g.value}
                </p>
                <Button size="sm" variant="ghost" disabled={busy === g.key} onClick={() => keepBoth(g)}>Keep {g.ids.length > 2 ? "all" : "both"}</Button>
              </div>
              <ul className="divide-y divide-hairline">
                {g.ids.map((id) => {
                  const c = byId[id];
                  if (!c) return null;
                  return (
                    <li key={id} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">{c.display_name}{c.status === "inactive" ? " · inactive" : ""}</p>
                        <p className="text-small text-ink-500 break-words">
                          {[c.company_name, c.email, c.phone || c.mobile, c.zoho_open_balance ? `Zoho open ${money(c.zoho_open_balance)}` : null].filter(Boolean).join(" · ") || "No details"}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" disabled={busy === g.key} onClick={() => merge(g, id)}>Keep this one</Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  );
}
