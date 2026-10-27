import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { paidReelServiceBrokerIds } from "@/lib/brokerAccess";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Rendered on every request: "Your Reels" is shown per viewer (Reel Service
// clients only). Walkthrough and Underway opened to everyone on Oct 9, so
// their line is now an ordinary step in `sections`.
export const dynamic = "force-dynamic";

const sections = [
  {
    num: "01",
    title: "Creating Your Account",
    steps: [
      "You'll receive an invite email from YachtPics — click 'Set Up Your Account' and create a password.",
      "Your profile is pre-filled with your name and email. Complete the rest under My Profile.",
      "If you have an assistant, they may already be linked and ready to help before you even log in.",
      "Signing in later: use your email and password, or click 'Email me a sign-in link' on the login page and we'll send a one-click link — no password to remember.",
      "If a reset or sign-in link says it's expired, use the Resend button right on that screen to get a fresh one.",
      "After signing in you land on My Listings, with your newest boat spotlighted at the top.",
      "On a phone, the tabs along the bottom take you to Home, Listings, Recently Photographed and your Profile. Everything else, such as Help, Tips, News and Billing, is under More.",
      "Install the portal like an app: on an iPhone, open it in Safari, tap Share, then Add to Home Screen. On Android or a computer, use the Install prompt the portal shows. You get an icon that opens straight to your listings.",
    ],
  },
  {
    num: "02",
    title: "Completing Your Profile",
    steps: [
      "Go to My Profile and confirm your name, brokerage, phone, and website.",
      "Upload your company logo — it appears in the footer of every client slideshow.",
      "Complete this before sharing your first listing so clients see your branding.",
      "To change your password, go to My Profile and scroll to the Change Password section — enter your new password, confirm it, and save.",
    ],
  },
  {
    num: "03",
    title: "Managing Your Listings",
    steps: [
      "Create a new listing and upload photos yourself, or listings appear automatically when YachtPics delivers. Click any listing to open it.",
      "Drag and drop photos to reorder them. Click a photo to open the full-screen lightbox.",
      "Click 'Sort to standard order' to rewrite the order into the standard walk-through — outside, up top, cockpit, engine room, then the interior. Drag from there to fine-tune.",
      "Use categories (Profiles, Foredeck, Cockpit, Skylounge, Beach Club, Engine Room — or Port and Starboard Engine Room — Electrical Panel, staterooms and more) to organize photos — clients see these labels in the slideshow.",
      "Toggle the eye icon on any photo to hide it. Hidden photos stay on your listing but are left out of both the client slideshow and client downloads.",
      "On a phone, the replace, download, hide and delete buttons sit in a small row under each photo, so nothing covers the picture. The ★ and the drag handle stay in the photo's top corners.",
      "The first time you download, you'll be asked to accept the YachtPics Photo & Video License: use our photos and videos to advertise that boat, anywhere, for as long as it's listed — but don't pass the files on to other brokers or third parties. Photos you uploaded yourself aren't covered by it.",
      "Replace a bad shot without starting over: hover the photo (on a phone, use the row under it), click the Replace icon (two circling arrows) and pick the new file. It keeps the photo's spot in the order, its category and its cover ★. Replace works whenever you can upload photos.",
      "Choose a download size in the menu next to Download All (or next to Download in Select mode): Full resolution (the original file), Web & MLS (2048px on the long side) or Social (1080px). Verticals stay vertical. The choice applies to every download button on the page — one photo, a selection or all — and the browser remembers it.",
      "Downloading several photos gives you one zip with a folder named for the boat, the photos numbered in listing order (\"01 Salon.jpg\"). If any photo can't be added, you'll be told how many so you can download those on their own.",
      "Switch to Select mode to bulk-download, bulk-hide, bulk-delete, or bulk-assign categories to multiple photos at once.",
      "In Select mode, choose photos then pick a category from the dropdown and click Apply to update them all at once.",
      "Got the photos as a zip, or a folder in Downloads on your phone? Tap From files / zip (next to Add Photos). It opens your Files app instead of the Gallery, so you can pick the zip itself or the folder's photos. A zip is unpacked for you.",
      "When uploading photos from a mobile device, a prompt will appear if categories can't be detected automatically — just pick the category before uploading.",
      "A File Missing warning on a photo means the original file is gone — click Replace on it and upload the file again.",
    ],
  },
  {
    num: "04",
    title: "Videos",
    steps: [
      "Open any listing and scroll to the Videos section below your photos.",
      "Click Upload MP4 and select an MP4 or MOV file from your computer.",
      "By default a video appears on the Video tab of the client slideshow — the slideshow itself shows photos only. Use 'Hide from slideshow' on the video to keep it on the listing but off the client's page. To send a link that opens straight on the video, add #video to the end of the slideshow link.",
      "You can also send a video on its own — in Send to Client, tick the video to email the client a direct link, separate from the slideshow.",
      "For smooth playback on phones, export videos at 1080p (not 4K). To remove a video, click Delete on its card. There's no limit on video count.",
    ],
  },
  {
    num: "05",
    title: "Listing Documents",
    steps: [
      "Open any listing and scroll to the Listing Documents section.",
      "Click Upload PDF to add brochures, spec sheets, survey summaries — anything a buyer should have in hand.",
      "Documents live on the listing, not inside the slideshow. You pick which ones to attach each time you use Send to Client.",
      "To remove one, click Delete on its card.",
    ],
  },
  {
    num: "06",
    title: "Publishing & Sharing with Clients",
    steps: [
      "Set it up first: drag photos into the order you want, hide any you don't want shown, and tap the ★ on your best shot to make it the cover.",
      "In the Client Slideshow section, click Create Slideshow to publish. This turns the listing into a branded, full-screen gallery with its own link — no login for the client.",
      "Once published, use Send to Client to email a polished presentation with the slideshow, any documents, and any videos you select. Or copy the link / share the QR code.",
      "Every send is logged under Sent History with the date and recipient, and the view count shows how many times clients opened it.",
      "Your logo appears in the slideshow footer — complete your profile before sharing.",
    ],
  },
  {
    num: "07",
    title: "Billing & Subscription",
    steps: [
      "Your photos are free. A plan puts them to work. Every photograph we deliver is yours to download, with or without a plan, even after your trial ends.",
      "Every plan includes, from $29 a month: Buyer slideshows — branded to you, with video, sent to clients from the Portal. Seller Reports — what buyers look at on every listing, ready to send the owner. Unlimited reels — a dozen looks, with original music you can post anywhere. Boat-show dock cards — a printed card with a QR code, and a count of every scan. Your own listings — upload your own photos for boats we didn't shoot. Your own website is +$50 a month, included with Elite.",
      "Your 14-day free trial starts the first time you sign in (accounts opened before October 24, 2026 keep their 30 days). Choose a plan any time during it and you won't be charged until the trial ends — the Billing page shows the date. In the last two days of the trial, choosing a plan starts billing straight away. Cancel anytime from the Billing page. During the trial we email you three times: a week in, with what your listings did (from their Seller Reports); two days before it ends; and once it has ended.",
      "Reels without a plan: each listing includes two reels. A reel counts once you take it off the page — download it, send it to your phone, save it to your camera roll, or add it to the listing. Making and previewing never count, and taking the same reel twice is still one. Subscribers make as many as they like.",
      "Office plan: a brokerage admin can cover the whole brokerage with one plan, under Brokerage → Billing. While it's active every broker there is covered automatically — no plan of their own needed — and their assistants are included.",
    ],
  },
  {
    num: "08",
    title: "Working with Assistants",
    steps: [
      "Assistants can manage listings, upload photos and videos, and send slideshows on your behalf.",
      "To add an assistant, open Team in the sidebar, click Invite Assistant, enter their email and send. (My Profile → Assistants works too.)",
      "New assistants will receive an invite email and be linked to your account automatically.",
      "Assistants see all your listings but cannot access billing or change your account settings.",
      "Assistants get their own My Brokers page listing every broker they work for, so they can jump straight into the right boat.",
      "To remove an assistant, open Team (or My Profile → Assistants) and click Remove next to their name.",
    ],
  },
  {
    num: "09",
    title: "Sharing Within Your Brokerage",
    steps: [
      "If you're a brokerage admin, every listing has a 'Share with brokerage' button near the top.",
      "Turn it on and that boat becomes visible to every broker in your brokerage — handy for co-brokering, or covering while someone's out.",
      "Once shared the button reads 'Shared with brokerage'. Click it again to stop sharing.",
      "Sharing changes nothing else: your client slideshow, sending, and downloads all work exactly the same.",
      "The Brokerage page in the sidebar lists everyone on your brokerage's account in one place.",
    ],
  },
  {
    num: "10",
    title: "Marketing Tools",
    steps: [
      "Cover photo: tap the ★ on a photo to make it the cover used on your spec sheet and social posts. If none is set, the first photo is used.",
      "Flyer cover: next to the photos, switch between Fit (show all) and Fill (crop) to control how that cover sits on your spec sheet — Fit shows the whole photo, Fill fills the space edge-to-edge.",
      "Spec Sheet: open a listing and click Spec Sheet for a clean, branded, printable one-pager with the specs, your logo, and a QR code — ready to print or email.",
      "Social Post: click Social Post to turn any photo into a branded, post-ready image with a caption and hashtags written for you. Download and post to Instagram or Facebook.",
      "Reel: click Reel to turn the listing's photos into a finished video — a vertical Reel for Instagram and Facebook, or a widescreen Film you can add to the listing and send to a buyer. It renders in your browser in under a minute. Reels are silent unless you turn on Music, so you can add a trending sound when you post. Without a plan, each listing includes two reels (see Billing & Subscription).",
      "Reel — pick a look: each is a complete treatment. Editorial (serif caps on a soft gradient, the brochure look), Cinematic (letterboxed and slow, nothing over the photograph), Walkthrough and Underway (the camera moves through each photograph — see below), Gallery (warm off-white with the photo inset), Classic (warm tones, title case, set lower-left — suits sail and classics), Energy (whips, wipes and zoom-throughs, a different cut every time — for center consoles and sportfish), Stack (three bands trading on the beat, with full-frame breaks — for go-fasts), Marquee (the hero on top, the details in the middle, the rest of the boat below, one photo at a time) and Marquee Still (the same, with the cover held still at the top). Stack and the two Marquee looks are for vertical reels; the widescreen Film offers the others.",
      "Reel — Walkthrough and Underway: two looks where the camera moves through each photograph instead of zooming in, so the foreground passes and the room opens up. Walkthrough is the quiet one, made for the listing film; Underway adds wipes and dips between spaces, made for social. Every frame is the real boat — nothing is generated or filled in. Allow a couple of minutes: it reads the depth of each photograph before it renders.",
      "Reel — Marquee top photos: on a Marquee look each photo you pick shows Top or Bottom. Tap a photo's badge to pin it to the top band (up to four; one on Marquee Still), or press Back to automatic.",
      "Reel — your colours: set an accent (the fine lines and lead-in) and a background (the bars, end card and page behind the photo) to match your brand, or press Match my logo to pull the colour straight out of your logo. It's remembered for every listing; 'Back to the look's colours' resets it.",
      "Reel — options: choose the photos and their order, put the price and location on or off, show the whole photo or fill the frame, and switch on room labels to name each space on screen.",
      "Reel — length: pick Full (about 40 seconds, up to 27 photos), Long (about 55 seconds, up to 40) or Short (about 20 seconds, up to 12) — Full is the default, because reels between 30 and 60 seconds reach the furthest, and Short suits a quick teaser. Reels with audio reach further than silent ones — turn on Music, or add a track from Instagram's own licensed library when you post.",
      "Reel — music: under Music, leave it Off to add a trending sound in Instagram when you post, or pick Auto (the look's own mood), Calm, Cinematic, Elegant, Upbeat, Groove (a modern hip-hop beat with deep bass), Lift (bright, building and uplifting — it rises to a fuller beat about halfway through), Coastal (warm, melodic and feel-good, with nylon guitar and Rhodes) or Coastal Drive (the same feel with more punch) to bake original YachtPics music into the video. It's made for that reel and timed to its cuts, it's free to post anywhere with no copyright claims, and the portal remembers your choice. Press Preview to hear it (Stop to end), and Try another for a different track in the same mood. The first time you use a mood, its instruments load (a few seconds; you'll see Loading instruments); after that they're remembered. Adding music to the video needs Chrome or Edge on a computer; other browsers make it silent and say so. Instruments rendered from the FluidR3 General MIDI soundfont by Frank Wen (MIT).",
      "Reel — video clips: if the listing has videos, tap one under Video clips, slide to where the clip should start, pick 2, 3 or 4 seconds, press Play clip to check it, then Add to reel. Up to three clips per reel (two when you make it on a phone). Clips play silent and take a place in the order like a photo. Stack builds from photographs only — pick another look to use clips.",
      "Reel — Write with AI: reads the photos you actually picked, in order, then writes a headline for the opening frame and a caption with hashtags to post alongside it. Both are yours to edit; the headline only goes on the film if you tick it.",
      "Reel — Send to my phone: once the reel is made, this puts a QR code on screen. Point your phone's camera at it, tap, and the reel saves to your camera roll ready to post. The same link is emailed to you as a backup. The pickup link works for 24 hours; the reel you saved is yours to keep, and you can make it again from the listing any time.",
      "Label photos: when you upload photos the portal can't place from the file name, it labels them for you (Foredeck, Salon, Master Stateroom…) so they drop straight into the walk-through order. The Label photos button does the same for anything still marked Other.",
      "Draft with AI: on Edit Listing, Draft with AI writes a first description from your specs and photos. Read it, change anything, then save — nothing is published until you do.",
      "360° tour & deck plan: on Edit Listing, paste a Matterport / VRCloud / Kuula link and upload a deck-plan image. Buyers get a 360° Tour button on the slideshow and the plan under Details.",
      "QR code: once a listing's slideshow is published, it gets its own QR code. Add it to a flyer or dock sign so buyers scan straight to your gallery.",
    ],
  },
  {
    id: "where-can-the-portal-post",
    num: "11",
    title: "Where can the Portal post your reels?",
    steps: [
      "Your reel is made for you. Posting it is one tap from your phone: press Send to my phone, open Instagram or Facebook, and post.",
      "Facebook Page (a business page): the Portal can post for you. This is coming to brokers soon. YachtPics posts this way today.",
      "Instagram business or creator account: the Portal can post for you, the same way.",
      "When the Portal posts a reel, you pick the cover frame. That is the picture Facebook and Instagram show before anyone taps the reel.",
      "Personal Facebook profile (the one in your own name): no app can post to a personal profile. Facebook does not allow it. Post the reel to your Page, then tap Share, then Share to your feed.",
      "Personal Instagram: switch it to a Creator account. It is free and you keep all your followers. A Creator account is public, like a business account, so anyone can see your posts. Then the Portal can post for you. The steps are in the next card.",
    ],
  },
  {
    num: "12",
    title: "Switch Instagram to Creator (2 minutes)",
    steps: [
      "Open Instagram and go to your profile.",
      "Tap the three lines at the top right, then Settings and activity.",
      "Scroll down to For professionals. Tap Account type and tools, then Switch to professional account.",
      "Pick a category (Real Estate is fine). Tap Creator, then Next. You can skip the extra screens. If your account was private, Instagram makes it public.",
      "Link your Facebook Page: on your profile, tap Edit profile, then Page (under Public business information). Tap Continue, sign in to Facebook, pick your Page and tap Next.",
      "These steps are for iPhone. Android is the same, the wording may differ slightly.",
    ],
  },
  {
    num: "13",
    title: "Buyer Inquiries",
    steps: [
      "Your published slideshow has a Request Info button buyers can use to reach out.",
      "When a buyer submits it, the lead lands in your inbox and on the listing — name, contact, and message.",
      "Open the listing to see all inquiries and mark them contacted as you follow up.",
      "You also get an email the moment a buyer opens your slideshow (adjustable in My Profile → Notifications). If you added the client's name in Send to Client, the alert says who — 'Mark opened your slideshow' — and Sent History shows exactly how many times.",
      "Engagement (on every listing) shows what buyers do in your slideshow: views, unique visitors, time per visit, the photos they linger on and save with the heart button, video plays, and 360° tour opens.",
      "Seller Report: the button in the Engagement panel opens a one-page, branded report to print or save as PDF and forward to the owner — the answer to 'what are you doing for my boat?'.",
    ],
  },
  {
    num: "14",
    title: "Boat Shows",
    steps: [
      "When a boat show is coming up (the Fort Lauderdale International Boat Show is the first), a Boat shows card appears near the top of each listing, and My Listings shows a one-line reminder with how many of your boats are marked.",
      "Tick 'At FLIBS 2026' to mark the boat, then add her dock or slip and click Save. The note is for YachtPics: arrival day, in the water or on land. Untick it to take her off. Marked boats carry a FLIBS 2026 tag on My Listings.",
      "Assistants can mark boats for the brokers they work for, and brokerage admins for the brokers in their brokerage.",
      "Dock card (PDF): a print-ready card, 5 × 7 in or Letter, with her cover photograph, year, length, make and model, her dock or slip, your logo, name, brokerage, phone and email, and a QR code. It needs a published slideshow; until then the button stays off and reads 'Publish the slideshow first'.",
      "The QR code opens her full slideshow on the buyer's phone, starting on the video when she has one. Nothing to install and no login.",
      "Engagement on the listing shows 'Scanned at FLIBS 2026' with the number of visits that came from the dock card, and those visits appear as their own line under Where views come from.",
    ],
  },
  {
    num: "15",
    title: "Your Website",
    steps: [
      "Your own website at portal.yachtpics.com/b/your-name: a full-width photo with your name, your boats for sale, recent sales, your bio and a contact form. It fills itself from your Portal listings.",
      "Price: every plan comes with or without the website. Starter $29, or $79 with the website; Growth $49, or $99; Pro $79, or $129; Elite $149 includes it. You can build the site before paying; it goes live once the website is on your plan and Publish is on.",
      "Choosing a plan for the first time: pick the 'with website' button under Billing. Already on a plan: click Add website (+$50 a month) on the Website page or under Billing; the rest of the current month is charged pro rata on your next invoice.",
      "Open Website in the sidebar and click Create my website. Pick your address (you can change it later). Nothing is public until you switch Publish on; View site opens it, Copy link copies the address to share.",
      "Edit it there: the headline under your name, the top photo (choose any photo from your listings, or leave it on your newest boat's cover), up to 4 short facts like '22 years', your portrait, bio, credentials and WhatsApp number, up to 6 client testimonials, and whether prices show. Click Save; the site updates within a minute or two. Phone, email, brokerage, license and logo come from My Profile.",
      "Sections: put the parts of your page (At a glance, Yachts for sale, Recent sales, About, Testimonials, Selling your yacht?) in the order you like — drag them on a computer, or use the up and down arrows — and switch off any you don't want. Your photo and name always come first and Contact last.",
      "Look (top of the Website page): pick a layout (Classic, Editorial or Showroom) and one of six colour palettes, and optionally use your brand colour or any colour you like for buttons and accents; if a colour would be hard to read, it's adjusted slightly. Preview opens your site with the new look in a new tab (only you can see it); Save applies it.",
      "How boats appear: every active boat with photos shows on your site unless you switch it off (Website → Your boats → Show on my website). Pocket listings never show. Boats we didn't shoot can be on your site too — add a listing and upload your own photos. Each boat has its own page on your site with the full slideshow, its specs and a Request a showing button; visits there count in the boat's Seller Report like slideshow views.",
      "When a boat sells, click Mark sold: it moves to Recent sales with the month it sold and no price. Back on the market undoes it.",
      "Visitors can request a showing on any boat, send you a message, or ask what their own boat is worth. Each one is emailed to you straight away (reply to the email to answer them) and listed under Inquiries, where you can mark it handled.",
      "Assistants can edit the website for the brokers they work for; adding or removing it on the plan is up to the broker. To stop it, click Remove website: it stays live to the end of the month you've paid for, doesn't renew, then goes offline (everything you set up is kept). If your Portal plan lapses, the link shows 'This page isn't available' until it's back.",
    ],
  },
  {
    num: "16",
    title: "Reel Service",
    steps: [
      "Reel Service: YachtPics makes up to 4 social reels a month for one listing, from the shoot's photos plus any drone or video footage. Photo-only listings qualify. $179 a month per listing, paid by card in the Portal; run it on as many boats as you like.",
      "To add it, open the listing and click Add Reel Service in the Reel Service card (or Billing → Add Reel Service → Pick a boat). Checkout takes your card; the service starts as soon as the first payment goes through, renews monthly, and tax is added where it applies. Assistants can add it for the brokers they work for.",
      "No plan? While the Reel Service is on, it includes Portal access (Starter level). Already on a plan, nothing about it changes.",
      "The card shows 'Reel Service active · N of 4 this month' and the renewal date. Your reels land on Your Reels, on the listing's Reel page under Delivered by YachtPics, and in your inbox.",
      "To cancel, click Cancel Reel Service on the card. It runs to the end of the month you've paid for and nothing renews. When a listing is sold or archived, its Reel Service ends at the end of that month by itself.",
      "If a renewal payment fails, the card says Payment problem: click update your card. Stripe tries again for a while; if it still can't charge the card, the Reel Service pauses until the card is fixed.",
    ],
  },
  {
    num: "17",
    title: "Recently Photographed",
    steps: [
      "Recently Photographed (in the sidebar) is a portal-wide showcase of the latest boats YachtPics has shot — a place to see fresh inventory and connect broker-to-broker.",
      "A rotating strip of featured boats also appears on your dashboard — tap it to open the full showcase gallery.",
      "YachtPics curates which boats appear. If a client is after a certain type of boat, browse here and reach the listing broker directly using the phone and email on each card.",
      "yachtpics.com: selected boats we photograph for you also get their own page on yachtpics.com — full gallery, key specs, and buyers contact you directly. YachtPics chooses which boats appear; there's nothing to set up and no cost.",
      "Keeping a boat quiet? Open the listing and check 'Keep this a pocket listing' to hide it from the showcase and take it off yachtpics.com — even if we've featured it. Nothing else changes; your photos, downloads, and client sharing are unaffected.",
    ],
  },
  {
    num: "18",
    title: "Tips & Tricks",
    steps: [
      "Tips (in the sidebar) is a browsable library of short how-tos for getting more out of the portal.",
      "Topics include photo order and curation, working with assistants, installing the portal as an app on your phone, magic-link sign-in, sharing across your office, and co-brokering.",
      "We email a new tip each week — every one lands on this page, so you can read ahead or catch up anytime.",
      "Each tip ends with a button that takes you straight to the part of the portal it's about.",
    ],
  },
  {
    num: "19",
    title: "Industry News",
    steps: [
      "News (in the sidebar) gathers what the yachting trade press is reporting, every morning, kept short.",
      "Every headline links straight to the publication that wrote it.",
    ],
  },
];

const quickRef = [
  ["Publish a slideshow", "My Listings → listing → Client Slideshow → Create Slideshow"],
  ["Share a listing with a client", "My Listings → listing → Send to Client"],
  ["Quickly send a listing to a client", "My Listings → Send button on listing row"],
  ["Download all photos for a listing", "My Listings → Download button on listing row"],
  ["View who opened your slideshow", "My Listings → listing → Sent History"],
  ["Reorder photos", "My Listings → listing → drag and drop"],
  ["Put photos in the standard walk-through order", "My Listings → listing → Sort to standard order"],
  ["Hide a photo from clients", "My Listings → listing → eye icon on photo"],
  ["Bulk-delete or bulk-download photos", "My Listings → listing → Select mode"],
  ["Replace a photo but keep its spot and category", "My Listings → listing → Replace icon on the photo"],
  ["Download web-size (2048px) or social-size (1080px) photos", "My Listings → listing → size menu next to Download All"],
  ["Assign a category to multiple photos", "My Listings → listing → Select mode → category dropdown → Apply"],
  ["Sign in without a password", "Login page → Email me a sign-in link"],
  ["Change your password", "My Profile → Change Password"],
  ["Upload a video", "My Listings → listing → Listing Videos → Upload MP4"],
  ["Upload a brochure or PDF", "My Listings → listing → Listing Documents → Upload PDF"],
  ["Set the cover photo", "My Listings → listing → ★ on a photo"],
  ["Change how the cover fits the spec sheet", "My Listings → listing → Flyer cover → Fit / Fill"],
  ["Make a branded spec sheet", "My Listings → listing → Spec Sheet"],
  ["Create a social post", "My Listings → listing → Social Post"],
  ["Make a reel or film from the photos", "My Listings → listing → Reel"],
  ["Change how a reel looks", "My Listings → listing → Reel → Look"],
  ["Make a reel longer or shorter", "My Listings → listing → Reel → Length"],
  ["Name each room on screen in a reel", "My Listings → listing → Reel → Room labels"],
  ["Add a video clip to a reel", "My Listings → listing → Reel → Video clips"],
  ["Add original music to a reel", "My Listings → listing → Reel → Music"],
  ["Choose a Marquee reel's top photos", "My Listings → listing → Reel → Marquee → tap Top / Bottom"],
  ["Write a caption from the reel's photos", "My Listings → listing → Reel → Write with AI"],
  ["Get a reel onto your phone to post", "My Listings → listing → Reel → Send to my phone"],
  ["See where the Portal can post your reels", "Help → Where can the Portal post your reels?"],
  ["Switch your Instagram to a Creator account", "Instagram → profile → three lines → Settings and activity → Account type and tools"],
  ["Label photos automatically", "My Listings → listing → Label photos"],
  ["Draft a description", "My Listings → listing → Edit → Draft with AI"],
  ["Add a 360° tour or deck plan", "My Listings → listing → Edit → Virtual tour & deck plan"],
  ["See who's looking and at what", "My Listings → listing → Engagement"],
  ["Make a report for the owner", "My Listings → listing → Engagement → Seller Report"],
  ["Hide a video from the slideshow", "My Listings → listing → video → Hide from slideshow"],
  ["Send a video on its own", "My Listings → listing → Send to Client → tick the video"],
  ["See buyer inquiries", "My Listings → listing → Inquiries section"],
  ["Share a boat with your whole brokerage", "My Listings → listing → Share with brokerage"],
  ["See everyone on your brokerage account", "Sidebar → Brokerage"],
  ["Assistants: see all your brokers", "Sidebar → My Brokers"],
  ["Browse tips & tricks", "Sidebar → Tips"],
  ["Upload your logo", "My Profile → Company Logo"],
  ["Add or remove an assistant", "Sidebar → Team (or My Profile → Assistants)"],
  ["Choose a plan", "Billing → choose a plan → Choose plan"],
  ["Cover your whole brokerage with one plan", "Sidebar → Brokerage → Billing (brokerage admins)"],
  ["Change your login email", "My Profile → Change Login Email"],
  ["Manage billing & download receipts", "Billing → Manage billing & invoices"],
  ["See recently photographed boats", "Sidebar → Recently Photographed"],
  ["Mark a boat for a boat show", "My Listings → listing → Boat shows → tick the show, add the dock / slip, Save"],
  ["Download a boat show dock card", "My Listings → listing → Boat shows → Dock card (PDF)"],
  ["Create or edit your website", "Sidebar → Website"],
  ["Add your website to your plan (+$50/mo, included with Elite)", "Sidebar → Website → Add website (or Billing)"],
  ["Remove your website", "Sidebar → Website → Remove website (or Billing)"],
  ["Change your website's layout or colours", "Sidebar → Website → Look → Preview, then Save"],
  ["Reorder or switch off sections of your website", "Sidebar → Website → Sections"],
  ["Leave a boat off your website", "Sidebar → Website → Your boats → switch off Show on my website"],
  ["Mark a boat sold on your website", "Sidebar → Website → Your boats → Mark sold"],
  ["See messages from your website", "Sidebar → Website → Inquiries (also emailed to you)"],
  ["Add the Reel Service to a boat ($179/mo)", "My Listings → listing → Reel Service → Add Reel Service"],
  ["Cancel the Reel Service on a boat", "My Listings → listing → Reel Service → Cancel Reel Service"],
  ["Keep a boat out of the showcase and off yachtpics.com", "My Listings → listing → 'Keep this a pocket listing'"],
  ["Install the portal on your phone", "Open it in your phone's browser → Add to Home Screen"],
  ["Read the industry news", "Sidebar → News"],
  ["Find Help, Tips, News or Billing on a phone", "Bottom tabs → More"],
  ["Sign out", "Sidebar → Sign out (bottom-left); on a phone, top-right"],
];

/**
 * "Your Reels" — Reel Service clients only. Shown to the same people who see
 * the "Your Reels" sidebar item (src/app/dashboard/layout.tsx): a broker who is
 * enrolled or has delivered reels, or an assistant of one. Kept outside
 * `sections` / `quickRef` on purpose, so the PDF guide (scripts/
 * build_user_guide.py reads those two arrays) never lists it for everyone.
 */
const REEL_SERVICE_SECTION = {
  num: "20",
  title: "Your Reels",
  steps: [
    "As a YachtPics Reel Service client, Your Reels in the sidebar holds the social reels we make for you for the boats enrolled in the Reel Service, newest first. We email you when new ones are ready.",
    "Watch any reel right on the page, then Download it — or on a phone, tap Save or share to send it straight to Instagram or your camera roll.",
    "Each reel comes with a caption: tap Copy and paste it when you post. Don't like the caption? Rewrite gives you a fresh one. Reels come with original YachtPics music, free to post anywhere with no copyright claims — or ask us for silent versions if you'd rather add a trending sound in Instagram.",
    "Your assistants see Your Reels too, and get the same emails.",
  ],
};
const REEL_SERVICE_QUICKREF = ["Watch and download reels made for you", "Sidebar → Your Reels"];

/**
 * Whether the viewer sees "Your Reels" — the same test as the dashboard
 * layout. Any failure (e.g. the tables not there) hides the section.
 */
async function reelServiceForViewer(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = me?.role ?? null;
    if (role !== "broker" && role !== "assistant") return false;
    const svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    let brokerIds: string[] = [user.id];
    if (role === "assistant") {
      const { data: links } = await svc.from("broker_assistants").select("broker_id").eq("assistant_id", user.id);
      brokerIds = ((links ?? []) as { broker_id: string }[]).map((l) => l.broker_id);
    }
    if (brokerIds.length === 0) return false;
    const [{ count: subs }, { count: delivered }] = await Promise.all([
      svc.from("reel_service_subscriptions").select("broker_id", { count: "exact", head: true }).in("broker_id", brokerIds).eq("enabled", true),
      svc.from("reel_service_jobs").select("id", { count: "exact", head: true }).in("broker_id", brokerIds).eq("status", "delivered"),
    ]);
    return (subs ?? 0) > 0 || (delivered ?? 0) > 0 || (await paidReelServiceBrokerIds(svc, brokerIds)).length > 0;
  } catch {
    return false;
  }
}

export default async function HelpPage() {
  const reelService = await reelServiceForViewer();
  const shown = reelService ? sections.concat([REEL_SERVICE_SECTION]) : sections;
  const quickRows = reelService ? quickRef.concat([REEL_SERVICE_QUICKREF]) : quickRef;
  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-10 pb-6 border-b border-hairline">
        <h1 className="text-display text-ink-900">Help &amp; User Guide</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Everything you need to get up and running with the YachtPics Portal.
        </p>
      </div>

      {/* Download banner */}
      <div className="bg-ink-950 rounded-card px-6 py-5 flex items-center justify-between mb-10 gap-4 flex-wrap">
        <div>
          <p className="text-white font-semibold text-sm">Full User Guide (PDF)</p>
          <p className="text-ink-300 text-xs mt-0.5">
            A complete walkthrough of every feature &mdash; great to keep on file or share with your team.
          </p>
        </div>
        <a
          href="/YachtPics_Portal_User_Guide.pdf"
          download
          className="bg-accent-500 hover:bg-accent-400 text-ink-950 text-sm font-semibold px-5 py-2.5 rounded-ctl transition-colors duration-fast ease-quiet whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
        >
          Download Guide &darr;
        </a>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {shown.map((s) => (
          <div key={s.num} id={s.id} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5 scroll-mt-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-accent-700 bg-accent-50 px-2 py-0.5 rounded-full">
                {s.num}
              </span>
              <h2 className="font-semibold text-ink-900 text-sm">{s.title}</h2>
            </div>
            <ol className="space-y-1.5">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs text-ink-600 leading-relaxed">
                  <span className="text-accent-700 font-bold shrink-0 mt-px">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* Quick reference table */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden mb-10">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="label-caps">Quick Reference</h2>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-hairline">
            {quickRows.map(([task, where], i) => (
              <tr key={i} className="hover:bg-ink-50 transition-colors duration-fast">
                <td className="px-6 py-3 text-ink-700 font-medium text-xs w-1/2">{task}</td>
                <td className="px-6 py-3 text-ink-500 text-xs">{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contact */}
      <div className="bg-accent-50 border border-accent-200 rounded-card px-6 py-5 mb-4">
        <p className="text-sm font-semibold text-ink-900 mb-1">Still have questions?</p>
        <p className="text-ink-600 text-xs leading-relaxed">
          Reach out to your YachtPics rep directly at{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-accent-700 hover:underline font-medium">
            charlie@yachtpics.com
          </a>
          . We typically respond same day.
        </p>
      </div>

      {/* Copyright / DMCA */}
      <div className="bg-white border border-hairline rounded-card shadow-elev-1 px-6 py-5">
        <p className="label-caps mb-2">Copyright &amp; Content</p>
        <p className="text-ink-600 text-xs leading-relaxed">
          All content uploaded to the YachtPics Portal must be owned by you or used with the copyright
          holder&apos;s permission. If you believe content on this platform infringes your copyright,
          please submit a takedown request to{" "}
          <a href="mailto:dmca@yachtpics.com" className="text-accent-700 hover:underline font-medium">
            dmca@yachtpics.com
          </a>
          {" "}with a description of the work, the location of the infringing material, and your contact
          information. We will respond promptly.
        </p>
      </div>
    </div>
  );
}
