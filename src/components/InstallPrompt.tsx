"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISS_KEY = "yp-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Install-to-home-screen prompt (#35).
 *
 * Chromium/Android/desktop: captures `beforeinstallprompt` and shows a button
 * that triggers the native install dialog.
 *
 * iOS Safari: there is no install event, so we show short Share-sheet
 * instructions instead. Dismissal is remembered in localStorage.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    if (
      typeof window !== "undefined" &&
      window.localStorage.getItem(DISMISS_KEY) === "1"
    ) {
      return;
    }

    setDismissed(false);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // iOS never fires beforeinstallprompt — show manual instructions there.
    if (isIos()) setShowIosHint(true);

    const onInstalled = () => closeBanner();
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeBanner() {
    setDismissed(true);
    setDeferredPrompt(null);
    setShowIosHint(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    closeBanner();
  }

  const canShow = !dismissed && (deferredPrompt || showIosHint);
  if (!canShow) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:left-auto sm:right-4 sm:max-w-sm">
      <div className="rounded-xl bg-[#0b1f33] px-4 py-3 text-white shadow-lg ring-1 ring-white/10">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-white/10">
            <Download size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Install YachtPics</p>
            {deferredPrompt ? (
              <>
                <p className="mt-0.5 text-xs text-white/70">
                  Add the portal to your home screen for one-tap access.
                </p>
                <button
                  onClick={handleInstall}
                  className="mt-2.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-medium text-[#0b1f33] transition hover:bg-white/90"
                >
                  Install
                </button>
              </>
            ) : (
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-white/70">
                Tap <Share size={13} className="inline" aria-hidden="true" /> then
                &ldquo;Add to Home Screen&rdquo;.
              </p>
            )}
          </div>
          <button
            onClick={closeBanner}
            aria-label="Dismiss"
            className="flex-none rounded-md p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
