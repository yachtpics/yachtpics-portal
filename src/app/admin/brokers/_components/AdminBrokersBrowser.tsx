"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DeleteBrokerButton from "../[id]/DeleteBrokerButton";

export type BrokerRow = {
  id: string;
  name: string;
  brokerage: string;
  email: string | null;
  phone: string | null;
  invitedByName: string;
  status: string;
  trialDays: number | null;
  invited: boolean;
  emailBounced: boolean;
  bounceReason: string | null;
};

export default function AdminBrokersBrowser({ brokers }: { brokers: BrokerRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brokers;
    return brokers.filter((b) =>
      [b.name, b.brokerage, b.email, b.phone, b.invitedByName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [brokers, query]);

  return (
    <div>
      <div className="relative mb-5">
        <svg className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, brokerage, email, phone…"
          className="w-full bg-white border border-hairline-strong rounded-ctl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-colors duration-fast ease-quiet"
        />
      </div>

      <p className="text-xs text-ink-500 mb-3 tabular-nums">{filtered.length} of {brokers.length} brokers</p>

      {filtered.length === 0 ? (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 py-12 text-center">
          <p className="text-ink-400 text-sm">No brokers match &ldquo;{query}&rdquo;.</p>
        </div>
      ) : (
        <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-4 sm:px-6 py-3 label-caps">Broker</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden sm:table-cell">Brokerage</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden md:table-cell">Contact</th>
                <th className="px-4 sm:px-6 py-3 label-caps hidden lg:table-cell">Added By</th>
                <th className="px-4 sm:px-6 py-3 label-caps">Plan</th>
                <th className="px-4 sm:px-6 py-3 label-caps sticky right-0 bg-white"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered.map((broker) => (
                <tr key={broker.id} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                  <td className="px-4 sm:px-6 py-4">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink-900">{broker.name}</p>
                      {broker.invited && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warn-50 text-warn-700 border border-warn-200">
                          Invited
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-ink-500 hidden sm:table-cell">{broker.brokerage}</td>
                  <td className="px-4 sm:px-6 py-4 text-ink-500 hidden md:table-cell">
                    <p>{broker.email ?? "—"}</p>
                    {broker.emailBounced && (
                      <span title={broker.bounceReason ?? "Email bounced"} className="inline-block mt-0.5 text-[11px] font-semibold text-danger-600 bg-danger-50 border border-danger-200 rounded-full px-2 py-0.5">
                        ⚠ Email bouncing
                      </span>
                    )}
                    <p className="text-xs text-ink-400">{broker.phone ?? ""}</p>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-ink-500 hidden lg:table-cell">{broker.invitedByName}</td>
                  <td className="px-4 sm:px-6 py-4">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      broker.status === "active" ? "bg-success-50 text-success-700 border-success-200"
                      : broker.status === "trialing" ? "bg-warn-50 text-warn-700 border-warn-200"
                      : "bg-ink-100 text-ink-600 border-hairline"
                    }`}>
                      {broker.status === "trialing" && broker.trialDays !== null ? `Trial · ${broker.trialDays}d` : broker.status}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 text-right sticky right-0 bg-white whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)]">
                    <div className="flex items-center justify-end gap-4">
                      <DeleteBrokerButton brokerId={broker.id} brokerName={broker.name} />
                      <Link href={`/admin/brokers/${broker.id}`}
                        className="text-accent-700 hover:text-accent-800 text-xs font-medium transition-colors duration-fast ease-quiet">
                        Manage →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
