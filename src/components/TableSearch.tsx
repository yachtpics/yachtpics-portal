"use client";

import { useRef, useState } from "react";

/**
 * Wraps a server-rendered table (or any block with <tbody><tr> rows) and filters
 * rows as you type — no per-page data reshaping. Matches against each row's
 * visible + hidden text (so columns hidden on mobile are still searchable).
 * Usage: wrap the server-rendered table block as this component's children.
 */
export default function TableSearch({
  placeholder = "Search…",
  children,
}: {
  placeholder?: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  function onQuery(raw: string) {
    const q = raw.trim().toLowerCase();
    const rows = wrapRef.current?.querySelectorAll<HTMLElement>("tbody > tr") ?? [];
    let visible = 0;
    rows.forEach((row) => {
      const match = !q || (row.textContent ?? "").toLowerCase().includes(q);
      row.style.display = match ? "" : "none";
      if (match) visible++;
    });
    setEmpty(rows.length > 0 && visible === 0);
  }

  return (
    <div>
      <div className="relative mb-5">
        <svg className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-white border border-hairline-strong rounded-ctl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors duration-fast ease-quiet"
        />
      </div>
      <div ref={wrapRef}>{children}</div>
      {empty && <p className="text-ink-400 text-sm text-center py-6">No matches.</p>}
    </div>
  );
}
