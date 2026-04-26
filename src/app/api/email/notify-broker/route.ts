import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const { listingId } = await req.json();
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: listing, error } = await supabase
      .from("listings")
      .select("id, vessel_name, location, broker_id, profiles(first_name, last_name, display_email)")
      .eq("id", listingId)
      .single();

    if (error || !listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const profile = listing.profiles as { first_name: string | null; last_name: string | null; display_email: string | null } | null;
    const brokerEmail = profile?.display_email;
    const brokerName = profile?.first_name ? `${profile.first_name} ${profile.last_name ?? ""}`.trim() : "there";
    const vesselName = listing.vessel_name ?? "your vessel";
    const portalUrl = `https://yachtpics-portal.vercel.app/dashboard/listings/${listing.id}`;

    if (!brokerEmail) return NextResponse.json({ error: "Broker has no email on file" }, { status: 400 });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);"><div style="background:#050b14;padding:32px 40px;"><p style="margin:0;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:0.5px;">YachtPics <span style="color:#d4a843;">Portal</span></p></div><div style="padding:40px;"><h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">Your photos are ready, ${brokerName}</h1><p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">Your professional photos for <strong style="color:#111827;">${vesselName}</strong> have been delivered and are available in your portal.</p><p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">You can view, download, and share them with clients directly from your listing.</p><a href="${portalUrl}" style="display:inline-block;background:#d4a843;color:#050b14;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px;">View Your Photos &rarr;</a></div><div style="padding:24px 40px;border-top:1px solid #f3f4f6;"><p style="margin:0;font-size:13px;color:#9ca3af;">YachtPics &middot; Professional Yacht Photography<br>Questions? Reply to this email or visit <a href="https://yachtpics.com" style="color:#d4a843;">yachtpics.com</a></p></div></div></body></html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "YachtPics <hello@yachtpics.com>",
        to: brokerEmail,
        subject: `Your photos for ${vesselName} are ready`,
        html,
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) return NextResponse.json({ error: resendData.message ?? "Failed to send" }, { status: 500 });

    return NextResponse.json({ success: true, emailId: resendData.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
