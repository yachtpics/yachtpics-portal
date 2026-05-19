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
      "Listings appear automatically once YachtPics delivers your photos. Click any listing to open it.",
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
      "Click Add Video and select an MP4 or MOV file from your computer.",
      "Videos appear in the client slideshow after all photos — buyers can play them directly in the browser.",
      "To remove a video, click the delete button on its card. There's no limit on video count.",
    ],
  },
  {
    num: "05",
    title: "Sharing with Clients & Tracking Views",
    steps: [
      "Inside any listing, click the Share Slideshow button to copy the client link.",
      "The link opens a branded, full-screen gallery — no login required for the client.",
      "Every time you share, a record is logged under Sent History with the date and recipient.",
      "The view count next to each listing shows how many times clients have opened the slideshow.",
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
      "Photo downloads are always free — no subscription required.",
      "A paid plan unlocks video uploads and the slideshow builder.",
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
];

const quickRef = [
  ["Share a listing with a client", "My Listings → listing → Share Slideshow"],
  ["View who opened your slideshow", "My Listings → listing → Sent History"],
  ["Reorder photos", "My Listings → listing → drag and drop"],
  ["Hide a photo from clients", "My Listings → listing → eye icon on photo"],
  ["Bulk-delete or bulk-download photos", "My Listings → listing → Select mode"],
  ["Assign a category to multiple photos", "My Listings → listing → Select mode → category dropdown → Apply"],
  ["Change your password", "My Profile → Change Password"],
  ["Upload a video", "My Listings → listing → Videos section → Add Video"],
  ["Upload your logo", "My Profile → Company Logo"],
  ["Add or remove an assistant", "My Profile → Assistants"],
  ["Start a free trial", "Billing → choose a plan → Start free trial"],
  ["View shoot history & invoices", "Shoots & Invoices"],
  ["Change your login email", "My Profile → Change Login Email"],
  ["Manage billing & download receipts", "Billing → Manage billing & invoices"],
  ["Sign out", "Sidebar → Sign out (bottom-left)"],
];

export default function HelpPage() {
  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900">Help &amp; User Guide</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Everything you need to get up and running with the YachtPics Portal.
        </p>
      </div>

      {/* Download banner */}
      <div className="bg-[#050b14] rounded-xl px-6 py-5 flex items-center justify-between mb-10 gap-4 flex-wrap">
        <div>
          <p className="text-white font-semibold text-sm">Full User Guide (PDF)</p>
          <p className="text-gray-400 text-xs mt-0.5">
            A complete walkthrough of every feature &mdash; great to keep on file or share with your team.
          </p>
        </div>
        <a
          href="/YachtPics_Portal_User_Guide.pdf"
          download
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Download Guide &darr;
        </a>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {sections.map((s) => (
          <div key={s.num} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-[#d4a843] bg-[#d4a843]/10 px-2 py-0.5 rounded-full">
                {s.num}
              </span>
              <h2 className="font-semibold text-gray-900 text-sm">{s.title}</h2>
            </div>
            <ol className="space-y-1.5">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-600 leading-relaxed">
                  <span className="text-[#d4a843] font-bold shrink-0 mt-px">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* Quick reference table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-10">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Quick Reference</h2>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {quickRef.map(([task, where], i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-3 text-gray-700 font-medium text-xs w-1/2">{task}</td>
                <td className="px-6 py-3 text-gray-400 text-xs">{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contact */}
      <div className="bg-[#d4a843]/10 border border-[#d4a843]/30 rounded-xl px-6 py-5 mb-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">Still have questions?</p>
        <p className="text-gray-500 text-xs leading-relaxed">
          Reach out to your YachtPics rep directly at{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-[#c49a35] hover:underline font-medium">
            charlie@yachtpics.com
          </a>
          . We typically respond same day.
        </p>
      </div>

      {/* Copyright / DMCA */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Copyright &amp; Content</p>
        <p className="text-gray-500 text-xs leading-relaxed">
          All content uploaded to the YachtPics Portal must be owned by you or used with the copyright
          holder&apos;s permission. If you believe content on this platform infringes your copyright,
          please submit a takedown request to{" "}
          <a href="mailto:dmca@yachtpics.com" className="text-[#c49a35] hover:underline font-medium">
            dmca@yachtpics.com
          </a>
          {" "}with a description of the work, the location of the infringing material, and your contact
          information. We will respond promptly.
        </p>
      </div>

    </div>
  );
}
