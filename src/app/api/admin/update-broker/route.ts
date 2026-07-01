import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { admin } = auth;

  let body: { userId?: string; email?: string; firstName?: string; lastName?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { userId, email, firstName, lastName, phone } = body;
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (!prof) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (prof.role !== "broker") {
    return NextResponse.json({ error: "This account is not a broker." }, { status: 400 });
  }

  const trimmedEmail = typeof email === "string" ? email.trim() : undefined;

  // Update the login (auth) email if provided
  if (trimmedEmail) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
    }
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
      email: trimmedEmail,
      email_confirm: true,
    });
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};
  if (trimmedEmail) {
    update.display_email = trimmedEmail;
    // New address — clear any bounce flag so alerts reset.
    update.email_bounced_at = null;
    update.email_bounce_reason = null;
  }
  if (typeof firstName === "string") update.first_name = firstName.trim() || null;
  if (typeof lastName === "string") update.last_name = lastName.trim() || null;
  if (typeof phone === "string") update.phone = phone.trim() || null;

  if (Object.keys(update).length > 0) {
    const { error: profErr } = await admin.from("profiles").update(update).eq("id", userId);
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
