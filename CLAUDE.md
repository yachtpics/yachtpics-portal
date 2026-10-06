# Working with Charlie on the YachtPics Portal

> **Starting fresh? Read `docs/where-we-are.md` first.** It's the running
> handoff note — what just shipped, what's waiting to be pushed, and which
> threads are still open. Keep it current when you finish something notable.

## Conventions

- `docs/where-we-are.md` is the hand-off note — read it first, keep it updated
  when you finish something.
- Charlie uses **Windows PowerShell**: never use `&&` in instructions; give one
  command per line. He's new to dev tooling, so give exact steps (which
  folder, what to type, what he should see).
- `tsconfig` has no `target` (ES5): no spreading a `Set`/`Map` and no
  `for..of` over them — use `Array.from(...)`.
- Every admin page calls `requireAdminPage()`; every `/api/admin` route calls
  `requireAdmin()`.
- Never create scratch files inside `src/`.

## Help page rule — every change, not later

Whenever a change adds or changes something a **broker or assistant** can see
or do, update the Help page in the same change:

- `src/app/dashboard/help/page.tsx` — the `sections` steps (short, plain how-to)
  and the `quickRef` rows. Brokerage-admin features also belong in
  `src/app/dashboard/brokerage/help/page.tsx`.
- Then rebuild the PDF guide, which is generated from those two arrays:
  `python3 scripts/build_user_guide.py` (writes
  `public/YachtPics_Portal_User_Guide.pdf`; commit it with the change).
- **Admin-only** features stay out of Help. Features **gated by date or plan**
  are either described with the gate ("subscribers make as many as they
  like") or kept out of `sections` and added per viewer at request time — see
  `DEPTH_LOOKS_STEP` and `REEL_SERVICE_SECTION` in the Help page. Anything kept
  outside `sections` never reaches the PDF.
- Don't invent features or prices; check the code.
- Say in the hand-off note (`docs/where-we-are.md`) what you changed in Help,
  or why Help didn't need a change.

## Mission

We are building the best media delivery system for yacht brokers. It has to be
fast, professional, simple to use, and very user friendly. When there's a
tradeoff, that's the tiebreaker.

## Who I'm working with

Charlie Clark owns YachtPics. **He is not a coder.** He knows his business and
his customers extremely well, and he can tell instantly when something feels
slow, confusing, or off-brand — that judgment is reliable and should be trusted.
What he does not have is a mental model of the codebase.

### What that means in practice

**Walk him through things. Don't assume prior steps.**
When a step happens outside chat — pushing, deploying, clicking something in
Supabase or Vercel, checking a setting — give the actual steps, including where
to start. "Run git push" is not enough on its own; say which folder, what he
should expect to see, and how he'll know it worked.

**Say what changed and why, in plain language.**
Lead with the effect he'll notice ("the Manage page was waiting on twelve
things in a row instead of asking for them all at once"). Code detail is fine
underneath that, but it should never be the only explanation.

**Tell him what to check.**
After a change, say what to open and what "working" looks like. He is the one
who verifies in the real product, so he needs to know what he's looking for.

**Don't hand him a decision he has no basis to make.**
Asking "should we use signed URLs or a proxy route?" isn't a fair question.
Recommend one, explain the tradeoff in terms of cost, speed, or effort, and let
him say yes or push back.

**Be straight when something didn't work.**
He'd rather hear "that was my third attempt and it's still not right, here's
what I'd do instead" than another confident guess. Say when to stop tuning and
change approach.

## The stack, in one line each

- **Next.js on Vercel** — the portal itself. Pushing to `main` on GitHub
  deploys automatically; there is no separate deploy command.
- **Supabase** — the database (broker, listing, and photo records) and the
  file storage where photos and videos actually live.
- **Resend** — sends every email the portal sends.
- **Stripe** — subscriptions and billing.

## Deploying

From `C:\Users\charl\yachtpics-portal`, run `git push`. Vercel picks it up and
builds in a minute or two. Then hard-refresh the portal (Ctrl+Shift+R) so the
browser isn't showing the old version.
