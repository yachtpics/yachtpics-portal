/**
 * Job `site_text_drafts` — draft the missing yachtpics.com boat-page text for
 * the boats live on the site, for the owner to review (Nov 16, 2026).
 *
 * Walks live boats (same filter as `republish_site`) in id order. Per boat:
 *   - no website text AND no waiting draft → ask the model for one and store
 *     it in listings.site_description_draft (+ site_description_drafted_at);
 *   - no location AND no waiting suggestion → read the cover photo's embedded
 *     City / State into listings.site_location_suggestion.
 * Nothing is ever written to site_description or location, and nothing is
 * published — the owner approves each draft (Admin dashboard → Boat page text).
 *
 * Safe to re-run: it only fills gaps, so a boat drafted on an earlier run (or
 * an interrupted batch) is skipped. One boat's failure is logged and counted;
 * the job carries on.
 *
 * params: { limit?: number, listingIds?: string[] }
 *   limit       stop after this many AI drafts have been attempted (trial run)
 *   listingIds  only these boats (still only if they're live)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiConfigured } from "@/lib/ai";
import { draftSiteTextForListing, suggestLocationFromPhotos } from "@/lib/siteTextServer";
import { JobFatalError, type JobHandler } from "./types";

const PAGE = 10;
/** First guess at one boat's time (a 6-photo model call + one original read). */
const FIRST_GUESS_MS = 20_000;

export const SITE_TEXT_DRAFTS_MAX_IDS = 200;
export const SITE_TEXT_DRAFTS_MAX_LIMIT = 500;

type Cursor = { lastId?: string; attempted?: number; drafted?: number; skipped?: number; failed?: number; located?: number };

type Boat = {
  id: string;
  vessel_name: string | null;
  site_description: string | null;
  site_description_draft: string | null;
  location: string | null;
  site_location_suggestion: string | null;
  hero_photo_id: string | null;
  photo_order_manual: boolean | null;
};

function liveBoats(svc: SupabaseClient, listingIds: string[] | null, head = false) {
  let q = svc
    .from("listings")
    .select(
      "id, vessel_name, site_description, site_description_draft, location, site_location_suggestion, hero_photo_id, photo_order_manual",
      head ? { count: "exact", head: true } : undefined
    )
    .eq("publish_to_site", true)
    .eq("status", "active")
    .eq("showcase_opt_out", false);
  if (listingIds) q = q.in("id", listingIds);
  return q;
}

const empty = (s: string | null | undefined) => !(s ?? "").trim();

export const siteTextDrafts: JobHandler = async (job, { svc, deadlineMs }) => {
  if (!isAiConfigured()) throw new JobFatalError("AI is not configured (ANTHROPIC_API_KEY is missing) — nothing can be drafted.");
  const p = (job.params ?? {}) as { limit?: number; listingIds?: string[] };
  const listingIds = Array.isArray(p.listingIds) && p.listingIds.length ? p.listingIds : null;
  const limit = typeof p.limit === "number" && p.limit > 0 ? p.limit : null;
  const cur = (job.cursor ?? {}) as Cursor;
  const c: Required<Cursor> = {
    lastId: cur.lastId ?? "",
    attempted: cur.attempted ?? 0,
    drafted: cur.drafted ?? 0,
    skipped: cur.skipped ?? 0,
    failed: cur.failed ?? 0,
    located: cur.located ?? 0,
  };

  let total: number | undefined;
  if (job.total == null) {
    const { count } = await liveBoats(svc, listingIds, true);
    total = count ?? 0;
  }

  let q = liveBoats(svc, listingIds).order("id", { ascending: true }).limit(PAGE);
  if (c.lastId) q = q.gt("id", c.lastId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const boats = (data ?? []) as unknown as Boat[];

  let done = 0;
  let failed = 0;
  const log: string[] = [];
  let slowest = FIRST_GUESS_MS;
  let processed = 0;
  let hitLimit = false;

  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i];
    const needsText = empty(boat.site_description) && empty(boat.site_description_draft);
    if (needsText && limit !== null && c.attempted >= limit) { hitLimit = true; break; }
    // Always do at least one boat; after that only start one we expect to finish.
    if (processed > 0 && Date.now() + slowest * 1.2 > deadlineMs) break;
    const t0 = Date.now();
    const name = boat.vessel_name || "Untitled";
    let boatFailed = false;

    if (needsText) {
      c.attempted++;
      try {
        const draft = await draftSiteTextForListing(svc, boat.id);
        // Re-read right before writing: the owner may have typed text (or
        // another run drafted) while the model was working.
        const { data: now } = await svc
          .from("listings")
          .select("site_description, site_description_draft")
          .eq("id", boat.id)
          .maybeSingle();
        if (now && empty(now.site_description as string | null) && empty(now.site_description_draft as string | null)) {
          const { error: wErr } = await svc
            .from("listings")
            .update({ site_description_draft: draft, site_description_drafted_at: new Date().toISOString() })
            .eq("id", boat.id);
          if (wErr) throw new Error(wErr.message);
          c.drafted++;
          log.push(`${name} — drafted`);
        } else {
          c.skipped++;
          log.push(`${name} — skipped (has text)`);
        }
      } catch (e) {
        boatFailed = true;
        c.failed++;
        log.push(`${name} — failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      c.skipped++;
      log.push(`${name} — skipped (has text)`);
    }

    if (empty(boat.location) && empty(boat.site_location_suggestion)) {
      try {
        const loc = await suggestLocationFromPhotos(svc, boat);
        if (loc) {
          const { error: lErr } = await svc.from("listings").update({ site_location_suggestion: loc }).eq("id", boat.id);
          if (lErr) throw new Error(lErr.message);
          c.located++;
          log.push(`${name} — location from photos: ${loc}`);
        } else {
          log.push(`${name} — no location in the photo metadata`);
        }
      } catch (e) {
        // A location miss never fails the boat — the text is what matters.
        log.push(`${name} — location not read: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (boatFailed) failed++;
    else done++;
    c.lastId = boat.id;
    processed++;
    slowest = Math.max(slowest, Date.now() - t0);
  }

  const finished = hitLimit || (boats.length < PAGE && processed === boats.length);
  if (finished) {
    log.push(
      `Finished — ${c.drafted} drafted, ${c.skipped} skipped, ${c.failed} failed, ${c.located} location${c.located === 1 ? "" : "s"} suggested` +
        (hitLimit ? ` (stopped at the limit of ${limit}).` : ".") +
        " Review them on the Admin dashboard → Boat page text."
    );
  }
  return { cursor: c, done, failed, total, log, finished };
};
