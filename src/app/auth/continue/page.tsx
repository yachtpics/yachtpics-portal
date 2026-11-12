import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui";
import LinkExpiredPanel from "@/components/auth/LinkExpiredPanel";
import { safeNextPath } from "@/lib/safeNext";
import {
  CONTINUE_NONCE_COOKIE,
  CONTINUE_NONCE_FIELD,
  parseContinueNonce,
  parseEmailHint,
  parseLinkType,
  parseTokenHash,
} from "@/lib/authLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sign in to the YachtPics Portal",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * /auth/continue — the page an emailed one-time sign-in link opens (Nov 11, 2026).
 *
 * GET verifies NOTHING and spends nothing: a mail scanner that fetches the
 * link (Safe Links etc.) just gets this page. The token is spent only by the
 * Continue button's form POST to /auth/continue/verify. Scanners that run
 * JavaScript still don't press buttons.
 *
 * Login-CSRF (review M1): the middleware puts a random nonce in the
 * yp_continue cookie (and on the forwarded request, so cookies() sees it on
 * the very first render); every form here carries the same value in a hidden
 * field and the verify route requires both to match.
 *
 * Headers (next.config.mjs): no-store, Referrer-Policy no-referrer, noindex,
 * frame-ancestors 'none'.
 * Nothing here logs the URL or the token.
 */

type SP = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-ink-950 flex items-center justify-center px-4 py-16 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-96 w-[52rem] -translate-x-1/2 rounded-full bg-accent-500/[0.06] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-hairline-inverse-soft" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-hairline-inverse-soft" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="text-white text-[1.625rem] font-light uppercase tracking-caps-wide [text-indent:0.24em] leading-none">
            YachtPics
          </p>
          <span aria-hidden className="mx-auto mt-4 block h-px w-28 bg-white/25" />
          <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-caps-wide [text-indent:0.24em] text-accent-300/90">
            Portal
          </p>
        </div>
        <div className="bg-white/[0.03] border border-hairline-inverse rounded-surface p-8 backdrop-blur-sm">{children}</div>
        <p className="text-center text-xs text-ink-500 mt-6">
          Need help?{" "}
          <a href="mailto:hello@yachtpics.com" className="text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast">
            hello@yachtpics.com
          </a>
        </p>
      </div>
    </div>
  );
}

function Hidden({
  tokenHash,
  type,
  email,
  next,
  nonce,
}: {
  tokenHash: string;
  type: string;
  email: string | null;
  next: string | null;
  nonce: string | null;
}) {
  return (
    <>
      {nonce && <input type="hidden" name={CONTINUE_NONCE_FIELD} value={nonce} />}
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {email && <input type="hidden" name="email" value={email} />}
      {next && <input type="hidden" name="next" value={next} />}
    </>
  );
}

export default async function ContinuePage({ searchParams }: { searchParams: SP }) {
  const tokenHash = parseTokenHash(one(searchParams.token_hash));
  const type = parseLinkType(one(searchParams.type));
  const email = parseEmailHint(one(searchParams.email));
  const next = safeNextPath(one(searchParams.next));
  const notice = one(searchParams.notice);
  // Set (or reused) by the middleware for this exact path — never verified here.
  const nonce = parseContinueNonce(cookies().get(CONTINUE_NONCE_COOKIE)?.value);

  if (one(searchParams.expired) === "1" || !tokenHash || !type) {
    return (
      <Shell>
        <LinkExpiredPanel email={email} next={next} />
      </Shell>
    );
  }

  // Already signed in here? Never swap sessions silently.
  let currentEmail: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    currentEmail = data?.user ? (data.user.email ?? "another account").toLowerCase() : null;
  } catch {
    currentEmail = null;
  }

  if (currentEmail && currentEmail !== email) {
    return (
      <Shell>
        <h1 className="text-h2 text-white mb-2 text-center">You&apos;re already signed in</h1>
        <p className="text-sm text-ink-400 leading-relaxed mb-6 text-center">
          You&apos;re signed in as <span className="text-white break-all">{currentEmail}</span> — sign out to continue as{" "}
          <span className="text-white break-all">{email ?? "the account this link is for"}</span>.
        </p>
        <form method="post" action="/auth/continue/verify">
          <Hidden tokenHash={tokenHash} type={type} email={email} next={next} nonce={nonce} />
          <input type="hidden" name="intent" value="signout" />
          <Button type="submit" className="w-full min-h-[44px] focus-visible:ring-offset-ink-950">
            Sign out
          </Button>
        </form>
        <a
          href="/dashboard"
          className="mt-6 block text-center text-sm text-accent-300 hover:text-accent-200 hover:underline transition-colors duration-fast"
        >
          Stay signed in as {currentEmail}
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-h2 text-white mb-2 text-center">Sign in to the YachtPics Portal</h1>
      {email && (
        <p className="text-sm text-ink-400 leading-relaxed mb-1 text-center">
          as <span className="text-white break-all">{email}</span>
        </p>
      )}
      <p className="text-sm text-ink-400 leading-relaxed mb-6 text-center">Press Continue to finish signing in.</p>
      {notice === "busy" && (
        <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl mb-4">
          Too many tries from this connection — wait a few minutes, then press Continue again.
        </div>
      )}
      {notice === "wait" && (
        <div className="bg-danger-500/10 border border-danger-500/30 text-danger-300 text-sm px-4 py-3 rounded-ctl mb-4">
          Sign-in is busy right now — please try again in a minute.
        </div>
      )}
      {notice === "again" && (
        <div className="bg-white/[0.04] border border-hairline-inverse text-ink-300 text-sm px-4 py-3 rounded-ctl mb-4">
          Please press Continue again.
        </div>
      )}
      <form method="post" action="/auth/continue/verify">
        <Hidden tokenHash={tokenHash} type={type} email={email} next={next} nonce={nonce} />
        <Button type="submit" className="w-full min-h-[44px] focus-visible:ring-offset-ink-950">
          Continue
        </Button>
      </form>
    </Shell>
  );
}
