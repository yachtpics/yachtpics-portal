# Announcement — "A dock card for every boat" (DRAFT, needs Charlie's approval)

- **Campaign:** `announcement_dock_card_2026_11` in `src/lib/announcementEmail.ts` (`DOCK_CARD_ANNOUNCEMENT_CAMPAIGN`), sent through `src/lib/sendAnnouncement.ts` — tracked links + open pixel, unsubscribe footer, deduped per recipient in `email_log`.
- **Audience:** every broker and assistant (opted in, has an email).
- **Window:** Nov 1 – Dec 1 2026, 13:00 UTC. Nothing goes out until it's **approved on /admin/announce**; the next daily run (~9am ET) then sends it, or use "Send now" there.
- **Button:** Print a dock card → https://portal.yachtpics.com/dashboard/listings

---

**Subject:** A dock card for every boat

**Eyebrow:** New in the Portal
**Headline:** A dock card for every boat.

Hi {first name},

Every boat we have photographed now has a printable dock card: her photograph, her specifications, your name, and a QR code that opens her slideshow and video.

Print it and leave it aboard. Set it at the boarding steps or in the salon for showings.

Every scan is counted on her Seller Report.

> Open a listing and choose **Dock card** in the Client Slideshow section. 5×7 or Letter.

**[ Print a dock card ]**

Charlie Clark
YachtPics

---

Notes for approval
- "Every boat we have photographed" = every active listing with a published slideshow (238 on Nov 1). The card's QR is the YachtPics always-live link, so it works for brokers without a plan too.
- Also queued for later (each needs its own approval): Tip `dock-card-everyday` on /admin/tips; Help → Boat Shows has the everyday-card steps.
