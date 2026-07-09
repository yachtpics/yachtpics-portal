"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

type State = "unsupported" | "off" | "on" | "denied" | "working";

export default function EnableNotifications({ onlyWhenOff = false }: { onlyWhenOff?: boolean }) {
  const [state, setState] = useState<State>("off");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    setError("");
    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      reg = await withTimeout(
        navigator.serviceWorker.ready,
        12000,
        "The app's background worker didn't start. Please reload the page and try again."
      );
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("Notifications aren't set up on the server yet.");
      const sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }),
        15000,
        "Couldn't reach the notification service — a VPN or firewall may be blocking it."
      );
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error("Couldn't save your subscription. Try again.");
      setState("on");
    } catch (err) {
      console.error("Enable notifications failed:", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("off");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  if (state === "unsupported") return null;
  // In nudge mode, only show the prompt when notifications are actually off.
  if (onlyWhenOff && (state === "on" || state === "denied")) return null;

  return (
    <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Push notifications</h3>
          <p className="text-xs text-ink-500 mt-0.5 max-w-md">
            Get an alert on this device when a client opens one of your slideshows — so you know the moment a buyer is looking.
          </p>
          {state === "denied" && (
            <p className="text-xs text-warn-700 mt-2">
              Notifications are blocked in your browser settings for this site. Enable them there, then reload.
            </p>
          )}
          {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
        </div>
        <div className="shrink-0">
          {state === "on" ? (
            <button
              onClick={disable}
              className="text-sm font-medium px-4 py-2 rounded-ctl border border-hairline-strong text-ink-600 hover:border-ink-400 hover:text-ink-900 transition-colors duration-base ease-quiet"
            >
              Turn off
            </button>
          ) : (
            <button
              onClick={enable}
              disabled={state === "working" || state === "denied"}
              className="bg-white border border-hairline-strong text-ink-900 hover:border-ink-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold px-4 py-2 rounded-ctl transition-colors duration-base ease-quiet"
            >
              {state === "working" ? "Enabling…" : "Enable"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
