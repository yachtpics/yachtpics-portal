import { NextRequest, NextResponse } from "next/server";
import { cleanText, isMissingBillingTable, requireBillingStaff } from "@/lib/books/staff";
import { bad } from "@/lib/books/api";
import { loadProcessor, processorView, type ProcessorRow } from "@/lib/books/onlinePayments";
import { encryptSecret, decryptSecret, secretsKeyConfigured, SECRETS_KEY_MISSING } from "@/lib/books/secrets";
import { paypalToken } from "@/lib/books/paypal";
import { PROCESSORS_NOT_READY, type PaypalEnv, type ProcessorKind } from "@/lib/books/types";

export const runtime = "nodejs";

/**
 * Online payments (20261108b) — the caller's OWN processor row only.
 *
 * GET   → { processor: ProcessorView }
 * PATCH { enabled?, paypal_client_id?, paypal_secret?, paypal_env? } → saves
 *       the caller's row. PayPal credentials are checked with PayPal (an
 *       access token) before anything is saved; the secret is stored AES-GCM
 *       encrypted and never sent back. Which processor a login uses is not
 *       editable here (owner → Stripe platform, others → PayPal, set by the
 *       migration) — moving a login to Stripe is a deliberate change.
 */
function notReady(): NextResponse {
  return NextResponse.json({ error: PROCESSORS_NOT_READY, notReady: true }, { status: 503 });
}

export async function GET() {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const p = await loadProcessor(admin, staff.profileId);
  if (p.state === "not_ready") return notReady();
  if (p.state === "error") return bad(p.message, 500);
  return NextResponse.json({ processor: processorView(p.row, staff.isOwner ? "stripe_platform" : "paypal") });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const { admin, staff } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid request body");

  const p = await loadProcessor(admin, staff.profileId);
  if (p.state === "not_ready") return notReady();
  if (p.state === "error") return bad(p.message, 500);
  const cur: ProcessorRow | null = p.row;
  const kind: ProcessorKind = cur?.processor ?? (staff.isOwner ? "stripe_platform" : "paypal");

  const row: Record<string, unknown> = { profile_id: staff.profileId, processor: kind, updated_at: new Date().toISOString() };
  const touchesPaypal = "paypal_client_id" in body || "paypal_secret" in body || "paypal_env" in body;
  if (touchesPaypal && kind !== "paypal") return bad("This login takes online payments through Stripe — there are no PayPal details to enter.");

  let clientId = cur?.paypal_client_id ?? null;
  let env: PaypalEnv = cur?.paypal_env === "sandbox" ? "sandbox" : "live";
  let secret: string | null = null; // plain, only when a new one was typed
  if ("paypal_client_id" in body) { clientId = cleanText(body.paypal_client_id, 200); row.paypal_client_id = clientId; }
  if ("paypal_env" in body) {
    if (body.paypal_env !== "live" && body.paypal_env !== "sandbox") return bad("Pick Live or Sandbox.");
    env = body.paypal_env;
    row.paypal_env = env;
  }
  if ("paypal_secret" in body && typeof body.paypal_secret === "string" && body.paypal_secret.trim()) {
    if (!secretsKeyConfigured()) return NextResponse.json({ error: SECRETS_KEY_MISSING }, { status: 503 });
    secret = body.paypal_secret.trim().slice(0, 300);
    const enc = encryptSecret(secret);
    if (!enc) return NextResponse.json({ error: SECRETS_KEY_MISSING }, { status: 503 });
    row.paypal_secret_enc = enc;
  }
  if ("enabled" in body) row.enabled = body.enabled === true;
  const enabling = row.enabled === true || (!("enabled" in body) && !!cur?.enabled);

  // PayPal: check the credentials that will be in force (only when they changed or it's being switched on).
  if (kind === "paypal" && (touchesPaypal || row.enabled === true)) {
    const useSecret = secret ?? decryptSecret(cur?.paypal_secret_enc);
    const haveSecret = !!secret || !!cur?.paypal_secret_enc;
    if (enabling && (!clientId || !haveSecret)) return bad("Enter your PayPal Client ID and Secret before switching online payments on.");
    if (clientId && haveSecret) {
      if (!useSecret) {
        return NextResponse.json({ error: secretsKeyConfigured() ? "The saved PayPal secret can't be read — enter it again." : SECRETS_KEY_MISSING }, { status: secretsKeyConfigured() ? 400 : 503 });
      }
      const t = await paypalToken({ clientId, secret: useSecret, env });
      if (!t.ok) {
        return bad(t.status === 401 || t.status === 400
          ? `PayPal didn't accept these details for ${env === "live" ? "Live" : "Sandbox"}. Check the Client ID and Secret, and that they're from the ${env === "live" ? "Live" : "Sandbox"} tab.`
          : "Couldn't reach PayPal to check these details. Try again in a minute.", t.status === 401 || t.status === 400 ? 400 : 502);
      }
    }
  }

  const { error } = await admin.from("billing_payment_processors").upsert(row, { onConflict: "profile_id" });
  if (error) return isMissingBillingTable(error) ? notReady() : bad(error.message, 500);
  const again = await loadProcessor(admin, staff.profileId);
  return NextResponse.json({ ok: true, processor: processorView(again.state === "ok" ? again.row : null, kind) });
}
