"use client";

import { useState, useEffect } from "react";
import { PHOTO_CATEGORIES } from "@/lib/photoCategories";

interface CustomCategory {
  id: string;
  name: string;
}

export default function PhotoCategoriesPage() {
  const [custom, setCustom] = useState<CustomCategory[]>([]);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/photo-categories")
      .then((r) => r.json())
      .then((d) => { if (d.categories) setCustom(d.categories); })
      .catch(() => {});
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;

    if ((PHOTO_CATEGORIES as readonly string[]).includes(trimmed)) {
      setMessage({ type: "error", text: `"${trimmed}" is already in the standard list.` });
      return;
    }
    if (custom.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setMessage({ type: "error", text: `"${trimmed}" already exists.` });
      return;
    }

    setAdding(true);
    setMessage(null);
    const res = await fetch("/api/photo-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    const data = await res.json();
    if (res.ok) {
      setCustom((prev) => [...prev, { id: data.id ?? trimmed, name: trimmed }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setMessage({ type: "success", text: `"${trimmed}" added.` });
    } else {
      setMessage({ type: "error", text: data.error ?? "Failed to add." });
    }
    setAdding(false);
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleDelete(cat: CustomCategory) {
    setRemovingId(cat.id);
    const res = await fetch("/api/photo-categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: cat.id }),
    });
    if (res.ok) {
      setCustom((prev) => prev.filter((c) => c.id !== cat.id));
      setMessage({ type: "success", text: `"${cat.name}" removed.` });
      setTimeout(() => setMessage(null), 3000);
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to remove." });
    }
    setRemovingId(null);
  }

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-display text-ink-900">Photo Categories</h1>
        <p className="text-ink-500 text-sm mt-1">
          Manage the category list available when labelling photos. Standard categories are built-in and cannot be removed. Custom categories are saved here and appear in all listings.
        </p>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-ctl text-sm ${
          message.type === "success" ? "bg-success-50 border border-success-200 text-success-700" : "bg-danger-50 border border-danger-200 text-danger-700"
        }`}>
          {message.text}
        </div>
      )}

      {/* Add new */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 mb-6">
        <h2 className="text-h2 text-ink-900 mb-3">Add Custom Category</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Skylounge, Laundry Room..."
            className="flex-1 border border-hairline-strong rounded-ctl px-3 py-2 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-ink-950 font-semibold text-sm px-4 py-2 rounded-ctl transition-colors duration-fast ease-quiet"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
      </div>

      {/* Custom categories */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Custom Categories ({custom.length})</h2>
          <p className="text-xs text-ink-500 mt-0.5">Added manually or auto-saved when a new category is typed in a listing.</p>
        </div>
        {custom.length === 0 ? (
          <div className="py-10 text-center text-ink-400 text-sm">No custom categories yet.</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {custom.map((cat) => (
              <li key={cat.id} className="px-5 py-3 flex items-center justify-between">
                <span className="text-sm text-ink-900">{cat.name}</span>
                <button
                  onClick={() => handleDelete(cat)}
                  disabled={removingId === cat.id}
                  className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50 transition-colors duration-fast ease-quiet"
                >
                  {removingId === cat.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Standard categories — read only reference */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        <div className="px-5 py-4 border-b border-hairline">
          <h2 className="text-h2 text-ink-900">Standard Categories ({PHOTO_CATEGORIES.length})</h2>
          <p className="text-xs text-ink-500 mt-0.5">Built-in — always available. To add a new one permanently, update the codebase.</p>
        </div>
        <div className="p-5 flex flex-wrap gap-2">
          {PHOTO_CATEGORIES.map((cat) => (
            <span key={cat} className="text-xs bg-ink-100 text-ink-600 rounded-full px-3 py-1">{cat}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
