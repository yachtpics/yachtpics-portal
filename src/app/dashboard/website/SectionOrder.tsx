"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { SECTION_INFO, type SectionKey, type SiteSections } from "@/lib/brokerSite";

/**
 * Dashboard → Website → Sections (Oct 26): the movable home-page sections in
 * order, each with its on/off switch. Drag a row by its handle on a computer
 * (native HTML5 drag and drop — no library); the up/down buttons on every row
 * are the keyboard / touch / phone path. The hero is always first, Contact
 * always last.
 */

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-base ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 ${on ? "bg-success-600" : "bg-ink-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-base ease-quiet ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export default function SectionOrder({
  order,
  onOrder,
  sections,
  onSections,
  ready,
}: {
  order: SectionKey[];
  onOrder: (next: SectionKey[]) => void;
  sections: SiteSections;
  onSections: (next: SiteSections) => void;
  ready: boolean;
}) {
  const [dragging, setDragging] = useState<SectionKey | null>(null);
  const [over, setOver] = useState<SectionKey | null>(null);
  const [announce, setAnnounce] = useState("");

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = order.slice();
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    onOrder(next);
    setAnnounce(`${SECTION_INFO[k].label} moved to position ${to + 1} of ${order.length}.`);
  };

  return (
    <div>
      {!ready && (
        <p className="mb-3 text-xs text-warn-800 bg-warn-50 border border-warn-200 rounded-ctl px-3 py-2">
          Reordering isn&rsquo;t switched on yet — the switches work; the order will apply once it is.
        </p>
      )}
      <p className="text-xs text-ink-500 mb-2">Top of the page: your photo and name</p>
      <ul className="border border-hairline rounded-card divide-y divide-hairline bg-white" aria-label="Sections, in page order">
        {order.map((key, i) => {
          const info = SECTION_INFO[key];
          const toggle = info.toggle;
          return (
            <li
              key={key}
              draggable
              onDragStart={(e) => { setDragging(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(key); } }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragging ? order.indexOf(dragging) : -1;
                if (from >= 0) move(from, i);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 transition-colors duration-fast ${dragging === key ? "opacity-50" : ""} ${over === key && dragging !== key ? "bg-accent-50" : ""}`}
            >
              <span className="hidden sm:inline-flex items-center justify-center w-8 h-11 text-ink-400 cursor-grab active:cursor-grabbing" aria-hidden title="Drag to reorder">
                <GripVertical className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{info.label}</p>
                <p className="text-xs text-ink-500">{info.hint}</p>
              </div>
              <div className="flex items-center">
                <button type="button" aria-label={`Move ${info.label} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="w-11 h-11 inline-flex items-center justify-center rounded-ctl text-ink-500 hover:bg-ink-50 disabled:opacity-30">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button type="button" aria-label={`Move ${info.label} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)} className="w-11 h-11 inline-flex items-center justify-center rounded-ctl text-ink-500 hover:bg-ink-50 disabled:opacity-30">
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
              <div className="w-12 flex justify-end">
                {toggle ? (
                  <Switch on={sections[toggle]} onChange={(v) => onSections({ ...sections, [toggle]: v })} label={`Show ${info.label}`} />
                ) : (
                  <span className="text-[0.6875rem] text-ink-400">On</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-500 mt-2">Bottom of the page: Contact, always on</p>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
