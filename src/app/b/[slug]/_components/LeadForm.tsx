"use client";

import { useState } from "react";
import { CONTACT_PREFS, INQUIRY_TYPES, type LeadKind } from "@/lib/brokerSite";

/**
 * The website's forms — showing request, contact, valuation — posting to
 * /api/b/[slug]/lead. Email OR phone is required (checked here and on the
 * server). A hidden "company_website" field is the honeypot.
 */

const input =
  "w-full min-h-[44px] bg-[var(--site-field)] border border-[var(--site-field-border)] text-[var(--site-ink)] placeholder:text-[var(--site-muted)] rounded-ctl px-3.5 py-2.5 text-[0.9375rem] focus:outline-none focus:border-[var(--site-accent)] focus:ring-1 focus:ring-[var(--site-accent)] transition-colors duration-fast";
const label = "block text-[0.6875rem] font-semibold uppercase tracking-caps text-[var(--site-muted)] mb-1.5";

export default function LeadForm({
  slug,
  kind,
  listingId,
  boatLabel,
  firstName,
  onDone,
  submitLabel,
}: {
  slug: string;
  kind: LeadKind;
  listingId?: string;
  boatLabel?: string;
  firstName: string;
  onDone?: () => void;
  submitLabel?: string;
}) {
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
    contact_pref: "",
    inquiry_type: "",
    builder: "",
    model: "",
    year: "",
    length: "",
    company_website: "",
  });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.name.trim()) return setError("Please add your name.");
    if (!f.email.trim() && f.phone.replace(/\D/g, "").length < 7) return setError("Please add an email or a phone number.");
    if (kind === "valuation" && !f.builder.trim() && !f.model.trim()) return setError("Please add the builder or model.");
    setState("sending");
    try {
      const res = await fetch(`/api/b/${encodeURIComponent(slug)}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          listing_id: listingId,
          name: f.name,
          email: f.email,
          phone: f.phone,
          message: f.message,
          contact_pref: f.contact_pref,
          inquiry_type: f.inquiry_type,
          boat: kind === "valuation" ? { builder: f.builder, model: f.model, year: f.year, length: f.length } : undefined,
          company_website: f.company_website,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("Couldn't send — check your connection and try again.");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div className="py-6" role="status">
        <p className="text-[var(--site-ink)] text-lg font-medium">Thank you — your message is on its way.</p>
        <p className="text-[var(--site-muted)] text-[0.9375rem] mt-2">{firstName ? `${firstName} will be in touch shortly.` : "You'll hear back shortly."}</p>
        {onDone && (
          <button type="button" onClick={onDone} className="mt-6 min-h-[44px] px-5 rounded-ctl border border-[var(--site-field-border)] text-sm font-medium text-[var(--site-ink)] hover:bg-[var(--site-surface)] transition-colors duration-fast">
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {boatLabel && (
        <p className="text-[var(--site-muted)] text-[0.9375rem]">
          <span className="text-[var(--site-muted)]">Yacht · </span>
          {boatLabel}
        </p>
      )}

      {/* Honeypot — hidden from people and screen readers. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto w-px h-px overflow-hidden">
        <label>
          Company website
          <input tabIndex={-1} autoComplete="off" value={f.company_website} onChange={set("company_website")} />
        </label>
      </div>

      {kind === "valuation" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor={`${kind}-builder`}>Builder</label>
            <input id={`${kind}-builder`} className={input} value={f.builder} onChange={set("builder")} autoComplete="off" maxLength={60} />
          </div>
          <div>
            <label className={label} htmlFor={`${kind}-model`}>Model</label>
            <input id={`${kind}-model`} className={input} value={f.model} onChange={set("model")} autoComplete="off" maxLength={60} />
          </div>
          <div>
            <label className={label} htmlFor={`${kind}-year`}>Year</label>
            <input id={`${kind}-year`} className={input} value={f.year} onChange={set("year")} inputMode="numeric" maxLength={4} />
          </div>
          <div>
            <label className={label} htmlFor={`${kind}-length`}>Length (ft)</label>
            <input id={`${kind}-length`} className={input} value={f.length} onChange={set("length")} inputMode="decimal" maxLength={8} />
          </div>
        </div>
      )}

      <div>
        <label className={label} htmlFor={`${kind}-name`}>Name</label>
        <input id={`${kind}-name`} className={input} value={f.name} onChange={set("name")} autoComplete="name" maxLength={120} required />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor={`${kind}-email`}>Email</label>
          <input id={`${kind}-email`} type="email" className={input} value={f.email} onChange={set("email")} autoComplete="email" maxLength={160} />
        </div>
        <div>
          <label className={label} htmlFor={`${kind}-phone`}>Phone</label>
          <input id={`${kind}-phone`} type="tel" className={input} value={f.phone} onChange={set("phone")} autoComplete="tel" maxLength={40} />
        </div>
      </div>

      {kind === "contact" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="contact-type">I&rsquo;m interested in</label>
            <select id="contact-type" className={input} value={f.inquiry_type} onChange={set("inquiry_type")}>
              <option value="">Choose…</option>
              {INQUIRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="contact-pref">Best way to reach me</label>
            <select id="contact-pref" className={input} value={f.contact_pref} onChange={set("contact_pref")}>
              <option value="">Any</option>
              {CONTACT_PREFS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
      )}
      {kind !== "contact" && (
        <div>
          <label className={label} htmlFor={`${kind}-pref`}>Best way to reach me</label>
          <select id={`${kind}-pref`} className={input} value={f.contact_pref} onChange={set("contact_pref")}>
            <option value="">Any</option>
            {CONTACT_PREFS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className={label} htmlFor={`${kind}-message`}>{kind === "showing" ? "When suits you?" : "Message"}</label>
        <textarea id={`${kind}-message`} rows={4} className={input + " resize-y"} value={f.message} onChange={set("message")} maxLength={2000} />
      </div>

      {error && <p className="text-danger-600 text-sm" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full sm:w-auto min-h-[48px] px-7 rounded-ctl bg-[var(--site-accent)] text-[var(--site-on-accent)] text-[0.9375rem] font-semibold tracking-wide hover:opacity-90 disabled:opacity-50 transition-opacity duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--site-ink)] focus-visible:ring-offset-[var(--site-bg)]"
      >
        {state === "sending" ? "Sending…" : submitLabel ?? "Send"}
      </button>
    </form>
  );
}
