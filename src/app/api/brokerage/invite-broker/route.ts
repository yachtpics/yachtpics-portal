import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageAdmin, makeTempPassword, inviteEmailHtml } from "@/lib/requireBrokerageAdmin";
import { logEmail } from "@/lib/logEmail";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireBrokerageAdmin();
  if (auth.error) return auth.error;
  const { admin, userId, brokerageId } = auth;

  let body: { firstName?: string; lastName?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const firstName = (body.firstName ?? "").trim();
  const lastName = (body.lastName ?? "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
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
    user_metadata: { role: "broker" },
  });
  if (cErr || !created?.user) {
    return NextResponse.json({ error: cErr?.message ?? "Failed to create account" }, { status: 500 });
  }
  const newId = created.user.id;

  await admin.from("profiles").upsert({
    id: newId,
    role: "broker",
    first_name: firstName || null,
    last_name: lastName || null,
    display_email: email,
    brokerage_id: brokerageId,
    invited_by: userId,
  });

  const { data: bk } = await admin.from("brokerages").select("name").eq("id", brokerageId).single();
  const brokerageName = bk?.name ?? "your brokerage";
  const subject = `Welcome to YachtPics Portal — ${brokerageName}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "YachtPics <hello@yachtpics.com>",
      to: email,
      subject,
      html: inviteEmailHtml({ firstName, brokerageName, email, tempPwd, roleLabel: "broker" }),
    }),
  });

  await logEmail({
    emailType: "broker_invite",
    recipientEmail: email,
    recipientRole: "broker",
    recipientId: newId,
    brokerId: newId,
    subject,
    status: res.ok ? "sent" : "failed",
    sentBy: userId,
    metadata: { brokerageId, viaBrokerageAdmin: true },
  });

  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
  return NextResponse.json({ success: true, broker: { id: newId, name, email }, tempPassword: tempPwd });
}
