"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { BrandKey } from "@/lib/books/types";
import { booksCall } from "./booksApi";

/** Creates a draft in this login's book and opens the editor. */
export default function NewInvoiceButton({ brand, label = "New invoice", size = "md" }: { brand?: BrandKey; label?: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    const { error: err, data } = await booksCall("/api/admin/books/invoices", "POST", brand ? { brand } : {});
    if (err || !data?.id) { setBusy(false); setError(err ?? "Couldn't start an invoice."); return; }
    router.push(`/admin/billing/invoices/${data.id as string}`);
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size={size} onClick={go} disabled={busy}>{busy ? "Starting…" : label}</Button>
      {error && <span className="text-small text-danger-700">{error}</span>}
    </span>
  );
}
