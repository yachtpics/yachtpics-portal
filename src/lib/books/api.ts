import { NextResponse } from "next/server";
import { isMissingBillingTable } from "./staff";
import { INVOICING_NOT_READY } from "./types";

/** A database error as a response: 503 "not switched on" when the phase 2 tables are missing. */
export function dbError(err: { code?: string; message?: string }): NextResponse {
  if (isMissingBillingTable(err)) return NextResponse.json({ error: INVOICING_NOT_READY, notReady: true }, { status: 503 });
  return NextResponse.json({ error: err.message ?? "Database error" }, { status: 500 });
}

export function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T12:00:00Z"));

/** One CSV cell. Leading = + - @ are prefixed so a spreadsheet never runs them as formulas. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: string[], rows: unknown[][]): string {
  return [head.map(csvCell).join(",")].concat(rows.map((r) => r.map(csvCell).join(","))).join("\r\n") + "\r\n";
}
