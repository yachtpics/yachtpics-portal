"use client";

import { useEffect, useState } from "react";

const KEY = "yp_no_track";

/**
 * "Don't count plays from this browser" — sets / clears localStorage
 * yp_no_track on this origin; /see's tracker (trackVideo.ts) then sends
 * nothing. Signed-in admins are already skipped by the server; this covers
 * testing while signed out (or in another account) on this browser.
 */
export default function NoTrackToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      setOn(false);
    }
  }, []);

  function toggle() {
    const next = !on;
    try {
      if (next) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
      setOn(next);
    } catch {
      /* storage blocked — leave as is */
    }
  }

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-4 flex items-start gap-3">
      <input
        id="yp-no-track"
        type="checkbox"
        checked={!!on}
        disabled={on === null}
        onChange={toggle}
        className="mt-0.5 h-4 w-4 accent-accent-600"
      />
      <label htmlFor="yp-no-track" className="text-sm text-ink-900 cursor-pointer">
        Don&rsquo;t count plays from this browser
        <span className="block text-xs text-ink-500 mt-0.5">
          Only affects this browser on portal.yachtpics.com. Plays while you&rsquo;re signed in as an admin are never counted anyway.
        </span>
      </label>
    </div>
  );
}
