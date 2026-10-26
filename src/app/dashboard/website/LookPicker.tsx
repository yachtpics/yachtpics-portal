"use client";

import {
  LAYOUT_DEFAULT_PALETTE,
  LAYOUT_LABELS,
  PALETTES,
  SITE_LAYOUTS,
  cleanHex,
  isLayout,
  paletteByKey,
  resolveSiteStyle,
  type Palette,
  type SiteLayout,
} from "@/lib/siteStyle";

/**
 * Dashboard → Website → Look (Oct 26): three layouts, six palettes, the
 * broker's brand colour or a custom accent, with a live legibility note and a
 * Preview of the unsaved choice (/b/{slug}/preview — owner/team/admin only).
 */

export type Look = { layout: string; palette: string; accent: string | null };

function Mock({ layout, p, accent }: { layout: SiteLayout; p: Palette; accent: string }) {
  // A tiny static sketch of each layout in the chosen colours (not a screenshot).
  const photo = p.dark ? "#2a3446" : "#c9d3dc";
  const ink = p.ink;
  const rule = p.dark ? "#3a4456" : "#d9dde2";
  if (layout === "editorial") {
    return (
      <svg viewBox="0 0 120 80" className="w-full h-auto" aria-hidden>
        <rect width="120" height="80" fill={p.bg} />
        <rect x="8" y="14" width="40" height="7" fill={ink} />
        <rect x="8" y="24" width="30" height="7" fill={ink} />
        <rect x="8" y="35" width="10" height="1.2" fill={accent} />
        <rect x="8" y="40" width="34" height="2" fill={rule} />
        <rect x="8" y="44" width="28" height="2" fill={rule} />
        <rect x="8" y="52" width="16" height="6" fill={accent} />
        <rect x="62" y="8" width="50" height="64" fill={photo} />
      </svg>
    );
  }
  if (layout === "showroom") {
    return (
      <svg viewBox="0 0 120 80" className="w-full h-auto" aria-hidden>
        <rect width="120" height="80" fill={p.bg} />
        <rect width="120" height="50" fill={photo} />
        <rect x="0" y="30" width="120" height="20" fill="#000" opacity="0.35" />
        <rect x="45" y="36" width="30" height="3" fill="#fff" />
        <rect x="55" y="42" width="10" height="0.8" fill={accent} />
        <rect x="6" y="55" width="52" height="22" fill={photo} />
        <rect x="62" y="55" width="52" height="22" fill={photo} />
        <rect x="10" y="71" width="20" height="2.5" fill="#fff" />
        <rect x="66" y="71" width="20" height="2.5" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 80" className="w-full h-auto" aria-hidden>
      <rect width="120" height="80" fill={p.bg} />
      <rect width="120" height="42" fill={photo} />
      <rect x="8" y="24" width="44" height="6" fill="#fff" />
      <rect x="8" y="33" width="14" height="5" fill={accent} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={8 + i * 36} y="50" width="32" height="18" fill={photo} />
          <rect x={8 + i * 36} y="71" width="20" height="2.5" fill={ink} />
        </g>
      ))}
    </svg>
  );
}

export default function LookPicker({
  look,
  onChange,
  brandAccent,
  slug,
  ready,
}: {
  look: Look;
  onChange: (next: Look) => void;
  brandAccent: string | null;
  slug: string;
  ready: boolean;
}) {
  const layout: SiteLayout = isLayout(look.layout) ? look.layout : "classic";
  const palette = paletteByKey(look.palette);
  const resolved = resolveSiteStyle(look);
  const brand = cleanHex(brandAccent);
  const custom = cleanHex(look.accent);
  const usingBrand = !!brand && custom === brand;

  const pickLayout = (l: SiteLayout) => {
    // A palette the broker hasn't changed follows the layout's suggestion (Showroom → Midnight).
    const untouched = palette.key === LAYOUT_DEFAULT_PALETTE[layout];
    onChange({ ...look, layout: l, palette: untouched ? LAYOUT_DEFAULT_PALETTE[l] : palette.key });
  };

  const preview = () => {
    const q = new URLSearchParams({ layout, palette: palette.key, accent: custom ?? "none" });
    window.open(`/b/${encodeURIComponent(slug)}/preview?${q.toString()}`, "_blank", "noopener");
  };

  return (
    <div>
      {!ready && (
        <p className="mb-4 text-xs text-warn-800 bg-warn-50 border border-warn-200 rounded-ctl px-3 py-2">
          Layouts and colours aren&rsquo;t switched on yet — you can try them with Preview, but saving won&rsquo;t change your site until they are.
        </p>
      )}

      <p className="label-caps mb-2">Layout</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {SITE_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => pickLayout(l)}
            aria-pressed={layout === l}
            className={`text-left rounded-card border p-3 transition-colors duration-fast ${layout === l ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}
          >
            <div className="rounded-ctl overflow-hidden border border-hairline">
              <Mock layout={l} p={palette} accent={resolved.accent} />
            </div>
            <p className="mt-2 text-sm font-semibold text-ink-900">{LAYOUT_LABELS[l].name}</p>
            <p className="text-xs text-ink-500">{LAYOUT_LABELS[l].blurb}</p>
          </button>
        ))}
      </div>

      <p className="label-caps mt-6 mb-2">Colours</p>
      <div className="flex flex-wrap gap-3">
        {PALETTES.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange({ ...look, palette: p.key })}
            aria-pressed={palette.key === p.key}
            className={`flex flex-col items-center gap-1.5 rounded-card border px-3 py-2.5 min-w-[84px] transition-colors duration-fast ${palette.key === p.key ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}
          >
            <span className="relative block h-9 w-14 rounded-ctl overflow-hidden border border-hairline" style={{ background: p.bg }}>
              <span className="absolute left-1.5 top-1.5 h-1.5 w-7" style={{ background: p.ink }} />
              <span className="absolute left-1.5 top-4 h-1 w-5" style={{ background: p.muted }} />
              <span className="absolute right-1.5 bottom-1.5 h-3 w-4" style={{ background: p.accent }} />
            </span>
            <span className="text-xs font-medium text-ink-800">{p.name}</span>
          </button>
        ))}
      </div>

      <p className="label-caps mt-6 mb-2">Accent colour</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...look, accent: null })}
          aria-pressed={!custom}
          className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-ctl border text-sm ${!custom ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}
        >
          <span className="h-4 w-4 rounded-full border border-hairline" style={{ background: palette.accent }} /> {palette.name}&rsquo;s own
        </button>
        {brand && (
          <button
            type="button"
            onClick={() => onChange({ ...look, accent: brand })}
            aria-pressed={usingBrand}
            className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-ctl border text-sm ${usingBrand ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}
          >
            <span className="h-4 w-4 rounded-full border border-hairline" style={{ background: brand }} /> My brand colour
          </button>
        )}
        <label className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-ctl border text-sm cursor-pointer ${custom && !usingBrand ? "border-accent-500 ring-1 ring-accent-500" : "border-hairline-strong hover:border-ink-400"}`}>
          <input
            type="color"
            value={custom ?? palette.accent}
            onChange={(e) => onChange({ ...look, accent: e.target.value })}
            className="h-6 w-6 p-0 border-0 bg-transparent cursor-pointer"
            aria-label="Pick a custom accent colour"
          />
          Custom{custom && !usingBrand ? ` ${custom}` : ""}
        </label>
      </div>
      {custom && (
        <p className="mt-2 text-xs text-ink-600 flex items-center gap-2">
          {resolved.accentAdjusted ? (
            <>
              <span className="h-3 w-3 rounded-full border border-hairline" style={{ background: custom }} />→
              <span className="h-3 w-3 rounded-full border border-hairline" style={{ background: resolved.accent }} />
              Adjusted slightly ({resolved.accent}) so buttons and text on it stay easy to read on {palette.name}.
            </>
          ) : (
            <>Reads well on {palette.name}: buttons use {resolved.onAccent === "#ffffff" ? "white" : "dark"} text.</>
          )}
        </p>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={preview}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 border border-hairline-strong text-ink-800 hover:bg-ink-50 text-sm font-medium rounded-ctl transition-colors duration-fast"
        >
          Preview
        </button>
        <span className="ml-3 text-xs text-ink-500">Opens your site in a new tab with these choices (only you can see it). Save to apply them.</span>
      </div>
    </div>
  );
}
