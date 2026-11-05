/**
 * Plain-English description of where a slideshow view came from, for the
 * "new view" alert a broker gets (src/lib/viewNotifyEmail.ts). Pure helpers —
 * no database, safe on server and client.
 *
 * `source` is what /s/{slug}?src= (or ?from=, or the /yp link's ?via=) stored
 * on slideshow_views.source. See src/app/s/[slug]/page.tsx and src/lib/ypShare.ts.
 */

export type ViewSourceInfo = {
  /** Short name, e.g. "Direct link". Used in the subject line and the details table. */
  label: string;
  /** One sentence a broker can act on: what this source is and what it tells them. */
  detail: string;
  /** True when the view is tied to a named Send to Client recipient. */
  named: boolean;
};

export function describeViewSource(opts: {
  source: string | null;
  /** A tracked Send to Client link matched a recipient. */
  tracked: boolean;
  /** The view happened inside a broker's own Portal website (/b/{site}). */
  onBrokerSite?: boolean;
  /** boat_shows.key → short name, for dock cards scanned at a show. */
  showNames?: Record<string, string>;
}): ViewSourceInfo {
  const src = (opts.source ?? "link").toLowerCase();

  if (opts.tracked) {
    return {
      label: "Send to Client email",
      detail: "Opened from the personal link in the email you sent through the Portal, so the view is tied to that client.",
      named: true,
    };
  }

  const showName = opts.showNames ? opts.showNames[src] : undefined;
  if (showName) {
    return {
      label: `Dock card at ${showName}`,
      detail: `Someone scanned the QR code on her dock card at ${showName}.`,
      named: false,
    };
  }

  switch (src) {
    case "send":
      return {
        label: "Send to Client email",
        detail: "Opened from a Send to Client email, but without the personal link — most likely forwarded on, so there's no name attached.",
        named: false,
      };
    case "qr":
      return { label: "QR code", detail: "Someone scanned her slideshow QR code.", named: false };
    case "share":
      return { label: "Shared link", detail: "Opened from a link passed on with the slideshow's Share button — one viewer sending her to another.", named: false };
    case "social":
      return { label: "Social media", detail: "Opened from a social media post.", named: false };
    case "flyer":
      return { label: "Spec sheet", detail: "Opened from the link or QR code on her spec sheet.", named: false };
    case "site":
      return opts.onBrokerSite
        ? { label: "Your website", detail: "Viewed on her page on your own website.", named: false }
        : { label: "yachtpics.com", detail: "Opened from her page on yachtpics.com.", named: false };
    case "showcase":
      return { label: "Portal showcase", detail: "Opened from the YachtPics Portal's sample pages — often another broker looking at what the Portal does, not necessarily a buyer.", named: false };
    case "yp_site":
      return { label: "yachtpics.com", detail: "Opened from her page on yachtpics.com — a visitor browsing the boats YachtPics has photographed.", named: false };
    case "yp_social":
      return { label: "YachtPics social", detail: "Opened from a reel or post YachtPics shared on social media.", named: false };
    case "yp_card":
      return { label: "Dock card", detail: "Someone scanned the QR code on her dock card.", named: false };
    case "yachtpics":
      return { label: "YachtPics link", detail: "Opened from a link YachtPics shared.", named: false };
    case "link":
      return {
        label: "Direct link",
        detail: "Opened from the slideshow link itself — copied, texted or pasted somewhere — so there's no name attached.",
        named: false,
      };
    default:
      return { label: src, detail: "Opened from a link tagged “" + src + "”.", named: false };
  }
}

/** "iPhone", "Windows computer", … from a User-Agent header. Null when unknown. */
export function describeDevice(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  let device: string | null = null;
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  else if (/Windows/i.test(ua)) device = "Windows computer";
  else if (/Macintosh|Mac OS X/i.test(ua)) device = "Mac";
  else if (/CrOS/i.test(ua)) device = "Chromebook";
  else if (/Linux/i.test(ua)) device = "Linux computer";
  if (!device) return null;

  // In-app browsers say a lot about where the link was tapped.
  let app: string | null = null;
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) app = "Facebook app";
  else if (/Instagram/i.test(ua)) app = "Instagram app";
  else if (/LinkedInApp/i.test(ua)) app = "LinkedIn app";
  else if (/WhatsApp/i.test(ua)) app = "WhatsApp";
  else if (/Edg\//i.test(ua)) app = "Edge";
  else if (/CriOS|Chrome\//i.test(ua)) app = "Chrome";
  else if (/FxiOS|Firefox\//i.test(ua)) app = "Firefox";
  else if (/Safari\//i.test(ua)) app = "Safari";
  return app ? `${device} · ${app}` : device;
}

/**
 * The site a viewer clicked through from (host only), or null. Our own pages
 * are dropped — the source already says "yachtpics.com" / "your website".
 */
export function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== "string" || !referrer) return null;
  try {
    const host = new URL(referrer.slice(0, 500)).hostname.toLowerCase().replace(/^(www|m|l|lm)\./, "");
    if (!host || !/^[a-z0-9.-]{3,80}$/.test(host)) return null;
    if (host === "yachtpics.com" || host.slice(-14) === ".yachtpics.com") return null;
    return host;
  } catch {
    return null;
  }
}

/** "Fort Lauderdale, FL" / "Monaco" from Vercel's geo headers. Null when unknown. */
export function describeLocation(h: { city?: string | null; region?: string | null; country?: string | null }): string | null {
  let city = h.city ?? "";
  try { city = decodeURIComponent(city); } catch { /* keep as sent */ }
  city = city.replace(/[<>&"]/g, "").trim().slice(0, 60);
  const region = (h.region ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
  const country = (h.country ?? "").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  if (!city && !country) return null;
  if (country === "US") return city ? (region ? `${city}, ${region}` : city) : (region ? `${region}, US` : "United States");
  let countryName = country;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    countryName = (country && dn.of(country)) || country;
  } catch { /* older runtime — keep the code */ }
  // City-states: "Monaco", not "Monaco, Monaco".
  return city ? (countryName && countryName !== city ? `${city}, ${countryName}` : city) : countryName || null;
}
