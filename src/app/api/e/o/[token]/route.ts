import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/publicSlideshow";
import { isBotUa, recordEmailEvent, requestIp, verifyTrackingToken } from "@/lib/emailTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Open pixel: /api/e/o/{token}.gif. Always returns the GIF, whatever happens. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const id = verifyTrackingToken(params.token.replace(/\.gif$/i, ""));
  const ua = req.headers.get("user-agent");
  if (id && !isBotUa(ua)) {
    await recordEmailEvent(serviceClient(), id, "open", { ua, ip: requestIp(req.headers) });
  }
  return new NextResponse(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
