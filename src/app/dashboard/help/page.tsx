import Link from "next/link";

const sections = [
  {
    num: "01",
    title: "Creating Your Account",
    steps: [
      "Go to the Portal and click Create an account.",
      "Enter your name, brokerage, email, and a password (min. 8 characters).",
      "Check your inbox and click the confirmation link to activate.",
    ],
  },
  {
    num: "02",
    title: "Completing Your Profile",
    steps: [
      "Go to My Profile and fill in your personal and brokerage information.",
      "Upload your company logo — it appears in the footer of every client slideshow.",
      "Click Save Profile. Do this before sharing your first listing.",
    ],
  },
  {
    num: "03",
    title: "My Listings",
    steps: [
      "Listings appear automatically after YachtPics delivers your photos.",
      "Click any listing to view photos, reorder them, and toggle visibility.",
      "Copy the client share link to send a branded slideshow directly to buyers.",
    ],
  },
  {
    num: "04",
    title: "Shoots & Invoices",
    steps: [
      "Every completed shoot is logged here automatically — no action needed.",
      "Each row shows the date, vessel, invoice number, amount, and payment status.",
      "Contact your YachtPics rep with the invoice number for any billing questions.",
    ],
  },
  {
    num: "05",
    title: "Billing & Subscription",
    steps: [
      "Photo downloads are always free — no subscription required.",
      "A paid plan unlocks photo uploading and the slideshow builder.",
      "All plans include a 30-day free trial. Cancel anytime.",
    ],
  },
  {
    num: "06",
    title: "Adding Assistants",
    steps: [
      "Assistants can manage listings and download photos on your behalf.",
      "They must first create their own account with the role 'assistant'.",
      "Go to My Profile → Assistants, enter their email, and click Add Assistant.",
    ],
  },
];

const quickRef = [
  ["Share a listing with a client", "My Listings → listing → copy share link"],
  ["Upload your logo", "My Profile → Company Logo"],
  ["Start a free trial", "Billing → choose a plan → Start free trial"],
  ["Add or remove an assistant", "My Profile → Assistants"],
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
        <h1 className="text-2xl font-bold text-gray-900">Help & User Guide</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Everything you need to get up and running with the YachtPics Portal.
        </p>
      </div>

      {/* Download banner */}
      <div className="bg-[#050b14] rounded-xl px-6 py-5 flex items-center justify-between mb-10 gap-4 flex-wrap">
        <div>
          <p className="text-white font-semibold text-sm">Full User Guide (PDF)</p>
          <p className="text-gray-400 text-xs mt-0.5">
            A complete walkthrough of every feature — great to keep on file or share with your team.
          </p>
        </div>
        <a
          href="/YachtPics_Portal_User_Guide.pdf"
          download
          className="bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Download Guide ↓
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
      <div className="bg-[#d4a843]/10 border border-[#d4a843]/30 rounded-xl px-6 py-5">
        <p className="text-sm font-semibold text-gray-900 mb-1">Still have questions?</p>
        <p className="text-gray-500 text-xs leading-relaxed">
          Reach out to your YachtPics rep directly at{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-[#c49a35] hover:underline font-medium">
            charlie@yachtpics.com
          </a>
          . We typically respond same day.
        </p>
      </div>

    </div>
  );
}
