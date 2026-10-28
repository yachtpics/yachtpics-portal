/**
 * Alt text for photos on the public pages. Its own module (browser-safe) so
 * client components don't pull the server-side signing code in
 * src/lib/publicPhotoUrls.ts into their bundles.
 */
/** Alt text for a photo on a public page: "Salon — Sea Dream". */
export function photoAlt(category: string | null | undefined, vesselName: string | null | undefined): string {
  const what = (category ?? "").trim() || "Photo";
  const name = (vesselName ?? "").trim();
  return name ? `${what} — ${name}` : what;
}
