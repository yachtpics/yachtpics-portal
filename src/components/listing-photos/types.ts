/**
 * Shared listing photo management — used by the broker listing page
 * (`/dashboard/listings/[id]`) and the admin listing page
 * (`/admin/listings/[id]`). The two pages look different on purpose, so the
 * UI pieces take a `variant`; everything that touches data (loading, upload,
 * delete, reorder, categories, cover, show/hide, replace, AI labels) is one
 * copy. Role differences are expressed in `PhotoCapabilities`.
 */

export interface ListingPhoto {
  id: string;
  storage_path: string;
  filename: string | null;
  category: string | null;
  display_order: number;
  is_visible: boolean;
  /** Stored 600/2000 px copies made (src/lib/photoDerivativePaths.ts). */
  derivatives_at?: string | null;
  /** Where the original lives (Oct 28): "supabase" | "r2" (src/lib/photoStoreShared.ts). */
  storage_backend?: string | null;
  /** Signed full-size link the admin page is handed by its server page (and
   *  keeps fresh for new uploads / replaces). The broker page never has one:
   *  it signs on demand. */
  url?: string | null;
}

export type PhotoVariant = "broker" | "admin";

/**
 * A banner message for the page to show however it shows banners.
 * `ms` is a suggested auto-dismiss time (0 = leave it up).
 */
export type PhotoMessage = { kind: "success" | "error"; text: string; ms?: number };
export type OnPhotoMessage = (m: PhotoMessage) => void;

export interface PhotoCapabilities {
  variant: PhotoVariant;
  /**
   * How a category is saved. "direct": browser update under RLS, marked
   * category_source = "manual" (broker page). "admin-api": through
   * /api/admin/photos/update-category with the service role (admin page).
   */
  categoryWrite: "direct" | "admin-api";
  /**
   * Where custom categories come from. "api": loaded from and saved to
   * /api/photo-categories (broker page). "props": handed in by the server page
   * and extended locally when a new one is used (admin page).
   */
  customCategorySource: "api" | "props";
  /** Ask for a category before uploading files the filename can't place —
   *  only when AI labelling is off (broker page). */
  promptForUncategorized: boolean;
  /** Keep a signed full-size `url` on every photo (admin page). */
  keepOriginalUrls: boolean;
  /** Write photos.category_source on upload ("filename" / "manual"). */
  recordCategorySource: boolean;
}

export const BROKER_PHOTO_CAPABILITIES: PhotoCapabilities = {
  variant: "broker",
  categoryWrite: "direct",
  customCategorySource: "api",
  promptForUncategorized: true,
  keepOriginalUrls: false,
  recordCategorySource: true,
};

export const ADMIN_PHOTO_CAPABILITIES: PhotoCapabilities = {
  variant: "admin",
  categoryWrite: "admin-api",
  customCategorySource: "props",
  promptForUncategorized: false,
  keepOriginalUrls: true,
  recordCategorySource: false,
};

export type ReplaceStage = "uploading" | "saving";
