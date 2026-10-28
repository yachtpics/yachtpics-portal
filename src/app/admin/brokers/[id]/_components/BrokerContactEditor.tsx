"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MONTHS, daysInMonth, formatBirthday, instagramUrl } from "@/lib/brokerContact";

interface Props {
  brokerId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  /** profiles.address — free text, optional (Oct 28). */
  address: string | null;
  officePhone: string | null;
  /** Bare handle, no @. */
  instagram: string | null;
  facebookUrl: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  /**
   * broker_details.brokerage_name — free text, and the name the Reel end card and the
   * rest of the branding actually render. It is NOT the same thing as the brokerage a
   * broker is linked to through profiles.brokerage_id on the Brokerages pages, which is
   * why it is editable here: a broker who changes firms needs both put right.
   */
  brokerageName: string | null;
  brokerageWebsite: string | null;
}

export default function BrokerContactEditor({ brokerId, firstName, lastName, email, phone, address, officePhone, instagram, facebookUrl, birthdayMonth, birthdayDay, brokerageName, brokerageWebsite }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastName ?? "");
  const [mail, setMail] = useState(email ?? "");
  const [tel, setTel] = useState(phone ?? "");
  const [addr, setAddr] = useState(address ?? "");
  const [office, setOffice] = useState(officePhone ?? "");
  const [ig, setIg] = useState(instagram ?? "");
  const [fb, setFb] = useState(facebookUrl ?? "");
  const [bMonth, setBMonth] = useState(birthdayMonth ? String(birthdayMonth) : "");
  const [bDay, setBDay] = useState(birthdayDay ? String(birthdayDay) : "");
  const [firm, setFirm] = useState(brokerageName ?? "");
  const [site, setSite] = useState(brokerageWebsite ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openEditor() {
    setFirst(firstName ?? "");
    setLast(lastName ?? "");
    setMail(email ?? "");
    setTel(phone ?? "");
    setAddr(address ?? "");
    setOffice(officePhone ?? "");
    setIg(instagram ?? "");
    setFb(facebookUrl ?? "");
    setBMonth(birthdayMonth ? String(birthdayMonth) : "");
    setBDay(birthdayDay ? String(birthdayDay) : "");
    setFirm(brokerageName ?? "");
    setSite(brokerageWebsite ?? "");
    setError("");
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/update-broker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: brokerId,
          email: mail,
          firstName: first,
          lastName: last,
          phone: tel,
          address: addr,
          officePhone: office,
          instagram: ig,
          facebook: fb,
          birthdayMonth: bMonth || null,
          birthdayDay: bDay || null,
          brokerageName: firm,
          brokerageWebsite: site,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps mb-1">Contact</p>
          <p className="text-sm text-ink-900">{email ?? "—"}</p>
          <p className="text-sm text-ink-500 mt-1">Mobile: {phone ?? "—"}</p>
          <p className="text-sm text-ink-500 mt-1">Office: {officePhone ?? "—"}</p>
          <p className="text-sm text-ink-500 mt-1 whitespace-pre-line">{address ?? "—"}</p>
          {(instagram || facebookUrl) && (
            <p className="text-sm mt-1 flex flex-wrap gap-x-3">
              {instagram && <a href={instagramUrl(instagram)} target="_blank" rel="noopener noreferrer" className="text-accent-700 hover:underline">@{instagram}</a>}
              {facebookUrl && <a href={facebookUrl} target="_blank" rel="noopener noreferrer" className="text-accent-700 hover:underline">Facebook</a>}
            </p>
          )}
          {formatBirthday(birthdayMonth, birthdayDay) && <p className="text-sm text-ink-500 mt-1">Birthday: {formatBirthday(birthdayMonth, birthdayDay)}</p>}
          <p className="text-sm text-ink-500 mt-1">{brokerageName ?? "No brokerage name"}</p>
          {brokerageWebsite && <p className="text-xs text-ink-500 mt-1 break-all">{brokerageWebsite}</p>}
        </div>
        <button
          onClick={openEditor}
          className="text-xs font-medium px-3 py-1.5 rounded-ctl border border-hairline-strong text-ink-700 hover:border-ink-400 transition-colors duration-fast ease-quiet shrink-0"
        >
          Edit
        </button>
      </div>
    );
  }

  const inputClass = "w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";

  return (
    <div>
      <p className="label-caps mb-3">Edit broker</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">First name</label>
          <input value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Last name</label>
          <input value={last} onChange={(e) => setLast(e.target.value)} className={inputClass} />
        </div>
      </div>
      <label className="block text-[11px] text-ink-500 mb-1">Email (login)</label>
      <input type="email" value={mail} onChange={(e) => setMail(e.target.value)} className={`${inputClass} mb-2`} />
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Mobile</label>
          <input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Office phone</label>
          <input type="tel" value={office} onChange={(e) => setOffice(e.target.value)} className={inputClass} />
        </div>
      </div>
      <label className="block text-[11px] text-ink-500 mb-1">Address</label>
      <textarea rows={2} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Office or mailing address" className={`${inputClass} resize-y mb-2`} />
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Instagram</label>
          <input value={ig} onChange={(e) => setIg(e.target.value)} placeholder="@handle" autoCapitalize="none" spellCheck={false} className={inputClass} />
        </div>
        <div>
          <label className="block text-[11px] text-ink-500 mb-1">Facebook</label>
          <input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="facebook.com/… or page name" autoCapitalize="none" spellCheck={false} className={inputClass} />
        </div>
      </div>
      <label className="block text-[11px] text-ink-500 mb-1">Birthday</label>
      <div className="grid grid-cols-2 gap-2 mb-1">
        <select value={bMonth} onChange={(e) => setBMonth(e.target.value)} className={inputClass} aria-label="Birthday month">
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={bDay} onChange={(e) => setBDay(e.target.value)} className={inputClass} aria-label="Birthday day">
          <option value="">Day</option>
          {Array.from({ length: bMonth ? daysInMonth(Number(bMonth)) : 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <p className="text-[11px] text-ink-500 mb-3">
        The email is what the broker logs in with. Changing it updates their login right away — no re-invite needed.
      </p>
      <label className="block text-[11px] text-ink-500 mb-1">Brokerage name</label>
      <input value={firm} onChange={(e) => setFirm(e.target.value)} className={`${inputClass} mb-2`} />
      <label className="block text-[11px] text-ink-500 mb-1">Brokerage website</label>
      <input type="url" value={site} onChange={(e) => setSite(e.target.value)} className={`${inputClass} mb-1`} />
      <p className="text-[11px] text-ink-500 mb-3">
        This name is what shows on the broker&rsquo;s Reel end card and their branded pages. It is
        stored separately from the brokerage they&rsquo;re linked to on the Brokerages page — moving
        them there sets this too, but if a broker has changed firms you can correct it here.
        Logo and brand colours stay with the broker, on their own profile and reel page.
      </p>
      {error && <p className="text-xs text-danger-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-sm font-medium px-3 py-2 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet">
          Cancel
        </button>
      </div>
    </div>
  );
}
