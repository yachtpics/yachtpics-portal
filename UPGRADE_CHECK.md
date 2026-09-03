# Hosting & Email Upgrade Check — July 1, 2026

> **Status as of Sept 2026 — this report is a snapshot, kept for the reasoning.**
> **Resend: done.** Now on Pro — 50,000/month, no daily cap. The silent-failure
> problem below is resolved, and the `vercel-upgrade-check` scheduled task that
> monitored it has been disabled.
> **Vercel: still on Hobby.** As of Sept 2026 there is 1 paying broker ($29/mo),
> so the commercial-use argument now genuinely applies. Tracked monthly by the
> `vercel-upgrade-watch` task.

Hi Charlie,

**Resend — upgrade now.** This one's already biting. Your peak day in the last 30 hit **152 emails** against Resend's hard **100/day free cap**, so on your busiest days emails are silently failing to send — trial reminders, photo-ready alerts, and broker Send-to-Client messages that never arrive. You've got **96 opted-in brokers/assistants**, and a single weekly tips blast nearly maxes the daily limit on its own before any of the automated or broker-initiated mail stacks on top. Resend Pro ($20/mo) removes the daily cap entirely and lifts you to 50,000/month. This is plan-only — no code changes. (Total volume was a comfortable 444 over 30 days, so it's purely the *daily* ceiling causing the failures, exactly as flagged.)

**Vercel — upgrade for compliance.** I couldn't pull live bandwidth (the personal Hobby account isn't exposed to the API without a team scope), but the case stands regardless: Hobby is explicitly for **non-commercial** use, and the portal charges brokers through Stripe. Pro ($20/mo) is the compliant plan for a paid product, and it also clears the cron-job and function limits you've been working around. Also plan-only.

**Bottom line:** flip both to Pro ($40/mo total). Resend is urgent — you're losing emails today. Vercel is the right call for a commercial product. Full rationale is in GROWTH_IDEAS.md, section 4.
