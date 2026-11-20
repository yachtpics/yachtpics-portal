/**
 * Superseded (Oct 26): the website is no longer its own subscription — it's a
 * line on the plan subscription. Kept only as an alias of /api/website/add
 * (this file couldn't be deleted from the agent's shell); safe to delete.
 */
export { POST } from "../add/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No fetch made while answering this route is ever served from the Next.js
// fetch cache (Nov 2026: cached internal calls froze the daily jobs for two weeks).
export const fetchCache = "force-no-store";
