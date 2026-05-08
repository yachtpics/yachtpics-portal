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
        <span className="text-xs text-gray-500">Delete {displayName}?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-2.5 py-1 rounded-md transition-colors"
        >
          {deleting ? "Deleting…" : "Confirm"}
        </button>
        <button
          onClick={() => { setConfirming(false); setError(null); }}
          disabled={deleting}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs font-medium text-red-400 hover:text-red-600 transition-colors"
    >
      Delete Account
    </button>
  );
}
