import { probeVideoCodec, type VideoCodecInfo } from "./videoCodec";

/**
 * Browser: which codec is this picked video? Reads only slices of the File
 * (the first 1 MB, plus the moov box when it's at the end, capped at 8 MB) —
 * never the whole file. Any problem → null (say nothing); this is a hint for a
 * warning and must never get in the way of an upload.
 */
export async function checkVideoFileCodec(file: File): Promise<VideoCodecInfo | null> {
  try {
    return await probeVideoCodec(
      async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
      file.size
    );
  } catch {
    return null;
  }
}
