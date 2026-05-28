import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `Portal-${suffix}`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      firstName, lastName, email, brokerage, photosReady,
      assistantEmail, assistantFirstName, assistantLastName,
      vesselName, vesselType, year, lengthFt, make, model, askingPrice, location,
      createListing,
    } = await req.json();

    if (!firstName || !lastName || !email) {
      return NextResponse.json({ error: "First name, last name, and email are required." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Create broker account with temp password

    const brokerTempPassword = generateTempPassword();

    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: brokerTempPassword,
      email_confirm: true,
    });

    if (createError || !userData?.user) {
      return NextResponse.json({ error: createError?.message ?? "Failed to create broker account." }, { status: 500 });
    }

    const brokerId = userData.user.id;
    const loginLink = "https://portal.yachtpics.com/auth/login";

    const { error: profileError } = await supabase.from("profiles").upsert(
      { id: brokerId, role: "broker", first_name: firstName, last_name: lastName, display_email: email },
      { onConflict: "id" }
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (brokerage?.trim()) {
      await supabase.from("broker_details").upsert({
        id: brokerId,
        brokerage_name: brokerage.trim(),
      });
    }

    // 2. Create listing (service role bypasses RLS)

    let listingId: string | null = null;

    if (createListing) {
      const { data: listing, error: listingError } = await supabase
        .from("listings")
        .insert({
          broker_id: brokerId,
          vessel_name: vesselName || null,
          vessel_type: vesselType || null,
          year: year ?? null,
          length_ft: lengthFt ?? null,
          make: make || null,
          model: model || null,
          asking_price: askingPrice ?? null,
          location: location || null,
          status: "active",
        })
        .select("id")
        .single();

      if (listingError || !listing) {
        return NextResponse.json({ error: listingError?.message ?? "Failed to create listing." }, { status: 500 });
      }
      listingId = listing.id;
    }

    // 3. Handle optional assistant

    let assistantId: string | null = null;
    let assistantTempPassword: string | undefined;

    if (assistantEmail?.trim()) {
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const existingUser = users.find(u => u.email?.toLowerCase() === assistantEmail.toLowerCase());

      if (existingUser) {
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", existingUser.id)
          .single();

        if (existingProfile?.role === "broker" || existingProfile?.role === "admin") {
          return NextResponse.json(
            { error: `The assistant email (${assistantEmail}) belongs to a broker or admin account.` },
            { status: 400 }
          );
        }

        assistantId = existingUser.id;

        await supabase.from("profiles").upsert({
          id: assistantId,
          role: "assistant",
          display_email: assistantEmail,
          ...(assistantFirstName ? { first_name: assistantFirstName } : {}),
          ...(assistantLastName ? { last_name: assistantLastName } : {}),
        });

        const hasVessel = vesselName?.trim();
        const notifyHtml = [
          "<!DOCTYPE html>",
          "<html>",
          "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
          "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;\">",
          "  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);\">",
          "    <div style=\"background:#050b14;padding:32px 40px;\">",
          "      <p style=\"margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;\">YachtPics <span style=\"color:#d4a843;\">Portal</span></p>",
          "    </div>",
          "    <div style=\"padding:40px;\">",
          `      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Photos are in for ${firstName} ${lastName}</h1>`,
          `      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${hasVessel ? `The photos for <strong style="color:#111827;">${vesselName}</strong> are uploaded and ready in ${firstName}'s portal.` : `The photos for <strong style="color:#111827;">${firstName} ${lastName}</strong> are uploaded and ready in their portal.`} Their account has been created.</p>`,
          "      <a href=\"https://portal.yachtpics.com/dashboard\" style=\"display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;\">Go to Portal &rarr;</a>",
          "    </div>",
          "    <div style=\"padding:24px 40px;border-top:1px solid #f3f4f6;\">",
          "      <p style=\"margin:0;font-size:12px;color:#c4c9d4;\">Powered by <a href=\"https://yachtpics.com\" style=\"color:#c4c9d4;text-decoration:none;\">YachtPics</a></p>",
          "    </div>",
          "  </div>",
          "</body>",
          "</html>",
        ].join("\n");

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "YachtPics <hello@yachtpics.com>",
            to: assistantEmail,
            subject: `Photos ready — ${firstName} ${lastName}${hasVessel ? `, ${vesselName}` : ""}`,
            html: notifyHtml,
          }),
        });

      } else {
        // New assistant — create account with temp password
        const assistantTempPwd = generateTempPassword();
        assistantTempPassword = assistantTempPwd;

        const { data: assistantUserData, error: assistantCreateError } = await supabase.auth.admin.createUser({
          email: assistantEmail,
          password: assistantTempPwd,
          email_confirm: true,
        });

        if (assistantCreateError || !assistantUserData?.user) {
          return NextResponse.json({ error: assistantCreateError?.message ?? "Failed to create assistant account." }, { status: 500 });
        }

        assistantId = assistantUserData.user.id;

        await supabase.from("profiles").upsert({
          id: assistantId,
          role: "assistant",
          display_email: assistantEmail,
          ...(assistantFirstName ? { first_name: assistantFirstName } : {}),
          ...(assistantLastName ? { last_name: assistantLastName } : {}),
        });

        const hasVessel = vesselName?.trim();
        const assistantHtml = [
          "<!DOCTYPE html>",
          "<html>",
          "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
          "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;\">",
          "  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);\">",
          "    <div style=\"background:#050b14;padding:32px 40px;\">",
          "      <p style=\"margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;\">YachtPics <span style=\"color:#d4a843;\">Portal</span></p>",
          "    </div>",
          "    <div style=\"padding:40px;\">",
          "      <h1 style=\"margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;\">You've been set up as an assistant</h1>",
          `      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">You've been added to YachtPics Portal to manage listings for <strong style="color:#111827;">${firstName} ${lastName}</strong>. ${hasVessel ? `The photos for <strong style="color:#111827;">${vesselName}</strong> are already uploaded and waiting.` : "Their portal account is ready to go."}</p>`,
          "      <div style=\"background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
          "        <p style=\"margin:0 0 12px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;\">Your Login Details</p>",
          "        <p style=\"margin:0 0 6px;font-size:13px;color:#6b7280;\"><strong style=\"color:#111827;\">Login:</strong> portal.yachtpics.com/auth/login</p>",
          `        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${assistantEmail}</p>`,
          `        <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${assistantTempPwd}</span></p>`,
          "      </div>",
          "      <a href=\"https://portal.yachtpics.com/auth/login\" style=\"display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:20px;\">Log In to Your Account &rarr;</a>",
          "      <p style=\"margin:0;font-size:13px;color:#9ca3af;line-height:1.6;\">Once logged in, you can update your password from your profile settings. If you were not expecting this, you can safely ignore this email.</p>",
          "    </div>",
          "    <div style=\"padding:24px 40px;border-top:1px solid #f3f4f6;\">",
          "      <p style=\"margin:0;font-size:12px;color:#c4c9d4;\">Powered by <a href=\"https://yachtpics.com\" style=\"color:#c4c9d4;text-decoration:none;\">YachtPics</a></p>",
          "    </div>",
          "  </div>",
          "</body>",
          "</html>",
        ].join("\n");

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "YachtPics <hello@yachtpics.com>",
            to: assistantEmail,
            subject: `You've been set up as an assistant — ${firstName} ${lastName}`,
            html: assistantHtml,
          }),
        });
      }

      // Link assistant to broker
      await supabase.from("broker_assistants").upsert(
        { broker_id: brokerId, assistant_id: assistantId },
        { onConflict: "broker_id,assistant_id" }
      );
    }

    // 4. Send broker invite email

    const brokerFirst = firstName;
    const hasVessel = vesselName?.trim();

    const photosReadyBlock = hasVessel && photosReady
      ? [
          "<div style=\"background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
          "  <p style=\"margin:0 0 6px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;\">Photos Ready</p>",
          `  <p style="margin:0;font-size:15px;color:#111827;line-height:1.5;">Your professional photos for <strong>${vesselName}</strong> are ready and waiting in your portal. Once you log in, head to your listings to view, download, and share them.</p>`,
          "</div>",
        ].join("\n")
      : hasVessel && !photosReady
      ? [
          "<div style=\"background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
          "  <p style=\"margin:0 0 6px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;\">Photos Coming Soon</p>",
          `  <p style="margin:0;font-size:15px;color:#111827;line-height:1.5;">We're processing your photos for <strong>${vesselName}</strong>. You'll find them in your portal once they're ready.</p>`,
          "</div>",
        ].join("\n")
      : "";

    const subheading = hasVessel && photosReady
      ? `Your YachtPics Portal account is set up and your photos for <strong style="color:#111827;">${vesselName}</strong> are ready to view.`
      : hasVessel
      ? `Your YachtPics Portal account is set up. We're working on your photos for <strong style="color:#111827;">${vesselName}</strong>.`
      : "Your YachtPics Portal account has been created. Use the login details below to get started.";

    const html = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>",
      "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;\">",
      "  <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);\">",
      "    <div style=\"background:#050b14;padding:32px 40px;\">",
      "      <p style=\"margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;\">YachtPics <span style=\"color:#d4a843;\">Portal</span></p>",
      "    </div>",
      "    <div style=\"padding:40px;\">",
      `      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Welcome, ${brokerFirst}</h1>`,
      `      <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${subheading}</p>`,
      `      ${photosReadyBlock}`,
      "      <div style=\"background:#f9f5ec;border:1px solid #e8d9a0;border-radius:10px;padding:20px 24px;margin:0 0 28px;\">",
      "        <p style=\"margin:0 0 12px;font-size:13px;font-weight:600;color:#92721a;text-transform:uppercase;letter-spacing:0.5px;\">Your Login Details</p>",
      `        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Login:</strong> portal.yachtpics.com/auth/login</p>`,
      `        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Email:</strong> ${email}</p>`,
      `        <p style="margin:0;font-size:13px;color:#6b7280;"><strong style="color:#111827;">Temporary password:</strong> <span style="font-family:monospace;font-size:14px;color:#111827;">${brokerTempPassword}</span></p>`,
      "      </div>",
      `      <a href="${loginLink}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;margin-bottom:20px;">Log In to Your Portal &rarr;</a>`,
      "      <p style=\"margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6;\">Use the temporary password above to log in, then update it from your profile settings whenever you like.</p>",
      "      <p style=\"margin:0;font-size:13px;color:#9ca3af;line-height:1.6;\">From your portal you can view and download your photos, share a professional slideshow with clients, manage your listings, and track who's viewing your content.</p>",
      "    </div>",
      "    <div style=\"padding:24px 40px;border-top:1px solid #f3f4f6;\">",
      "      <p style=\"margin:0;font-size:12px;color:#c4c9d4;\">Powered by <a href=\"https://yachtpics.com\" style=\"color:#c4c9d4;text-decoration:none;\">YachtPics</a></p>",
      "    </div>",
      "  </div>",
      "</body>",
      "</html>",
    ].join("\n");

    const subject = hasVessel && photosReady
      ? `Your photos are ready — ${vesselName}`
      : hasVessel
      ? `Your YachtPics Portal is ready — ${vesselName} photos coming soon`
      : "Welcome to YachtPics Portal";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: email,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      return NextResponse.json(
        { error: `Account created but email failed: ${errBody}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      brokerId,
      listingId,
      assistantId,
      brokerTempPassword,
      ...(assistantTempPassword ? { assistantTempPassword } : {}),
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
