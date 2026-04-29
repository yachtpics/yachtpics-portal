"use client";

import { useState, useRef, useEffect } from "react";

interface HelpTipProps {
  text: string;
  /** Optional extra content rendered below the main text */
  detail?: string;
  /** Position the popover above or below the icon (default: "above") */
  position?: "above" | "below";
  /** Width of the popover in px (default: 260) */
  width?: number;
}

/**
 * HelpTip — a small "?" icon that reveals a contextual tooltip on click or hover.
 * Usage: <HelpTip text="This is what this thing does." />
 */
export default function HelpTip({ text, detail, position = "above", width = 260 }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label="Help"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 hover:bg-[#d4a843]/20 text-gray-400 hover:text-[#d4a843] text-[10px] font-bold transition-colors cursor-help leading-none"
      >
        ?
      </button>

      {open && (
        <div
          style={{ width }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={`absolute z-50 left-1/2 -translate-x-1/2 bg-[#0a1628] border border-[#1e3a5f] rounded-xl shadow-xl px-4 py-3 text-left pointer-events-auto
            ${position === "above" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {/* Arrow */}
          <span
            className={`absolute left-1/2 -translate-x-1/2 border-[6px] border-transparent
              ${position === "above"
                ? "top-full border-t-[#1e3a5f]"
                : "bottom-full border-b-[#1e3a5f]"}`}
          />
          <p className="text-white text-xs leading-relaxed">{text}</p>
          {detail && (
            <p className="text-gray-400 text-xs leading-relaxed mt-1.5">{detail}</p>
          )}
        </div>
      )}
    </div>
  );
}
