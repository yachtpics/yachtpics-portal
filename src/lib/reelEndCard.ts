import { fillTrackedCentered, wrapTracked } from "@/lib/canvasText";
import type { ReelStyle } from "@/lib/reelStyles";
import type { BrokerCard } from "@/lib/yachtpicsBrand";

/**
 * The reel's end card — moved out of ReelMaker (Oct 31) unchanged, so the
 * admin "In Review" reel signs off with exactly the card a YachtPics-branded
 * listing reel does. ReelMaker's drawEndCard now just calls this.
 *
 * Draws the whole frame (ground included) at `alpha`. `name` may be empty
 * (no headline, no hairline under it) — the In Review reel's case; a listing
 * reel always passes one.
 */
export type ReelEndCardOpts = {
  W: number;
  H: number;
  /** Scale off the short edge (min(W, H) / 1080). */
  sc: number;
  alpha: number;
  /** The look, already branded (applyBrand). */
  st: ReelStyle;
  serifFamily: string;
  sans: string;
  /** The vessel (or Studio title); "" for none. */
  name: string;
  /** Year · builder · model line under the name; "" for none. */
  builder: string;
  logo: ImageBitmap | null;
  /** YachtPics' own card (credit line, portal line, hook) instead of the broker's. */
  yp: boolean;
  /** The listing broker, credited first on our card. Null: nobody to credit. */
  broker: BrokerCard | null;
  /** The card whose contact line closes it (ours when yp). */
  card: BrokerCard;
};

export function drawReelEndCard(ctx: CanvasRenderingContext2D, o: ReelEndCardOpts) {
  const { W, H, sc, alpha, st, serifFamily, sans, name, builder, logo, yp, broker, card } = o;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = st.ground;
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const capSize = 28 * sc;
  const items: { h: number; draw: (y: number) => void }[] = [];

  // The boat first, then the person. The last frame is the one a buyer
  // screenshots — it should carry the name, the essentials and the way
  // to reach the broker, so it works on its own.
  //
  // It is set in the LOOK's own voice: Cinematic's wide light caps,
  // Gallery's light sans, Editorial's serif. One generic card at the
  // end undid the choice the broker made at the start.
  const endFamily = st.serifHeadline ? `${serifFamily}, Georgia, serif` : sans;
  const endWeight = st.serifHeadline ? (st.headline === "caps" ? 400 : 600) : (st.headWeight ?? 600);
  // Cased exactly as the title frame cased it.
  const endText =
    st.headline === "caps" || st.headline === "editorial" ? name.toUpperCase()
    : st.headline === "title" ? name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    : name;
  // The vessel is the largest thing on the card by a clear margin — the
  // broker's name used to be set nearly as big, which read as a business
  // card with a boat on it.
  const endName = (name.length > 22 ? 68 : name.length > 14 ? 82 : 96) * sc;
  ctx.font = `${endWeight} ${endName}px ${endFamily}`;
  const endLines = name ? wrapTracked(ctx, endText, W - 120 * sc, st.headTrack * sc) : [];
  // No headline (the In Review reel's closing card): the card opens on the
  // logo. A listing reel always has one ("Now Available" at worst).
  if (endLines.length > 0) items.push({ h: endName * 0.94 * endLines.length + 16 * sc, draw: (y) => {
    ctx.fillStyle = st.text;
    ctx.font = `${endWeight} ${endName}px ${endFamily}`;
    endLines.forEach((ln, li) => fillTrackedCentered(ctx, ln, cx, y + endName * 0.8 + li * endName * 0.94, st.headTrack * sc));
  } });
  // Just the year, builder and model under the name. The specs already
  // had their moment on the opening frame; the last frame is the boat's
  // name and the person to call.
  if (builder) {
    // Measured with its tracking and wrapped if it must — "2023 HATTERAS
    // 105 RAISED PILOTHOUSE MOTORYACHT" is wider than the frame.
    ctx.font = `600 ${25 * sc}px ${sans}`;
    const bLines = wrapTracked(ctx, builder.toUpperCase(), W - 140 * sc, 7 * sc);
    const lineH = capSize + 10 * sc;
    items.push({ h: lineH * bLines.length + 2 * sc, draw: (y) => {
      ctx.fillStyle = st.accent; ctx.font = `600 ${25 * sc}px ${sans}`;
      bLines.forEach((ln, li) => fillTrackedCentered(ctx, ln, cx, y + capSize + li * lineH, 7 * sc));
    } });
  }
  // A hairline between the boat and the broker — the same weight as the
  // title's, so it survives the encode.
  if (endLines.length > 0 || builder) items.push({ h: 84 * sc, draw: (y) => {
    ctx.fillStyle = st.light ? "rgba(20,26,33,0.35)" : "rgba(255,255,255,0.40)";
    ctx.fillRect(cx - 48 * sc, y + 42 * sc, 96 * sc, Math.max(1.5, 2.2 * sc));
  } });

  if (logo) {
    const lg = logo;
    const aspect = lg.width / lg.height;
    // A wide wordmark (the YachtPics mark is 6.5:1) gets the width it
    // needs; a squarer brokerage crest keeps the 360px column.
    let lw = (aspect > 3 ? W * 0.62 : 360 * sc), lh = lw / aspect;
    const maxLh = 150 * sc;
    if (lh > maxLh) { lh = maxLh; lw = lh * aspect; }
    items.push({ h: lh + 44 * sc, draw: (y) => { ctx.globalAlpha = alpha * 0.96; ctx.drawImage(lg, cx - lw / 2, y, lw, lh); ctx.globalAlpha = alpha; } });
  }
  const nameSize = 48 * sc;
  const personLine = (text: string) => ({ h: nameSize + 16 * sc, draw: (y: number) => {
    ctx.fillStyle = st.text;
    ctx.font = `${st.serifHeadline ? 500 : 400} ${nameSize}px ${endFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(text, cx, y + nameSize * 0.8); ctx.textAlign = "left";
  } });
  const capsLine = (text: string, colour: string, size = capSize - 3 * sc, gap = 22 * sc) => ({ h: size + gap, draw: (y: number) => {
    ctx.fillStyle = colour; ctx.font = `600 ${size}px ${sans}`;
    fillTrackedCentered(ctx, text.toUpperCase(), cx, y + size, 7 * sc);
  } });
  const contactLine = (text: string) => ({ h: capSize + 48 * sc, draw: (y: number) => {
    ctx.fillStyle = st.accent; ctx.font = `500 ${capSize}px ${sans}`;
    fillTrackedCentered(ctx, text, cx, y + capSize + 26 * sc, 3 * sc);
  } });
  const contactFor = (c: BrokerCard) => {
    // Phone and site if we have them; the email if we don't. A call to
    // action with nothing under it is a door with no handle.
    const bits = [c.phone, c.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean) as string[];
    if (bits.length === 0 && c.email) bits.push(c.email);
    return bits.join("   ·   ");
  };

  if (yp) {
    // Our card credits the broker first — the way Samantha's Facebook
    // posts do ("another great boat shot for…"), which is where most of
    // her clients have come from. A broker who sees a peer credited
    // asks how to get the same. Then the portal, then us.
    // A Studio reel may have no broker behind it — photographs off the
    // phone, nobody to credit. Then the card goes straight to the portal.
    if (broker) {
      items.push(capsLine("Photographed for", st.quiet, 22 * sc, 14 * sc));
      items.push(personLine(broker.name));
      if (broker.brokerage) items.push(capsLine(broker.brokerage, st.soft));
      const brokerContact = [broker.phone, broker.email].filter(Boolean).join("   ·   ");
      if (brokerContact) items.push(contactLine(brokerContact));
      items.push({ h: 72 * sc, draw: (y) => {
        ctx.fillStyle = "rgba(255,255,255,0.40)";
        ctx.fillRect(cx - 48 * sc, y + 36 * sc, 96 * sc, Math.max(1.5, 2.2 * sc));
      } });
    }
    items.push(capsLine("Powered by the YachtPics Portal", st.accent, 25 * sc, 18 * sc));
    items.push(contactLine(contactFor(card)));
    // The hook. Not what the portal is — what it did, and could do for
    // the broker watching. That's the line that gets the question asked.
    items.push({ h: capSize + 44 * sc, draw: (y) => {
      ctx.fillStyle = st.text; ctx.font = `italic 400 ${34 * sc}px ${serifFamily}, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText("Your listings, delivered like this.", cx, y + capSize + 40 * sc);
      ctx.textAlign = "left";
    } });
  } else {
    // The person: clearly secondary to the boat. Regular weight, and in
    // the serif looks the serif at its book weight rather than bold.
    if (card.name) items.push(personLine(card.name));
    if (card.brokerage) items.push(capsLine(card.brokerage, st.soft));
    const contact = contactFor(card);
    if (contact) items.push(contactLine(contact));
    // The invitation, with real air above it — it closes the card, it
    // doesn't crowd the contact line.
    items.push({ h: capSize + 44 * sc, draw: (y) => {
      ctx.fillStyle = st.quiet; ctx.font = `500 ${22 * sc}px ${sans}`;
      fillTrackedCentered(ctx, "REQUEST A PRIVATE SHOWING", cx, y + capSize + 40 * sc, 7 * sc);
    } });
  }

  const stackH = items.reduce((a, b) => a + b.h, 0);
  let y = (H - stackH) / 2;
  for (const it of items) { it.draw(y); y += it.h; }

  // Quiet credit line — the portal's own mark, the way a good house
  // signs its work. Redundant on our own card.
  if (!yp) {
    ctx.fillStyle = st.light ? "rgba(20,26,33,0.32)" : "rgba(255,255,255,0.30)";
    ctx.font = `500 ${18 * sc}px ${sans}`;
    fillTrackedCentered(ctx, "MADE WITH THE YACHTPICS PORTAL", cx, H - 60 * sc, 6 * sc);
  }
  ctx.restore();
}
