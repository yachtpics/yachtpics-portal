import Link from "next/link";

const sections = [
  {
    num: "01",
    title: "Creating Your Account",
    steps: [
      "You'll receive an invite email from YachtPics — click 'Set Up Your Account' and create a password.",
      "Your profile is pre-filled with your name and email. Complete the rest under My Profile.",
      "If you have an assistant, they may already be linked and ready to help before you even log in.",
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
      "Use categories (Exterior, Interior, Cockpit, etc.) to organize photos — clients see these labels in the slideshow.",
      "Toggle the eye icon on any photo to hide it from the client view without deleting it.",
      "Switch to Select mode to bulk-download, bulk-hide, bulk-delete, or bulk-assign categories to multiple photos at once.",
      "In Select mode, choose photos then pick a category from the dropdown and click Apply to update them all at once.",
      "When uploading photos from a mobile device, a prompt will appear if categories can't be detected automatically — just pick the category before uploading.",
      "Flag a photo as a File Missing warning means the original file is gone — delete it and re-upload.",
    ],
  },
  {
    num: "04",
    title: "Videos",
    steps: [
      "Open any listing and scroll to the Videos section below your photos.",
      "Click Upload MP4 and select an MP4 or MOV file from your computer.",
      "By default a video appears at the front of the client slideshow. Use 'Hide from slideshow' on the video to keep it on the listing but out of the gallery.",
      "You can also send a video on its own — in Send to Client, tick the video to email the client a direct link, separate from the slideshow.",
      "For smooth playback on phones, export videos at 1080p (not 4K). To remove a video, click Delete on its card. There's no limit on video count.",
    ],
  },
  {
    num: "05",
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
    num: "06",
    title: "Shoots & Invoices",
    steps: [
      "Every completed shoot is logged here automatically — no action needed.",
      "Each row shows the date, vessel, invoice number, amount, and payment status.",
      "Contact your YachtPics rep with the invoice number for any billing questions.",
    ],
  },
  {
    num: "07",
    title: "Billing & Subscription",
    steps: [
      "Photo downloads are always free — no subscription required, even after your trial ends.",
      "A paid plan unlocks the tools: uploading photos and videos, publishing slideshows, Send to Client, spec sheets, and social posts.",
      "All plans include a 30-day free trial. Cancel anytime from the Billing page.",
    ],
  },
  {
    num: "08",
    title: "Working with Assistants",
    steps: [
      "Assistants can manage listings, upload photos and videos, and send slideshows on your behalf.",
      "To add an assistant, go to My Profile → Assistants, enter their email, and click Add.",
      "New assistants will receive an invite email and be linked to your account automatically.",
      "Assistants see all your listings but cannot access billing or change your account settings.",
      "To remove an assistant, go to My Profile → Assistants and click Remove next to their name.",
    ],
  },
  {
    num: "09",
    title: "Marketing Tools",
    steps: [
      "Cover photo: tap the ★ on a photo to make it the cover used on your spec sheet and social posts. If none is set, the first photo is used.",
      "Spec Sheet: open a listing and click Spec Sheet for a clean, branded, printable one-pager with the specs, your logo, and a QR code — ready to print or email.",
      "Social Post: click Social Post to turn any photo into a branded, post-ready image with a caption and hashtags written for you. Download and post to Instagram or Facebook.",
      "QR code: once a listing's slideshow is published, it gets its own QR code. Add it to a flyer or dock sign so buyers scan straight to your gallery.",
    ],
  },
  {
    num: "10",
    title: "Buyer Inquiries",
    steps: [
      "Your published slideshow has a Request Info button buyers can use to reach out.",
      "When a buyer submits it, the lead lands in your inbox and on the listing — name, contact, and message.",
      "Open the listing to see all inquiries and mark them contacted as you follow up.",
      "You also get an email the moment a buyer opens your slideshow (adjustable in My Profile → Notifications).",
    ],
  },
  {
    num: "11",
    title: "Recently Photographed",
    steps: [
      "Recently Photographed (in the sidebar) is a portal-wide showcase of the latest boats YachtPics has shot — a place to see fresh inventory and connect broker-to-broker.",
      "YachtPics curates which boats appear. If a client is after a certain type of boat, browse here and reach the listing broker directly using the phone and email on each card.",
      "Keeping a boat quiet? Open the listing and check 'Keep this a pocket listing' to hide it from the showcase — even if we've featured it. Nothing else changes; your photos, downloads, and client sharing are unaffected.",
    ],
  },
];

const quickRef = [
  ["Share a listing with a client", "My Listings → listing → Share Slideshow"],
  ["Quickly send a listing to a client", "My Listings → Send button on listing row"],
  ["Download all photos for a listing", "My Listings → Download button on listing row"],
  ["View who opened your slideshow", "My Listings → listing → Sent History"],
  ["Reorder photos", "My Listings → listing → drag and drop"],
  ["Hide a photo from clients", "My Listings → listing → eye icon on photo"],
  ["Bulk-delete or bulk-download photos", "My Listings → listing → Select mode"],
  ["Assign a category to multiple photos", "My Listings → listing → Select mode → category dropdown → Apply"],
  ["Change your password", "My Profile → Change Password"],
  ["Upload a video", "My Listings → listing → Videos section → Add Video"],
  ["Set the cover photo", "My Listings → listing → ★ on a photo"],
  ["Make a branded spec sheet", "My Listings → listing → Spec Sheet"],
  ["Create a social post", "My Listings → listing → Social Post"],
  ["Hide a video from the slideshow", "My Listings → listing → video → Hide from slideshow"],
  ["Send a video on its own", "My Listings → listing → Send to Client → tick the video"],
  ["See buyer inquiries", "My Listings → listing → Inquiries section"],
  ["Browse tips & tricks", "Sidebar → Tips"],
  ["Upload your logo", "My Profile → Company Logo"],
  ["Add or remove an assistant", "My Profile → Assistants"],
  ["Start a free trial", "Billing → choose a plan → Start free trial"],
  ["View shoot history & invoices", "Shoots & Invoices"],
  ["Change your login email", "My Profile → Change Login Email"],
  ["Manage billing & download receipts", "Billing → Manage billing & invoices"],
  ["See recently photographed boats", "Sidebar → Recently Photographed"],
  ["Keep a boat out of the showcase", "My Listings → listing → 'Keep this a pocket listing'"],
  ["Sign out", "Sidebar → Sign out (bottom-left)"],
];

export default function HelpPage() {
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
        {sections.map((s) => (
          <div key={s.num} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
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
            {quickRef.map(([task, where], i) => (
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
