// Getting full-resolution listing photos onto a device — used by the admin
// listing page so Charlie can pull originals from his phone without the hard
// drive. Browser-only helpers (no React).
//
// Phone: the photos are fetched as files and handed to the system share sheet
// (navigator.share({ files })), where "Save image" / "Save to Photos" or
// Facebook / Instagram are one tap away. iOS only opens the share sheet from
// a tap, and fetching first spends that tap, so the caller fetches, then shows
// a button whose click calls sharePhotoFiles() with nothing awaited before it.
// Desktop (or a phone browser that can't share files): an ordinary download.

/** Most share sheets cope with about this many files at once. */
export const SHARE_BATCH = 10;

export interface PhotoSource {
  filename: string | null;
  category: string | null;
}

/** True on a touch-first device (phones, tablets, the Fold either way). */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Can this browser hand these files to the share sheet? */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || files.length === 0) return false;
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

/** Share mode: a touch device whose browser can share image files. */
export function shouldUseShareSheet(): boolean {
  if (!isTouchDevice()) return false;
  // A 1-byte stand-in; canShare only looks at the type.
  const probe = new File([new Uint8Array(1)], "probe.jpg", { type: "image/jpeg" });
  return canShareFiles([probe]);
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
};

function extOf(filename: string | null): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return m ? m[1].toLowerCase() : "jpg";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** e.g. "seas-the-day-03-salon.jpg" — numbered in the listing's order. */
export function photoFileName(vessel: string | null, index: number, photo: PhotoSource): string {
  const parts = [slug(vessel ?? "") || "photo", String(index + 1).padStart(2, "0")];
  const cat = slug(photo.category ?? "");
  if (cat) parts.push(cat);
  return `${parts.join("-")}.${extOf(photo.filename)}`;
}

/** Fetch one original as a File with a proper image type. */
export async function fetchPhotoFile(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = blob.type && blob.type.indexOf("image/") === 0 ? blob.type : (MIME_BY_EXT[extOf(name)] ?? "image/jpeg");
  return new File([blob], name, { type });
}

/** Fetch several, three at a time. Failed photos are left out and counted. */
export async function fetchPhotoFiles(
  items: { url: string; name: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: File[]; failed: number }> {
  const out: (File | null)[] = items.map(() => null);
  let next = 0;
  let done = 0;
  let failed = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fetchPhotoFile(items[i].url, items[i].name);
      } catch {
        failed++;
      }
      done++;
      onProgress?.(done, items.length);
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(3, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return { files: out.filter((f): f is File => f !== null), failed };
}

/**
 * Open the share sheet. Call straight from a click handler with nothing
 * awaited first. Resolves "shared", "cancelled" (the user closed the sheet)
 * or "failed".
 */
export async function sharePhotoFiles(files: File[]): Promise<"shared" | "cancelled" | "failed"> {
  try {
    await navigator.share({ files } as ShareData);
    return "shared";
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return name === "AbortError" ? "cancelled" : "failed";
  }
}

/** Save one blob as a file (anchor + object URL). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Save several files one after another (browsers drop rapid-fire clicks). */
export async function saveFilesSequentially(files: File[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    saveBlob(files[i], files[i].name);
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

/** Zip and save (no compression — JPEGs are already compressed). */
export async function saveFilesAsZip(
  files: File[],
  zipName: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (let i = 0; i < files.length; i++) zip.file(files[i].name, files[i]);
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) => onProgress?.(meta.percent));
  saveBlob(blob, zipName);
}
