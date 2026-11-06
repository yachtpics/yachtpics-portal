import { NextRequest, NextResponse } from "next/server";
import { isBrandKey, requireBillingStaff } from "@/lib/books/staff";
import { dbError, isDate } from "@/lib/books/api";
import { buildDashboard, type RangePreset } from "@/lib/books/reports";
import type { BrandKey } from "@/lib/books/types";

export const runtime = "nodejs";

// GET ?range=month|quarter|year|custom&from=&to=&brand= — this login's totals series + client tables.
export async function GET(req: NextRequest) {
  const auth = await requireBillingStaff();
  if (auth.error) return auth.error;
  const sp = req.nextUrl.searchParams;
  const preset = (["month", "quarter", "year", "custom"].indexOf(sp.get("range") ?? "") !== -1 ? sp.get("range") : "month") as RangePreset;
  const { dash, error } = await buildDashboard(auth.admin, auth.staff, {
    preset,
    from: isDate(sp.get("from")) ? (sp.get("from") as string) : undefined,
    to: isDate(sp.get("to")) ? (sp.get("to") as string) : undefined,
    brand: isBrandKey(sp.get("brand")) && auth.staff.brands.indexOf(sp.get("brand") as BrandKey) !== -1 ? (sp.get("brand") as BrandKey) : "",
  });
  if (error) return dbError(error);
  return NextResponse.json(dash);
}
