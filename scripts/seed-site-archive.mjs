// One-off: seed brokerage_site_archive from the live website HTML.
//
// The publisher rewrites a brokerage page wholesale — new boats + archive — so a
// page whose Juicebox galleries aren't in the DB would regenerate with them
// missing. This captures all 79 pages' galleries from the site itself.
//
// Run once, from the portal root, with yachtpics-site checked out alongside:
//   node scripts/seed-site-archive.mjs ../yachtpics-site
//
// Reads credentials from .env.local. Idempotent: clears and re-seeds.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

const siteDir = process.argv[2] || "../yachtpics-site";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const { data: pages, error: pagesErr } = await supabase
  .from("site_pages")
  .select("filename")
  .order("sort_order");
if (pagesErr) throw pagesErr;

const rows = [];
let missing = 0;

for (const { filename } of pages) {
  const path = join(siteDir, `${filename}.html`);
  if (!existsSync(path)) {
    console.warn(`  no page file: ${filename}.html`);
    missing++;
    continue;
  }
  const html = readFileSync(path, "utf8");

  // A hand-built page has ONE gallery list — that's the archive.
  // A page we've already generated has TWO: "Recent shoots" (portal boats) then
  // "Archive". Only the last one is the archive; capturing both would re-import
  // the portal's own boats as archive entries and list them twice.
  const lists = html.match(/<ul class="client-cols">([\s\S]*?)<\/ul>/g) || [];
  const archiveUl = lists.length ? lists[lists.length - 1] : null;
  if (!archiveUl) continue;

  let order = 0;
  const items = archiveUl.match(/<li><a href="[^"]*\/index\.html">[^<]*<\/a><\/li>/g) || [];
  for (const li of items) {
    const m = li.match(/<li><a href="([^"]*)">(.*)<\/a><\/li>/);
    if (!m) continue;
    rows.push({
      site_page: filename,
      label: decode(m[2]),
      href: decode(m[1]),
      sort_order: ++order,
    });
  }
}

console.log(`pages: ${pages.length}, missing files: ${missing}, gallery rows: ${rows.length}`);

const { error: delErr } = await supabase
  .from("brokerage_site_archive")
  .delete()
  .not("id", "is", null);
if (delErr) throw delErr;

for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await supabase.from("brokerage_site_archive").insert(batch);
  if (error) throw error;
  process.stdout.write(`  inserted ${Math.min(i + 200, rows.length)}/${rows.length}\r`);
}

// Mark every page we actually inspected — including the ones with no galleries.
// That's what lets the publisher tell "checked, empty" from "never looked".
const checked = pages
  .filter(({ filename }) => existsSync(join(siteDir, `${filename}.html`)))
  .map(({ filename }) => filename);

const { error: markErr } = await supabase
  .from("site_pages")
  .update({ archive_checked_at: new Date().toISOString() })
  .in("filename", checked);
if (markErr) throw markErr;

const { count } = await supabase
  .from("brokerage_site_archive")
  .select("*", { count: "exact", head: true });
console.log(`\ndone — ${count} archive rows across ${new Set(rows.map((r) => r.site_page)).size} pages`);
console.log(`marked ${checked.length} pages as archive-checked`);
