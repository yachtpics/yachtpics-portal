import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin, makeTempPassword, inviteEmailHtml } from "@/lib/requireBrokerageAdmin";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  const { admin, userId, brokerageId } = auth;

  let body: { firstName?: string; lastName?: string; email?: string; brokerId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  const brokerId = body.brokerId?.trim() || null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  // If linking to a broker, that broker must be in this brokerage
  if (brokerId) {
    const { data: b } = await admin.from("profiles").select("role, brokerage_id").eq("id", brokerId).single();
    if (!b || b.role !== "broker" || b.brokerage_id !== brokerageId) {
      return NextResponse.json({ error: "That broker isn't in your brokerage." }, { status: 400 });
    }
  }

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (list?.users?.some((u) => u.email?.toLowerCase() === email.toLowerCase())) {
    return NextResponse.json({ error: "An account with that email already exists. Ask YachtPics to add them to your brokerage." }, { status: 409 });
  }

  const tempPwd = makeTempPassword();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password: tempPwd,
    email_confirm: true,
    user_metadata: { role: "assistant" },
  });
  if (cErr || !created?.user) {
    return NextResponse.json({ error: cErr?.message ?? "Failed to create account" }, { status: 500 });
  }
  const newId = created.user.id;

  await admin.from("profiles").upsert({
    id: newId,
    role: "assistant",
    first_name: firstName || null,
    last_name: lastName || null,
    display_email: email,
    brokerage_id: brokerageId,
  });

  if (brokerId) {
    await admin.from("broker_assistants").upsert(
      { broker_id: brokerId, assistant_id: newId },
      { onConflict: "broker_id,assistant_id" }
    );
  }

  const { data: bk } = await admin.from("brokerages").select("name").eq("id", brokerageId).single();
  const brokerageName = bk?.name ?? "your brokerage";
  const subject = `You've been set up on YachtPics Portal — ${brokerageName}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "YachtPics <hello@yachtpics.com>",
      to: email,
      subject,
      html: inviteEmailHtml({ firstName, brokerageName, email, tempPwd, roleLabel: "assistant" }),
    }),
  });

  await logEmail({
    emailType: "assistant_invite",
    recipientEmail: email,
    recipientRole: "assistant",
    recipientId: newId,
    subject,
    status: res.ok ? "sent" : "failed",
    sentBy: userId,
    metadata: { brokerageId, viaBrokerageAdmin: true },
  });

  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
  return NextResponse.json({ success: true, assistant: { id: newId, name, email }, tempPassword: tempPwd });
}
