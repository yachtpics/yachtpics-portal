"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { PaypalEnv, ProcessorView } from "@/lib/books/types";
import { booksCall, fieldClass } from "./booksApi";

/**
 * Settings → Online payments. Each login sees and edits ONLY its own
 * processor. Stripe (the owner): nothing to enter, just on/off. PayPal: the
 * login's own Client ID + Secret (write-only), Live/Sandbox, on/off.
 * `processor` = null until migration 20261108b is applied.
 */
export default function OnlinePaymentSettings({ processor }: { processor: ProcessorView | null }) {
  return (
    <Card>
      <CardHeader
        title="Online payments"
        kicker="Your account"
        description="Adds a Pay online button to your invoices. The client pays the balance due; the payment is recorded on the invoice and they get a receipt."
      />
      <CardBody className="space-y-4">
        {!processor ? (
          <p className="text-sm text-ink-600">Online payments aren&apos;t switched on yet — the 20261108b billing migration hasn&apos;t been added to the database.</p>
        ) : processor.processor === "stripe_platform" ? (
          <StripeBody p={processor} />
        ) : (
          <PaypalBody p={processor} />
        )}
      </CardBody>
    </Card>
  );
}

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (body: Record<string, unknown>, okText = "Saved.") => {
    setBusy(true);
    setMsg(null);
    const r = await booksCall("/api/admin/books/processor", "PATCH", body);
    setBusy(false);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: okText });
    if (!r.error) router.refresh();
    return !r.error;
  };
  return { busy, msg, save };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm ${msg.ok ? "text-success-700" : "text-danger-700"}`}>{msg.text}</p>;
}

function StripeBody({ p }: { p: ProcessorView }) {
  const { busy, msg, save } = useSave();
  const [enabled, setEnabled] = useState(p.enabled);
  return (
    <>
      <p className="text-sm text-ink-900">
        <span className="font-medium">Stripe (YachtPics account)</span> — <span className="text-success-700">connected</span>
      </p>
      <p className="text-small text-ink-500">Clients pay by card or US bank account. Money goes to the YachtPics Stripe account. Bank payments take a few business days to clear; the invoice updates when they do.</p>
      <label className="inline-flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" className="h-4 w-4 accent-[#c39e4e]" checked={enabled} disabled={busy}
          onChange={async (e) => { const v = e.target.checked; setEnabled(v); if (!(await save({ enabled: v }, v ? "Pay online is on." : "Pay online is off."))) setEnabled(!v); }} />
        Show Pay online on my invoices
      </label>
      <Msg msg={msg} />
    </>
  );
}

function PaypalBody({ p }: { p: ProcessorView }) {
  const { busy, msg, save } = useSave();
  const [clientId, setClientId] = useState(p.paypalClientId ?? "");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState<PaypalEnv>(p.paypalEnv);
  const [enabled, setEnabled] = useState(p.enabled);
  const dirty = clientId !== (p.paypalClientId ?? "") || !!secret || env !== p.paypalEnv || enabled !== p.enabled;

  const submit = async () => {
    const body: Record<string, unknown> = { enabled };
    if (clientId !== (p.paypalClientId ?? "")) body.paypal_client_id = clientId;
    if (env !== p.paypalEnv) body.paypal_env = env;
    if (secret) body.paypal_secret = secret;
    if (await save(body)) setSecret("");
  };

  return (
    <>
      <p className="text-sm text-ink-900">
        <span className="font-medium">PayPal</span> — your own business account ·{" "}
        {p.enabled ? <span className="text-success-700">on</span> : <span className="text-ink-500">off</span>}
      </p>
      {!p.keyConfigured && (
        <p className="rounded-card border border-warn-200 bg-warn-50 px-4 py-2.5 text-sm text-warn-700">
          The PayPal secret can&apos;t be saved yet: BILLING_SECRETS_KEY is not set on Vercel. Ask Charlie to add it.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block sm:col-span-2">
          <span className="label-caps">Client ID</span>
          <input className={fieldClass + " mt-1 font-mono text-xs"} value={clientId} autoComplete="off" spellCheck={false}
            onChange={(e) => setClientId(e.target.value.trim())} placeholder="Starts with A…" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label-caps">Secret</span>
          <input type="password" className={fieldClass + " mt-1 font-mono text-xs"} value={secret} autoComplete="new-password" spellCheck={false}
            onChange={(e) => setSecret(e.target.value)} placeholder={p.secretSaved ? "•••••••••••• saved — type a new one to replace it" : "Paste your PayPal secret"} />
        </label>
        <label className="block">
          <span className="label-caps">Account</span>
          <select className={fieldClass + " mt-1"} value={env} onChange={(e) => setEnv(e.target.value === "sandbox" ? "sandbox" : "live")}>
            <option value="live">Live (real payments)</option>
            <option value="sandbox">Sandbox (testing only)</option>
          </select>
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" className="h-4 w-4 accent-[#c39e4e]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Show Pay online on my invoices
      </label>
      <div className="rounded-card border border-hairline bg-ink-50 px-4 py-3 text-small text-ink-600">
        <p className="font-medium text-ink-800 mb-1">Where to find these</p>
        <p>PayPal Developer Dashboard (developer.paypal.com, log in with your PayPal business account) → Apps &amp; Credentials → Live → Create App → copy the Client ID and Secret.</p>
        <p className="mt-1">Saving checks the details with PayPal first. Clients pay with PayPal or a card; the money goes straight to your PayPal account.</p>
      </div>
      <Msg msg={msg} />
      <Button size="sm" onClick={submit} disabled={busy || !dirty}>{busy ? "Checking with PayPal…" : dirty ? "Save online payments" : "Saved"}</Button>
    </>
  );
}
