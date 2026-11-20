"use client";

/**
 * Calm, dismissible notice for a video in a format some browsers can't show
 * (H.265 / ProRes — see src/lib/videoCodec.ts). Shown near the video uploader
 * on every screen that adds a listing video; stays until dismissed. The upload
 * itself is never blocked.
 */
export type VideoCodecNoticeItem = { key: string; filename: string; message: string };

export default function VideoCodecNotice({
  items,
  onDismiss,
  className = "mb-4",
}: {
  items: VideoCodecNoticeItem[];
  onDismiss: (key: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {items.map((n) => (
        <div
          key={n.key}
          role="status"
          className="bg-warn-50 border border-warn-200 text-warn-700 text-sm px-4 py-3 rounded-ctl flex items-start justify-between gap-3"
        >
          <span>
            <span className="font-medium text-ink-800 break-all">{n.filename}</span>
            {" — "}
            {n.message}
          </span>
          <button
            type="button"
            onClick={() => onDismiss(n.key)}
            className="shrink-0 font-bold text-warn-700 hover:text-ink-900"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Add one notice, replacing any earlier notice with the same key. */
export function addCodecNotice(prev: VideoCodecNoticeItem[], item: VideoCodecNoticeItem): VideoCodecNoticeItem[] {
  return prev.filter((n) => n.key !== item.key).concat(item);
}
