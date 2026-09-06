"use client";

import { useEffect, useState } from "react";
import type { EngagementSummary } from "@/lib/engagement";

/**
 * The Engagement panel on a listing page: who's looking, for how long, and at
 * what. Reads /api/listings/[id]/engagement once on mount. Thumbnails come
 * from the page's existing thumbs map so nothing is signed twice.
 */

function fmtDuration(s: number | null) {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

const SOURCE_LABEL: Record<string, string> = {
  send: "Emailed", qr: "QR code", link: "Direct link", share: "Shared link", social: "Social", flyer: "Spec sheet", site: "yachtpics.com", showcase: "Showcase",
};

export default function ListingEngagement({ listingId, thumbs, reloadKey = 0 }: { listingId: string; thumbs: Record<string, string>; reloadKey?: number }) {
  const [data, setData] = useState<EngagementSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/listings/${listingId}/engagement`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [listingId, reloadKey]);

  const maxDay = data ? Math.max(1, ...data.byDay.map((d) => d.views)) : 1;

  return (
    <div className="mt-8 bg-white border border-hairline rounded-card shadow-elev-1">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-hairline flex-wrap">
        <div>
          <h2 className="label-caps text-ink-600">Engagement</h2>
          <p className="text-ink-500 text-xs mt-0.5">What buyers do in your slideshow — how long they stay, what they linger on, what they save.</p>
        </div>
        <a
          href={`/report/listing/${listingId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-ink-700 hover:text-ink-900 border border-hairline-strong hover:border-ink-400 px-3 py-1.5 rounded-ctl transition-colors duration-fast whitespace-nowrap"
          title="A one-page report to forward to the owner"
        >
          Seller Report ↗
        </a>
      </div>

      {failed ? (
        <p className="px-6 py-8 text-sm text-ink-400 text-center">Couldn&rsquo;t load engagement right now.</p>
      ) : !data ? (
        <div className="px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-ctl bg-ink-50 animate-pulse" />)}
        </div>
      ) : data.views === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-ink-400 text-sm">No views yet.</p>
          <p className="text-ink-300 text-xs mt-1">Once the slideshow is published and shared, this fills in on its own.</p>
        </div>
      ) : (
        <div className="px-6 py-5">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
            {[
              ["Views", String(data.views), `${data.views30d} in 30 days`],
              ["Unique visitors", String(data.uniqueVisitors), `${data.views7d} views this week`],
              ["Time per visit", fmtDuration(data.avgSeconds), data.avgPhotosSeen ? `${data.avgPhotosSeen} photos seen` : "—"],
              ["Saved photos", String(data.favoritesTotal), data.leads ? `${data.leads} ${data.leads === 1 ? "inquiry" : "inquiries"}` : "no inquiries yet"],
            ].map(([label, value, note]) => (
              <div key={label} className="border-t border-hairline pt-2.5">
                <p className="label-caps text-ink-500">{label}</p>
                <p className="text-2xl font-light text-ink-900 mt-1 tabular-nums leading-none">{value}</p>
                <p className="text-xs text-ink-400 mt-1.5">{note}</p>
              </div>
            ))}
          </div>

          {/* 30-day bars */}
          <div className="mt-6">
            <p className="label-caps text-ink-500 mb-2">Last 30 days</p>
            <svg viewBox="0 0 600 64" className="w-full h-16" role="img" aria-label="Daily views over the last 30 days">
              <line x1="0" y1="55.5" x2="600" y2="55.5" stroke="rgba(5,11,20,0.10)" strokeWidth="1" />
              {data.byDay.map((d, i) => {
                const h = d.views ? Math.max(3, (d.views / maxDay) * 48) : 0;
                return <rect key={d.day} x={i * 20 + 3} y={55 - h} width={14} height={h} fill={d.views ? "#c39e4e" : "#eef0f2"} rx="1"><title>{d.day}: {d.views}</title></rect>;
              })}
              <text x="10" y="63" fontSize="8" fill="#99a2ad">30 days ago</text>
              <text x="590" y="63" fontSize="8" fill="#99a2ad" textAnchor="end">today</text>
            </svg>
          </div>

          <div className="mt-6 grid md:grid-cols-[1.4fr_1fr] gap-6">
            {/* What buyers linger on */}
            <div>
              <p className="label-caps text-ink-500 mb-2">What buyers linger on</p>
              {data.topPhotos.length === 0 ? (
                <p className="text-xs text-ink-400">Photo-level detail appears once buyers spend time in the gallery.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {data.topPhotos.slice(0, 8).map((tp) => (
                    <div key={tp.photo_id}>
                      <div className="aspect-[4/3] bg-ink-50 rounded-sm overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {thumbs[tp.photo_id] && <img src={thumbs[tp.photo_id]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                      </div>
                      <p className="text-[11px] font-semibold text-ink-900 mt-1 truncate">{tp.category ?? "Photo"}</p>
                      <p className="text-[10px] text-ink-400 tabular-nums">
                        {fmtDuration(tp.dwellSeconds)} · {tp.looks} {tp.looks === 1 ? "look" : "looks"}{tp.favorites ? ` · ♥ ${tp.favorites}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sources + extras */}
            <div>
              <p className="label-caps text-ink-500 mb-2">Where views come from</p>
              <ul className="text-sm">
                {data.bySource.map((s) => (
                  <li key={s.source} className="flex justify-between py-1.5 border-b border-hairline">
                    <span className="text-ink-700">{SOURCE_LABEL[s.source] ?? s.source}</span>
                    <span className="text-ink-900 font-medium tabular-nums">{s.views}</span>
                  </li>
                ))}
              </ul>
              {(data.videoPlays > 0 || data.tourClicks > 0 || data.detailsViews > 0) && (
                <div className="mt-3 text-xs text-ink-500 space-y-1">
                  {data.videoPlays > 0 && <p>Video played <span className="font-semibold text-ink-800">{data.videoPlays}</span> {data.videoPlays === 1 ? "time" : "times"}</p>}
                  {data.tourClicks > 0 && <p>360° tour opened <span className="font-semibold text-ink-800">{data.tourClicks}</span> {data.tourClicks === 1 ? "time" : "times"}</p>}
                  {data.detailsViews > 0 && <p>Specs read <span className="font-semibold text-ink-800">{data.detailsViews}</span> {data.detailsViews === 1 ? "time" : "times"}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
