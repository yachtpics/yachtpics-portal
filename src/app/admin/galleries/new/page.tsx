"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewGalleryPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [galleryType, setGalleryType] = useState("event");
  const [expiryMode, setExpiryMode] = useState<"30" | "60" | "90" | "custom" | "none">("60");
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!title.trim()) {
      setError("Please enter a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: { title: string; galleryType: string; expiryDays?: number | null; expiryDate?: string | null } = {
        title: title.trim(),
        galleryType,
      };
      if (expiryMode === "custom") payload.expiryDate = customDate || null;
      else if (expiryMode === "none") payload.expiryDays = null;
      else payload.expiryDays = Number(expiryMode);

      const res = await fetch("/api/admin/galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create gallery");
      router.push(`/admin/galleries/${data.gallery.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  const inputClass =
    "w-full text-sm border border-hairline-strong rounded-ctl px-3 py-2.5 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500";

  const expiryOptions: { value: typeof expiryMode; label: string }[] = [
    { value: "30", label: "30 days" },
    { value: "60", label: "60 days" },
    { value: "90", label: "90 days" },
    { value: "custom", label: "Custom date" },
    { value: "none", label: "No expiry" },
  ];

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <Link href="/admin/galleries" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">
        &larr; Back to Galleries
      </Link>
      <h1 className="text-display text-ink-900 mt-3 mb-1">New Gallery</h1>
      <p className="text-ink-500 text-sm mb-6">
        Create the gallery, then upload photos/videos and add recipients on the next screen.
      </p>

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-6 space-y-5">
        <div>
          <label className="block label-caps mb-1.5">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Autism Charity Event 2026"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className="block label-caps mb-1.5">Type</label>
          <select value={galleryType} onChange={(e) => setGalleryType(e.target.value)} className={inputClass}>
            <option value="event">Event</option>
            <option value="owner">Owner</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block label-caps mb-1.5">Download access expires</label>
          <div className="flex flex-wrap gap-2">
            {expiryOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setExpiryMode(o.value)}
                className={`text-sm px-3 py-2 rounded-ctl border transition-colors duration-fast ease-quiet ${
                  expiryMode === o.value
                    ? "border-accent-500 bg-accent-50 text-accent-700 font-medium"
                    : "border-hairline-strong text-ink-600 hover:border-ink-400"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {expiryMode === "custom" && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className={`${inputClass} mt-2`}
            />
          )}
          <p className="text-xs text-ink-500 mt-2">
            After this date, recipients can still view the slideshow but downloads turn off.
          </p>
        </div>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            onClick={create}
            disabled={saving}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {saving ? "Creating…" : "Create gallery"}
          </button>
          <Link href="/admin/galleries" className="text-sm font-medium px-3 py-2.5 rounded-ctl text-ink-500 hover:text-ink-700 transition-colors duration-fast ease-quiet">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
