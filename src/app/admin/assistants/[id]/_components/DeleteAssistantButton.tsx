"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAssistantButton({
  assistantId,
  displayName,
}: {
  assistantId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/assistants/${assistantId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAccount: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete assistant.");
        setDeleting(false);
      } else {
        router.push("/admin/assistants");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-500">Delete {displayName}?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-semibold text-white bg-danger-600 hover:bg-danger-500 disabled:opacity-50 px-2.5 py-1 rounded-md transition-colors duration-fast ease-quiet"
        >
          {deleting ? "Deleting…" : "Confirm"}
        </button>
        <button
          onClick={() => { setConfirming(false); setError(null); }}
          disabled={deleting}
          className="text-xs text-ink-400 hover:text-ink-600 transition-colors duration-fast ease-quiet"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-danger-600">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs font-medium text-danger-600 hover:text-danger-700 transition-colors duration-fast ease-quiet"
    >
      Delete Account
    </button>
  );
}
