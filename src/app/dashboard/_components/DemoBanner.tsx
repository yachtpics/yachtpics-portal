import { DEMO_BLOCK_HEADER, DEMO_EXIT_PATH, DEMO_READ_ONLY_MESSAGE } from "@/lib/demo";

/**
 * The read-only demo's banner (Nov 10, 2026) — rendered by the dashboard
 * layout ONLY when the signed-in user carries the demo claim.
 *
 * `data-demo-banner` lets our capture browser hide it when filming.
 *
 * The small inline script makes blocked actions say so instead of failing
 * silently: it wraps window.fetch once, before the page's own code runs, and
 * shows a short "The demo is read-only." toast when
 *   - one of our /api routes answers 403 with the x-demo-readonly header
 *     (the middleware and the layer-3 guards set it), or
 *   - a write straight to Supabase (REST / Storage) is refused (401 / 403 —
 *     the restrictive RLS policies).
 * The page's own error handling still runs as before (most show the 403's
 * `error` text, "The demo is read-only.", inline). An update Supabase
 * silently filters to zero rows can't be detected here — the screen may
 * show the change until a reload; the banner already says nothing is saved.
 */
const MSG = JSON.stringify(DEMO_READ_ONLY_MESSAGE);
const HEADER = JSON.stringify(DEMO_BLOCK_HEADER);
const SCRIPT = `(function(){try{if(window.__ypDemoFetch)return;var of=window.fetch;if(!of)return;window.__ypDemoFetch=1;var last=0;
function toast(){var n=Date.now();if(n-last<2500||!document.body)return;last=n;var d=document.createElement('div');d.setAttribute('role','status');d.setAttribute('data-demo-banner','toast');d.textContent=${MSG};d.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#0b1624;color:#fff;font:500 14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none';document.body.appendChild(d);setTimeout(function(){if(d.parentNode)d.parentNode.removeChild(d)},3200)}
window.fetch=function(input,init){var m='GET',u='';try{m=String((init&&init.method)||(input&&typeof input==='object'&&input.method)||'GET').toUpperCase();u=typeof input==='string'?input:(input&&input.url)?input.url:String(input)}catch(e){}
return of.apply(window,arguments).then(function(r){try{if(r.status===403&&r.headers.get(${HEADER})==='1')toast();else if(m!=='GET'&&m!=='HEAD'&&(r.status===401||r.status===403)&&/\\/(rest|storage)\\/v1\\//.test(u))toast()}catch(e){}return r})}}catch(e){}})();`;

export default function DemoBanner() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <div
        data-demo-banner=""
        className="bg-ink-900 text-ink-100 border-b border-ink-800 px-5 py-2 flex items-center justify-between gap-4 flex-wrap text-sm"
      >
        <span>
          <strong className="font-semibold text-white">Demo</strong> — look around. Nothing here is saved or sent.
        </span>
        {/* A plain link (full page load): /demo/exit signs the demo out of this
            browser, then opens the same signup page /see's "Request access" uses. */}
        <a
          href={DEMO_EXIT_PATH}
          className="shrink-0 text-accent-400 hover:text-accent-300 font-semibold text-xs transition-colors duration-fast ease-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-ctl"
        >
          Request access →
        </a>
      </div>
    </>
  );
}
