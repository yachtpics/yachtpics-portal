/**
 * PayPal Orders v2 — just what Pay online needs: an access token from the
 * login's own client id + secret, create an order, capture it, read it back.
 * Server only. Credentials are passed in per call (each login has its own
 * PayPal account); nothing here logs them.
 */
import type { PaypalEnv } from "./types";

export type PaypalCreds = { clientId: string; secret: string; env: PaypalEnv };

export function paypalBase(env: PaypalEnv): string {
  return env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

type PaypalResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; issue: string | null };

async function readError(res: Response): Promise<{ message: string; issue: string | null }> {
  const j = (await res.json().catch(() => null)) as { message?: string; error_description?: string; details?: { issue?: string; description?: string }[] } | null;
  const issue = j?.details && j.details[0] ? j.details[0].issue ?? null : null;
  const message = (j?.details && j.details[0]?.description) || j?.message || j?.error_description || `PayPal said ${res.status}.`;
  return { message, issue };
}

export async function paypalToken(c: PaypalCreds): Promise<PaypalResult<string>> {
  try {
    const res = await fetch(`${paypalBase(c.env)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) {
      const e = await readError(res);
      return { ok: false, status: res.status, message: e.message, issue: e.issue };
    }
    const j = (await res.json()) as { access_token?: string };
    if (!j.access_token) return { ok: false, status: 502, message: "PayPal didn't return an access token.", issue: null };
    return { ok: true, data: j.access_token };
  } catch (e) {
    return { ok: false, status: 502, message: e instanceof Error ? e.message : "Couldn't reach PayPal.", issue: null };
  }
}

export type PaypalCapture = { id: string; status: string; amount: { value: string; currency_code: string } };
export type PaypalOrder = {
  id: string;
  status: string;
  links?: { href: string; rel: string }[];
  purchase_units?: { reference_id?: string; amount?: { value: string; currency_code: string }; payments?: { captures?: PaypalCapture[] } }[];
};

async function call<T>(c: PaypalCreds, path: string, method: "GET" | "POST", body?: unknown, requestId?: string): Promise<PaypalResult<T>> {
  const t = await paypalToken(c);
  if (!t.ok) return t;
  try {
    const res = await fetch(`${paypalBase(c.env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${t.data}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const e = await readError(res);
      return { ok: false, status: res.status, message: e.message, issue: e.issue };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, status: 502, message: e instanceof Error ? e.message : "Couldn't reach PayPal.", issue: null };
  }
}

export function createPaypalOrder(
  c: PaypalCreds,
  o: { invoiceId: string; amount: number; description: string; brandName: string; returnUrl: string; cancelUrl: string }
): Promise<PaypalResult<PaypalOrder>> {
  return call<PaypalOrder>(c, "/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: o.invoiceId,
      custom_id: o.invoiceId,
      description: o.description.slice(0, 127),
      amount: { currency_code: "USD", value: o.amount.toFixed(2) },
    }],
    application_context: {
      return_url: o.returnUrl,
      cancel_url: o.cancelUrl,
      brand_name: o.brandName.slice(0, 127),
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
    },
  });
}

/** Capture an approved order. PayPal-Request-Id = order id, so a repeat is answered, not re-run. */
export function capturePaypalOrder(c: PaypalCreds, orderId: string): Promise<PaypalResult<PaypalOrder>> {
  return call<PaypalOrder>(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "POST", {}, `capture-${orderId}`);
}

export function getPaypalOrder(c: PaypalCreds, orderId: string): Promise<PaypalResult<PaypalOrder>> {
  return call<PaypalOrder>(c, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, "GET");
}

/** The approve link the buyer is sent to. */
export function approveLink(o: PaypalOrder): string | null {
  const l = (o.links ?? []).filter((x) => x.rel === "approve" || x.rel === "payer-action")[0];
  return l ? l.href : null;
}

/** The first capture on the order, if any. */
export function firstCapture(o: PaypalOrder): PaypalCapture | null {
  const pu = (o.purchase_units ?? [])[0];
  const caps = pu?.payments?.captures ?? [];
  return caps[0] ?? null;
}
