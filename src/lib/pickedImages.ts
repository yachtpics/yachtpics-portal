/**
 * Files a broker picked for upload → the image files inside them.
 *
 * A zip is unpacked in the browser (JSZip, loaded on demand) and its images
 * come out in name order; __MACOSX and dot-files are skipped. Anything that
 * isn't an image is dropped, so a "pick any file" input (the one phones need
 * to open the Files app instead of the Gallery) can share this.
 */
const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;

export function isZipFile(f: File): boolean {
  return /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
}

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return "image/jpeg";
}

export async function expandPickedFiles(files: FileList | File[] | null): Promise<File[]> {
  if (!files) return [];
  const picked = Array.from(files);
  const out: File[] = [];
  let JSZip: typeof import("jszip") | null = null;
  for (const f of picked) {
    if (!isZipFile(f)) {
      if (f.type.startsWith("image/") || IMAGE_RE.test(f.name)) out.push(f);
      continue;
    }
    try {
      JSZip = JSZip ?? (await import("jszip")).default;
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files)
        .filter((e) => !e.dir && IMAGE_RE.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const e of entries) {
        const blob = await e.async("blob");
        const name = e.name.split("/").pop() ?? e.name;
        out.push(new File([blob], name, { type: mimeFor(name) }));
      }
    } catch {
      // An unreadable zip is skipped; anything picked alongside it still goes.
    }
  }
  return out;
}
