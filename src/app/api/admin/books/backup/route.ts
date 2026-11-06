import { NextResponse } from "next/server";
import { requireBillingStaff } from "@/lib/books/staff";
import { bad } from "@/lib/books/api";
import { backupZip, dumpForOwner } from "@/lib/books/backup";
import { todayET } from "@/lib/books/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET — owner only: zip of CSVs (shared tables + the owner's own book).
export async function GET() {
  const auth = await requireBillingStaff({ ownerOnly: true });
  if (auth.error) return auth.error;
  try {
    const zip = await backupZip(await dumpForOwner(auth.admin, auth.staff.profileId));
    return new NextResponse(Buffer.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="billing-backup-${todayET()}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
