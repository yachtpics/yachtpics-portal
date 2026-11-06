#!/usr/bin/env node
/*
 * Billing (Portal) phase 1 — builds the Zoho seed for the item catalog and
 * the shared client list.
 *
 *   node scripts/books-build-seed.js
 *
 * Reads   Claude outputs/billing-import/zoho-rate-items.csv
 *         Claude outputs/billing-import/zoho-clients.csv
 * Writes  Claude outputs/billing-import/seed.sql
 *
 * That folder holds client personal data and is NEVER committed. seed.sql is
 * two calls to the import functions from 20261106_billing_foundation.sql
 * (billing_import_items / billing_import_clients), the same functions the
 * Settings tab's "Re-pull from Zoho CSV" upload uses, so re-running either is
 * safe: see the re-run rule in the migration.
 *
 * The mapping below must stay identical to src/lib/books/zohoCsv.ts.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "Claude outputs", "billing-import");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return rows.map((r) => {
    const o = {};
    head.forEach((h, k) => { o[h] = (r[k] || "").trim(); });
    return o;
  });
}

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
const brandOf = (s) => ({ yachtpics: "yachtpics", ypdesigns: "ypdesigns", both: "both" })[norm(s).replace(/\s/g, "")] || "yachtpics";

function kindOf(name, description, rate) {
  const t = norm(name + " " + description);
  if (/credit card fee/.test(t)) return "card_fee";
  if (/deposit/.test(norm(name))) return "deposit";
  if (/discount/.test(norm(name))) return "discount";
  if (/reimburse|airfare|hotel|parking|toll|transportation|shipping/.test(t)) return "reimbursement";
  if (rate < 0) return "discount";
  return "standard";
}

function mapItem(r) {
  const rate = Number(r.rate || 0) || 0;
  const taxable = norm(r.taxable) === "yes" || norm(r.taxable) === "true";
  const ex = norm(r.zoho_exemption);
  return {
    zoho_item_id: r.zoho_item_id,
    name: r.name,
    description: r.description || null,
    rate,
    unit: norm(r.unit) === "ft" ? "ft" : "each", // Zoho blank and "1" both mean each
    kind: kindOf(r.name, r.description, rate),
    taxable,
    tax_exempt_reason: taxable ? null : ex === "digital download" ? "Digital Download" : ex ? "Tax Exempt" : null,
    brand: brandOf(r.suggested_brand),
  };
}

function mapClient(r) {
  const bal = Number(r.outstanding_receivable_amount || 0);
  return {
    zoho_contact_id: r.contact_id,
    display_name: r.contact_name,
    company_name: r.company_name || null,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    email: r.email ? r.email.trim().toLowerCase() : null,
    phone: r.phone || null,
    mobile: r.mobile || null,
    status: norm(r.status) === "inactive" ? "inactive" : "active",
    zoho_open_balance: isFinite(bal) ? bal : 0,
    zoho_created_on: /^\d{4}-\d{2}-\d{2}$/.test(r.created_date) ? r.created_date : null,
    zoho_merged_ids: [],
  };
}

/** Exact duplicates only: same normalized name AND same normalized email. Earliest wins. */
function mergeExact(clients) {
  const byKey = {};
  const out = [];
  let merged = 0;
  const sorted = clients.slice().sort((a, b) =>
    (a.zoho_created_on || "9999") < (b.zoho_created_on || "9999") ? -1
      : (a.zoho_created_on || "9999") > (b.zoho_created_on || "9999") ? 1
      : a.zoho_contact_id < b.zoho_contact_id ? -1 : 1);
  sorted.forEach((c) => {
    if (!c.email) { out.push(c); return; }
    const key = norm(c.display_name) + "|" + norm(c.email);
    const keep = byKey[key];
    if (!keep) { byKey[key] = c; out.push(c); return; }
    merged++;
    keep.zoho_merged_ids.push(c.zoho_contact_id);
    ["company_name", "first_name", "last_name", "phone", "mobile"].forEach((f) => { if (!keep[f] && c[f]) keep[f] = c[f]; });
    keep.zoho_open_balance = Math.round((keep.zoho_open_balance + c.zoho_open_balance) * 100) / 100;
    if (c.status === "active") keep.status = "active";
  });
  return { clients: out, merged };
}

function possibleDupeGroups(clients) {
  const by = (fn) => {
    const m = {};
    clients.forEach((c) => { const k = fn(c); if (k) (m[k] = m[k] || []).push(c.zoho_contact_id); });
    return Object.keys(m).filter((k) => m[k].length > 1).map((k) => m[k]);
  };
  return { byName: by((c) => norm(c.display_name)), byEmail: by((c) => norm(c.email)) };
}

function dollarQuote(json) {
  let tag = "zoho";
  while (json.indexOf("$" + tag + "$") !== -1) tag += "x";
  return "$" + tag + "$" + json + "$" + tag + "$";
}

/** One row per Zoho id (the import's ON CONFLICT can't touch a row twice). */
function uniqueBy(rows, key) {
  const seen = {};
  return rows.filter((r) => (seen[r[key]] ? false : (seen[r[key]] = true)));
}

function main() {
  const items = parseCsv(fs.readFileSync(path.join(DIR, "zoho-rate-items.csv"), "utf8")).filter((r) => r.zoho_item_id && r.name).map(mapItem);
  const itemsU = uniqueBy(items, "zoho_item_id");
  const rawClients = parseCsv(fs.readFileSync(path.join(DIR, "zoho-clients.csv"), "utf8")).filter((r) => r.contact_id && r.contact_name).map(mapClient);
  const rawU = uniqueBy(rawClients, "zoho_contact_id");
  const { clients, merged } = mergeExact(rawU);
  const groups = possibleDupeGroups(clients);

  const sql = [
    "-- Billing seed from Zoho — generated " + new Date().toISOString() + " by scripts/books-build-seed.js",
    "-- Contains client personal data. Lives outside git. Re-runnable (see the migration's re-run rule).",
    "-- Run AFTER supabase/migrations/20261106_billing_foundation.sql.",
    "select public.billing_import_items(" + dollarQuote(JSON.stringify(itemsU)) + "::jsonb) as items;",
    "select public.billing_import_clients(" + dollarQuote(JSON.stringify(clients)) + "::jsonb) as clients;",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(DIR, "seed.sql"), sql);

  const count = (arr, f) => arr.reduce((m, x) => { m[x[f]] = (m[x[f]] || 0) + 1; return m; }, {});
  console.log("items:", itemsU.length, JSON.stringify(count(itemsU, "brand")), "kinds", JSON.stringify(count(itemsU, "kind")));
  console.log("clients in csv:", rawClients.length, "unique ids:", rawU.length, "→ after exact merge:", clients.length, "(merged " + merged + ")");
  console.log("possible-duplicate groups left: same name", groups.byName.length, "· same email", groups.byEmail.length);
  console.log("wrote", path.join(DIR, "seed.sql"));
}

main();
