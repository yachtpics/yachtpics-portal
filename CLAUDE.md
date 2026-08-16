# Working with Charlie on the YachtPics Portal

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
