"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import type { PhotoMessage } from "./types";

/**
 * Download messages that can't be missed (Nov 11, later).
 *
 * Live traces from a brokerage's office PCs: the Save / folder window is
 * refused, sometimes slowly enough (2–4 s) to read as a Cancel. The hint we
 * showed then sat in the page banner, far below Download All, under other
 * cards, and went away by itself — the assistant never saw it. So:
 *
 *  - DownloadDialog — "Nothing was saved." / "That didn't save either." and
 *    download errors: a centred box that must be answered (no timer, the
 *    backdrop doesn't close it). Focus goes to the primary button, Tab stays
 *    inside, Esc = the secondary button, focus goes back on close.
 *  - DownloadToast — successes and neutral notes ("Saved 138 photos…"):
 *    fixed at the bottom of the screen (above the phone tab bar), 10 s or
 *    longer, dismissible, never blocks.
 *  - useDownloadMessages — what the listing pages use: hand it the shared
 *    download hooks' PhotoMessages; it picks the dialog or the toast.
 *
 * Used by the broker and admin listing pages, the My Listings row, and (the
 * dialog) the public download pages via src/components/DownloadPickerHints.
 */

export const ZIP_INSTEAD_LABEL = "Download as a zip instead";
export const PICKER_HINT = {
  title: "Nothing was saved.",
  body: "If you didn't cancel, your computer may be blocking that way of saving.",
};
export const PICKER_REPEAT = {
  title: "That didn't save either.",
  body: "Your computer seems to be blocking that way of saving. Use an ordinary zip download instead — the Portal will remember.",
};

/** Successes / notes stay at least this long. */
const TOAST_MIN_MS = 10000;

/** Mounted, then shown on the next frame — so the entrance can transition. */
function useEntered(): boolean {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return entered;
}

/** Into <body>, clear of any card's stacking context. These only ever appear
 *  after a click (never in the server render), so no mount wait is needed —
 *  the dialog can focus its button on the first frame. */
function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

const enterClasses = (entered: boolean) =>
  `transition-[opacity,transform] duration-slow ease-quiet motion-reduce:transition-none motion-reduce:transform-none ${
    entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
  }`;

function InfoIcon({ tone }: { tone: "info" | "error" | "success" }) {
  const wrap =
    tone === "error" ? "bg-danger-50 text-danger-600"
      : tone === "success" ? "bg-success-50 text-success-600"
        : "bg-accent-50 text-accent-700";
  return (
    <span aria-hidden className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full ${wrap}`}>
      {tone === "success" ? (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
      ) : tone === "error" ? (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
      ) : (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
      )}
    </span>
  );
}

/**
 * A box that must be answered. Backdrop and card are the Portal's dialog
 * look (ConfirmDeleteDialog: ink-950/50 backdrop, rounded-card, elev-3).
 * Two buttons at most: `primary` (accent) and `secondary`; with no secondary,
 * Esc runs `onClose`, which should be the primary's "OK".
 */
export function DownloadDialog({ title, body, tone = "info", primaryLabel, onPrimary, secondaryLabel, onClose }: {
  title: string;
  body?: ReactNode;
  tone?: "info" | "error";
  primaryLabel: string;
  onPrimary: () => void;
  /** e.g. "Not now" / "Close"; omit for a single OK button. */
  secondaryLabel?: string;
  /** Esc and the secondary button. */
  onClose: () => void;
}) {
  const entered = useEntered();
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useRef(`dl-dialog-${Math.random().toString(36).slice(2, 8)}`).current;

  // Focus the primary button; give focus back (the Download button) on close.
  // Body scroll locked while open, as ShowingModal / ShowcaseBoard do it.
  useEffect(() => {
    const back = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = requestAnimationFrame(() => primaryRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prevOverflow;
      if (back && back !== document.body && document.contains(back)) {
        try { back.focus(); } catch { /* ignore */ }
      }
    };
  }, []);

  // Esc closes; Tab stays inside the box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.prototype.slice.call(
        cardRef.current.querySelectorAll("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")
      ) as HTMLElement[];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!cardRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Portal>
      {/* The backdrop deliberately does nothing on click: this must be answered. */}
      {/* Portalled, but React events still bubble to the page's handlers (a row link…): stop them here. */}
      <div onClick={(e) => e.stopPropagation()} className={`fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4 transition-opacity duration-slow ease-quiet motion-reduce:transition-none ${entered ? "opacity-100" : "opacity-0"}`}>
        <div
          ref={cardRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`bg-white rounded-card shadow-elev-3 w-full max-w-[440px] p-5 sm:p-6 ${enterClasses(entered)}`}
        >
          <div className="flex items-start gap-3.5">
            <InfoIcon tone={tone} />
            <div className="min-w-0 pt-1.5">
              <h2 id={titleId} className="text-h2 text-ink-900">{title}</h2>
              {body && <div className="mt-1.5 text-sm text-ink-600 leading-relaxed">{body}</div>}
            </div>
          </div>
          {/* Phones: stacked, primary on top. Wider: side by side, primary on the right. */}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {secondaryLabel && (
              <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
                {secondaryLabel}
              </Button>
            )}
            <Button ref={primaryRef} variant="primary" onClick={onPrimary} className="w-full sm:w-auto">
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * Bottom-of-screen note for successes and neutral notes. Bottom-centre on a
 * computer (≤ 560 px, 24 px up); full width with 12 px margins on a phone,
 * above the dashboard / admin tab bar and the safe area.
 */
export function DownloadToast({ message, onDismiss }: { message: PhotoMessage; onDismiss: () => void }) {
  const entered = useEntered();
  const tone = message.kind === "success" ? "success" : "info";
  return (
    <Portal>
      <div onClick={(e) => e.stopPropagation()} className="fixed z-[45] inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:inset-x-0 md:bottom-6 md:flex md:justify-center md:px-6 pointer-events-none">
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-auto w-full md:max-w-[560px] bg-white border border-hairline rounded-card shadow-elev-3 pl-3.5 pr-2 py-3 flex items-start gap-3 ${enterClasses(entered)}`}
        >
          <InfoIcon tone={tone} />
          <div className="min-w-0 flex-1 pt-0.5">
            {message.title ? (
              <>
                <p className="text-sm font-medium text-ink-900">{message.title}</p>
                <p className="mt-0.5 text-sm text-ink-600 leading-snug">{message.text}</p>
              </>
            ) : (
              <p className="text-sm font-medium text-ink-900 leading-snug pt-1.5">{message.text}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-ctl text-ink-400 hover:text-ink-900 hover:bg-ink-950/[0.04] transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          </button>
        </div>
      </div>
    </Portal>
  );
}

/**
 * The listing pages' download messages: `show` takes a PhotoMessage from
 * useSizedDownloads / useOriginalSave. Errors and anything carrying an action
 * (the "Nothing was saved." hint) open the DownloadDialog — no timer;
 * successes and notes go to the DownloadToast for 10 s (or their `ms` if
 * longer). A new message replaces the old one; `clear` drops it (a new
 * download starting). Render `element` once anywhere on the page.
 */
export function useDownloadMessages() {
  const [msg, setMsg] = useState<(PhotoMessage & { seq: number }) | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stopTimer, []);

  function show(m: PhotoMessage) {
    stopTimer();
    const n = ++seq.current;
    setMsg({ ...m, seq: n });
    const blocking = m.kind === "error" || !!m.action;
    if (!blocking) {
      timer.current = setTimeout(() => setMsg((cur) => (cur && cur.seq === n ? null : cur)), Math.max(TOAST_MIN_MS, m.ms ?? 0));
    }
  }
  function clear() {
    stopTimer();
    setMsg(null);
  }

  let element: ReactNode = null;
  if (msg) {
    if (msg.kind === "error" || msg.action) {
      const action = msg.action;
      element = (
        <DownloadDialog
          key={msg.seq}
          tone={msg.kind === "error" ? "error" : "info"}
          title={msg.title ?? (msg.kind === "error" ? "The download didn't finish." : msg.text)}
          body={msg.title || msg.kind === "error" ? msg.text : undefined}
          primaryLabel={action ? action.label : "OK"}
          onPrimary={() => { clear(); action?.run(); }}
          secondaryLabel={action ? msg.dismissLabel ?? (msg.kind === "error" ? "Close" : "Not now") : undefined}
          onClose={clear}
        />
      );
    } else {
      element = <DownloadToast key={msg.seq} message={msg} onDismiss={clear} />;
    }
  }
  return { show, clear, element };
}
