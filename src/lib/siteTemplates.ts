// Static page templates for yachtpics.com. These mirror the live site's markup
// exactly (see waterfront_yacht_brokerage.html) so generated pages are
// indistinguishable from the hand-built ones: same head, nav, page-hero, footer.
//
// The boat page carries a static port of the portal slideshow — the same
// no-crop-on-paper look and staggered crossfade — so new boats get the portal
// slideshow while the old Juicebox galleries stay exactly where they are.

const GA_ID = "G-5FZT6F7ES3";
const SITE = "https://www.yachtpics.com";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Slug matching the existing archive: 52_prestige_simmer_down, 41_valhalla_41820.
 * Derived from the label so hull-number boats don't stutter in the URL too
 * ("25 Sportsman Open 252 28276" → 25_sportsman_open_252_28276, not
 * 25_sportsman_25_sportsman_open_252_28276).
 */
export function boatSlug(opts: { lengthFt?: string | null; make?: string | null; vesselName?: string | null }): string {
  return boatLabel(opts)
    .toLowerCase()
    .replace(/["'’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Display label, matching the convention the hand-built archive already uses:
 *
 *   Named boat      52 Prestige "Simmer Down"     — length, make, name in quotes
 *   Unnamed boat    41 Valhalla 41820             — hull number, verbatim, no quotes
 *                   40 Novamarine BS 120
 *
 * New boats often have no name, so brokers identify them by hull number — and
 * they type the whole thing into the name field ("25 Sportsman Open 252 28276").
 * Blindly quoting that and prefixing length+make gives
 * `25 Sportsman "25 Sportsman Open 252 28276"`, which stutters. So: if the name
 * already carries the make AND a number, it's a hull/model descriptor — use it
 * as-is. Otherwise it's a real name, and it gets the quotes.
 */
export function boatLabel(opts: { lengthFt?: string | null; make?: string | null; vesselName?: string | null }): string {
  const head = [opts.lengthFt, opts.make].filter(Boolean).join(" ");
  const name = opts.vesselName?.trim();
  if (!name) return head;

  const make = opts.make?.trim().toLowerCase();
  const isDescriptor = Boolean(make && name.toLowerCase().includes(make) && /\d/.test(name));

  return isDescriptor ? name : `${head} "${name}"`.trim();
}

function head(opts: { title: string; description: string; canonical: string; depth: number }): string {
  const base = opts.depth > 0 ? "../".repeat(opts.depth) : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}styles.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${opts.canonical}">
</head>
<body>`;
}

function nav(depth: number): string {
  const b = depth > 0 ? "../".repeat(depth) : "";
  return `<header>
  <div class="wrap nav">
    <a class="brand" href="${b}index.html">Yacht<span>Pics</span></a>
    <button class="menu-btn" aria-label="Menu" onclick="document.querySelector('nav ul').classList.toggle('open')">&#9776;</button>
    <nav aria-label="Main">
      <ul>
        <li><a href="${b}index.html">Home</a></li>
        <li><a href="${b}gallery.html">Gallery</a></li>
        <li><a href="${b}video.html">Video</a></li>
        <li><a href="${b}yacht-photos.html">Boats</a></li>
        <li><a href="${b}team.html">Team</a></li>
        <li><a href="${b}contact.html">Contact</a></li>
      </ul>
    </nav>
  </div>
</header>`;
}

function foot(): string {
  return `<footer>
  <div class="wrap foot">
    <div>&copy; ${new Date().getFullYear()} YachtPics.com &middot; Yacht Photography &amp; Video &middot; South Florida &amp; Worldwide</div>
    <div class="foot-nav">
      <a href="tel:+15616029710">561 602 9710</a>
      <a href="mailto:charlie@yachtpics.com">charlie@yachtpics.com</a>
      <a href="https://www.youtube.com/@yachtpics" rel="noopener">YouTube</a>
      <a href="https://twitter.com/yachtpics" rel="noopener">X / Twitter</a>
    </div>
  </div>
</footer>
</body>
</html>`;
}

export type BoatPageData = {
  label: string;
  slug: string;
  sitePage: string;
  brokerageName: string;
  vesselName: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lengthFt: string | null;
  vesselType: string | null;
  location: string | null;
  brokerName: string | null;
  brokerEmail: string | null;
  brokerPhone: string | null;
  photos: string[];
};

/** One boat: the portal slideshow, rendered static, inside the website's chrome. */
export function boatPage(d: BoatPageData): string {
  const specs = [
    d.year ? String(d.year) : null,
    d.make,
    d.model,
    d.lengthFt ? `${d.lengthFt}′` : null,
    d.vesselType,
    d.location,
  ].filter(Boolean);

  const title = `${d.label} — ${d.brokerageName} | YachtPics`;
  const description = `Yacht photography by YachtPics for ${d.label}${d.vesselType ? `, a ${d.vesselType.toLowerCase()}` : ""} listed with ${d.brokerageName}. ${d.photos.length} photographs.`;

  const thumbs = d.photos
    .map(
      (p, i) =>
        `<button class="yp-thumb" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${p}" alt="" loading="lazy" decoding="async"></button>`
    )
    .join("");

  return `${head({ title, description, canonical: `${SITE}/${d.sitePage}/${d.slug}/index.html`, depth: 2 })}
${nav(2)}
<main>
  <div class="page-hero">
    <div class="wrap">
      <p class="kicker">${esc(d.brokerageName)}</p>
      <h1>${esc(d.label)}</h1>
      ${specs.length ? `<p>${esc(specs.join(" · "))}</p>` : ""}
    </div>
  </div>

  <section style="padding:40px 0 24px">
    <div class="wrap">
      <div class="yp-stage" id="ypStage">
        <img class="yp-layer" id="ypA" alt="${esc(d.vesselName)}" decoding="sync">
        <img class="yp-layer" id="ypB" alt="" decoding="sync">
        <button class="yp-arrow yp-prev" id="ypPrev" aria-label="Previous photo">&lsaquo;</button>
        <button class="yp-arrow yp-next" id="ypNext" aria-label="Next photo">&rsaquo;</button>
      </div>

      <div class="yp-bar">
        <span class="yp-count" id="ypCount"></span>
        <button class="yp-toggle" id="ypToggle" aria-label="Show thumbnails" aria-pressed="false">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="2" y="6" width="4" height="8" rx="1"></rect>
            <rect x="8" y="6" width="4" height="8" rx="1"></rect>
            <rect x="14" y="6" width="4" height="8" rx="1"></rect>
          </svg>
        </button>
      </div>
      <div class="yp-thumbs" id="ypThumbs" hidden>${thumbs}</div>
    </div>
  </section>

  <section style="padding:0 0 96px">
    <div class="wrap">
      <div class="yp-broker">
        <div>
          <p class="kicker" style="color:var(--gold)">Listed by</p>
          ${d.brokerName ? `<h3 style="font-size:24px">${esc(d.brokerName)}</h3>` : ""}
          <p style="color:var(--ink-soft)">${esc(d.brokerageName)}</p>
        </div>
        <div class="yp-contact">
          ${d.brokerPhone ? `<a href="tel:${esc(d.brokerPhone)}">${esc(d.brokerPhone)}</a>` : ""}
          ${d.brokerEmail ? `<a href="mailto:${esc(d.brokerEmail)}">${esc(d.brokerEmail)}</a>` : ""}
        </div>
      </div>
      <p style="margin-top:40px">
        <a href="../../${d.sitePage}.html" style="border-bottom:1px solid var(--gold)">&larr; All ${esc(d.brokerageName)} yachts</a>
        &nbsp;&middot;&nbsp;
        <a href="../../contact.html" style="border-bottom:1px solid var(--gold)">Book a shoot</a>
      </p>
    </div>
  </section>
</main>

<style>
.yp-stage{position:relative;height:min(74vh,760px);background:var(--paper);overflow:hidden;display:flex;align-items:center;justify-content:center}
.yp-layer{position:absolute;inset:0;margin:auto;max-width:calc(100% - 24px);max-height:calc(100% - 24px);width:auto;height:auto;object-fit:contain;opacity:0;box-shadow:0 1px 2px rgba(12,20,32,.10),0 8px 24px rgba(12,20,32,.14),0 24px 60px rgba(12,20,32,.10)}
.yp-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--white);color:var(--ink);font-size:24px;line-height:1;cursor:pointer;transition:background .2s}
.yp-arrow:hover{background:var(--paper)}
.yp-prev{left:12px}.yp-next{right:12px}
.yp-bar{display:flex;align-items:center;justify-content:center;gap:14px;padding:14px 0 4px}
.yp-count{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft)}
.yp-toggle{background:none;border:0;color:#9aa5b1;cursor:pointer;display:flex;padding:4px;transition:color .15s}
.yp-toggle[aria-pressed="true"],.yp-toggle:hover{color:var(--ink)}
.yp-thumbs{display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px}
/* An author display rule beats the UA stylesheet's [hidden]{display:none},
   so the strip stays visible without this. Thumbnails are hidden by default —
   the photograph gets the space, exactly as in the portal. */
.yp-thumbs[hidden]{display:none}
.yp-thumb{flex:0 0 auto;border:0;padding:0;background:none;cursor:pointer;opacity:.5;transition:opacity .2s}
.yp-thumb:hover,.yp-thumb[aria-current="true"]{opacity:1}
.yp-thumb[aria-current="true"]{outline:1px solid var(--gold)}
.yp-thumb img{width:82px;height:54px;object-fit:cover}
.yp-broker{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:28px}
.yp-contact{display:flex;flex-direction:column;gap:4px;font-size:15px}
.yp-contact a{border-bottom:1px solid var(--gold-soft)}
@media(max-width:560px){.yp-stage{height:56vh}}
</style>

<script>
(function(){
  var photos = ${JSON.stringify(d.photos)};
  if(!photos.length) return;
  var A = document.getElementById('ypA'), B = document.getElementById('ypB');
  var layers = [A, B], front = 0, cur = 0, busy = false;
  var FADE = 1200, EASE = 'cubic-bezier(.25,0,.15,1)';
  var countEl = document.getElementById('ypCount');
  var thumbsEl = document.getElementById('ypThumbs');
  var toggleEl = document.getElementById('ypToggle');

  function label(){ countEl.textContent = (cur+1) + ' / ' + photos.length; }
  function marks(){
    var ts = thumbsEl.querySelectorAll('.yp-thumb');
    for(var i=0;i<ts.length;i++) ts[i].setAttribute('aria-current', i===cur ? 'true':'false');
  }
  function preload(i){
    [i-1, i+1].forEach(function(n){
      var k = (n + photos.length) % photos.length;
      var im = new Image(); im.decoding='async'; im.src = photos[k];
    });
  }

  // Crossfade: the incoming photo fades in ON TOP of the outgoing one, which is
  // held fully opaque underneath for the whole fade — so the paper background is
  // never exposed mid-transition (that bleed-through is what reads as a flash).
  // Only once the new photo is solid does the old one clear.
  function show(i, instant){
    if(busy || i===cur) return;
    i = (i + photos.length) % photos.length;
    var back = layers[1-front], fore = layers[front];
    busy = true;
    back.src = photos[i];
    var go = function(){
      back.style.zIndex = 2; fore.style.zIndex = 1;
      // A true cross-dissolve: both photos move together across the same window.
      // Holding the old one opaque (as the portal does) only reads correctly when
      // consecutive shots are the same shape — follow a wide shot with a tall one
      // and the wide one's wings sit either side of the new photo for the whole
      // fade, then wink out. Fading both at once dissolves those wings away with
      // the rest of the frame. Safe here because decode() has already run, so
      // there's no paint gap to expose the paper underneath.
      back.style.transition = instant ? 'none' : 'opacity ' + FADE + 'ms ' + EASE;
      fore.style.transition = instant ? 'none' : 'opacity ' + FADE + 'ms ' + EASE;
      back.style.opacity = 1;
      fore.style.opacity = 0;
      setTimeout(function(){
        front = 1 - front; cur = i; busy = false;
        label(); marks(); preload(i);
      }, instant ? 0 : FADE);
    };
    if(back.decode){ back.decode().then(go).catch(go); } else { back.onload = go; }
  }

  A.src = photos[0]; A.style.zIndex = 2; A.style.opacity = 1;
  label(); preload(0);

  document.getElementById('ypPrev').onclick = function(){ show(cur-1); };
  document.getElementById('ypNext').onclick = function(){ show(cur+1); };
  document.addEventListener('keydown', function(e){
    if(e.key==='ArrowRight') show(cur+1);
    else if(e.key==='ArrowLeft') show(cur-1);
  });
  toggleEl.onclick = function(){
    var open = thumbsEl.hasAttribute('hidden');
    if(open){ thumbsEl.removeAttribute('hidden'); } else { thumbsEl.setAttribute('hidden',''); }
    toggleEl.setAttribute('aria-pressed', open ? 'true':'false');
    if(open) marks();
  };
  thumbsEl.addEventListener('click', function(e){
    var b = e.target.closest('.yp-thumb'); if(!b) return;
    show(parseInt(b.getAttribute('data-i'),10));
  });
  var sx = null;
  var stage = document.getElementById('ypStage');
  stage.addEventListener('touchstart', function(e){ sx = e.touches[0].clientX; }, {passive:true});
  stage.addEventListener('touchend', function(e){
    if(sx===null) return;
    var d = sx - e.changedTouches[0].clientX;
    if(Math.abs(d) > 50) show(cur + (d>0 ? 1 : -1));
    sx = null;
  }, {passive:true});
})();
</script>
${foot()}`;
}

export type BrokeragePageData = {
  sitePage: string;
  brokerageName: string;
  /** Portal-published boats, newest first. */
  boats: { label: string; slug: string }[];
  /** Existing Juicebox galleries — these stay forever. */
  archive: { label: string; href: string }[];
};

/** A brokerage page: new portal boats up top, the Juicebox archive below. */
export function brokeragePage(d: BrokeragePageData): string {
  const total = d.boats.length + d.archive.length;
  const title = `Yacht Photography for ${d.brokerageName} | YachtPics`;
  const description = `Listing photography slideshows produced by YachtPics for ${d.brokerageName} — ${total} yacht shoots delivered.`;

  const newList = d.boats.length
    ? `<ul class="client-cols">
${d.boats.map((b) => `        <li><a href="${d.sitePage}/${b.slug}/index.html">${esc(b.label)}</a></li>`).join("\n")}
      </ul>`
    : "";

  const archiveList = d.archive.length
    ? `<ul class="client-cols">
${d.archive.map((a) => `        <li><a href="${a.href}">${esc(a.label)}</a></li>`).join("\n")}
      </ul>`
    : "";

  // Only show section headings once both halves exist — a brokerage with no
  // published boats yet should look exactly like it does today.
  const heads = d.boats.length > 0 && d.archive.length > 0;

  return `${head({ title, description, canonical: `${SITE}/${d.sitePage}.html`, depth: 0 })}
${nav(0)}
<main>
  <div class="page-hero">
    <div class="wrap">
      <p class="kicker">Boats</p>
      <h1>${esc(d.brokerageName)}</h1>
      <p>${total} listing shoot${total === 1 ? "" : "s"} delivered by YachtPics. Select a yacht to view its slideshow.</p>
    </div>
  </div>
  <section>
    <div class="wrap">
      ${heads ? `<h2 style="font-size:26px;margin-bottom:18px">Recent shoots</h2>` : ""}
      ${newList}
      ${heads ? `<h2 style="font-size:26px;margin:56px 0 18px">Archive</h2>` : ""}
      ${archiveList}
      <p style="margin-top:44px"><a href="yacht-photos.html" style="border-bottom:1px solid var(--gold)">&larr; All boats</a> &nbsp;&middot;&nbsp; <a href="contact.html" style="border-bottom:1px solid var(--gold)">Book a shoot</a></p>
    </div>
  </section>
</main>
${foot()}`;
}
