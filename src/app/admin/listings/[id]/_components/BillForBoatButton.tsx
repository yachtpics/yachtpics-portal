"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * "Bill for this boat" — makes (or reopens) a YachtPics draft invoice for
 * this listing in the signed-in login's own Billing book and opens it.
 * Shown only to billing staff who bill under YachtPics (the page decides).
 * Server side: POST /api/admin/books/invoices/from-listing.
 */
export default function BillForBoatButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/books/invoices/from-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_id: listingId }),
      });
      const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !d.id) {
        setError(d.error ?? "Couldn't start the invoice.");
        setBusy(false);
        return;
      }
      router.push(`/admin/billing/invoices/${d.id}`);
    } catch {
      setError("Couldn't reach the Portal.");
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={go}
        disabled={busy}
        className="mt-2 ml-2 py-1.5 font-medium"
        title="Start a YachtPics invoice for this boat in Billing"
      >
        <Receipt className="w-3.5 h-3.5" aria-hidden />
        {busy ? "Opening…" : "Bill for this boat"}
      </Button>
      {error && (
        <p className="mt-2 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded-ctl px-3 py-2 max-w-md">{error}</p>
      )}
    </>
  );
}
