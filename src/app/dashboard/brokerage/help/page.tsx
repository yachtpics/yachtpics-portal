import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const sections = [
  {
    num: "01",
    title: "Your Brokerage Account",
    steps: [
      "Your account is the brokerage admin — it sees and manages every broker's boats in your brokerage from one login.",
      "You also have your own listings area for new/house inventory that isn't tied to a specific broker.",
      "Open the Brokerage tab from the sidebar to manage your team and see everyone's boats.",
      "Only this account (and YachtPics) can add members or share inventory — your individual brokers cannot.",
    ],
  },
  {
    num: "02",
    title: "Adding a Broker",
    steps: [
      "Go to Brokerage → Add a broker, enter their first name, last name, and email, then click Invite.",
      "A temporary password is generated and shown on screen — they also receive an invite email with it.",
      "The broker logs in, sets their own password under My Profile, and completes their profile and logo.",
      "Their boats are theirs alone — you can see and manage them, but other brokers cannot.",
    ],
  },
  {
    num: "03",
    title: "Adding an Assistant",
    steps: [
      "Go to Brokerage → Add an assistant, enter their name and email.",
      "Optionally link them to a specific broker so they can manage that broker's listings.",
      "Leave the broker blank to add them now and link them later.",
      "Assistants work the same as always — they help the broker(s) they're linked to, not the whole brokerage.",
    ],
  },
  {
    num: "04",
    title: "How Boats Are Organized",
    steps: [
      "Every boat lives under exactly one account — the broker who owns it, or your account for new inventory.",
      "You don't need to copy a boat to your account to see it — as brokerage admin you already see every broker's boats.",
      "Avoid uploading the same boat twice (once under a broker and once under your account) — it creates duplicates.",
      "If you ever need a boat removed, open it and use Delete, which also clears its photos from storage.",
    ],
  },
  {
    num: "05",
    title: "New / House Inventory",
    steps: [
      "Boats that aren't tied to a specific broker (new builds, trade-ins, house inventory) go under your account.",
      "Upload them the same way you would any listing — create a new listing and add photos.",
      "By default these boats are private — only you can see them until you choose to share.",
      "This lets you stage and finish a boat before any of your brokers see it.",
    ],
  },
  {
    num: "06",
    title: "Sharing a Boat with Your Brokers",
    steps: [
      "Open any boat and use the Share with brokerage toggle near the top of the listing.",
      "Turn it on and that boat becomes visible to every broker in your brokerage.",
      "Turn it off at any time to pull it back to private — brokers immediately stop seeing it.",
      "Sharing is per boat, so you decide exactly which inventory goes out and when.",
      "Only your account and YachtPics can flip this — individual brokers can't share boats themselves.",
    ],
  },
  {
    num: "07",
    title: "What Your Brokers See",
    steps: [
      "Each broker sees their own boats, plus any inventory you've shared with the brokerage.",
      "They do not see each other's private listings, and they can't see unshared house inventory.",
      "Shared boats show a small Shared badge in the listings view so it's clear what's live to the team.",
      "Brokers can download, send, and build slideshows from shared boats just like their own.",
    ],
  },
];

const quickRef = [
  ["Add a broker", "Brokerage → Add a broker"],
  ["Add an assistant", "Brokerage → Add an assistant"],
  ["Link an assistant to a broker", "Brokerage → Add an assistant → choose a broker"],
  ["Upload new / house inventory", "My Listings → New Listing → add photos"],
  ["Share a boat with your brokers", "Open the boat → Share with brokerage toggle"],
  ["Un-share a boat", "Open the boat → turn off Share with brokerage"],
  ["See which boats are shared", "My Listings → look for the Shared badge"],
  ["See a broker's boats", "My Listings (you see every broker's boats)"],
  ["Remove a duplicate or old boat", "Open the boat → Delete"],
  ["Change your password", "My Profile → Change Password"],
];

export default async function BrokerageHelpPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_brokerage_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_brokerage_admin) redirect("/dashboard");

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-10 pb-6 border-b border-hairline">
        <Link href="/dashboard/brokerage" className="text-ink-500 hover:text-ink-700 text-sm transition-colors duration-fast">← Brokerage</Link>
        <h1 className="text-display text-ink-900 mt-1">Brokerage Admin Guide</h1>
        <p className="text-ink-500 mt-1 text-sm">
          How to manage your team and control which inventory your brokers can see.
        </p>
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
      <div className="bg-accent-50 border border-accent-200 rounded-card px-6 py-5">
        <p className="text-sm font-semibold text-ink-900 mb-1">Need a hand?</p>
        <p className="text-ink-600 text-xs leading-relaxed">
          Reach out to your YachtPics rep directly at{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-accent-700 hover:underline font-medium">
            charlie@yachtpics.com
          </a>
          . We typically respond same day.
        </p>
      </div>
    </div>
  );
}
