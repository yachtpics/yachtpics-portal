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
      "To take an old boat off the active list, open it → Edit → set Status to Sold or Archived. To delete a duplicate completely, ask YachtPics.",
    ],
  },
  {
    num: "05",
    title: "Working on a Broker's Boat",
    steps: [
      "You can change any boat in your brokerage exactly as that broker's assistant can — open it from My Listings.",
      "Edit its details (name, year, model, price, description, status), add, replace, hide or delete photos and videos, label photos and send it to clients.",
      "The boat stays the broker's: it keeps their name, and sending uses their plan, your Team or Office plan, or your own plan (see below).",
      "Your own plan covers your brokers' boats: if you pay for a plan of your own, the Portal tools are on for the boats of every broker here with no plan of their own. Your plan's boat range is how many boats it is meant for. The Portal counts a boat — your own active boats first — the first time a paid tool is used on it, by you or anyone working on it, like sending it to a client or sharing its slideshow, and shows the count on Billing, My Listings and the boat's page. Over the range you see a note pointing to Team or Office, which cover every boat in the office; nothing is switched off. A boat stops counting when it is sold or archived.",
      "Their plan, billing and the Reel Service stay with the broker and their assistant.",
    ],
  },
  {
    num: "06",
    title: "New / House Inventory",
    steps: [
      "Boats that aren't tied to a specific broker (new builds, trade-ins, house inventory) go under your account.",
      "Upload them the same way you would any listing — create a new listing and add photos.",
      "By default these boats are private — only you can see them until you choose to share.",
      "This lets you stage and finish a boat before any of your brokers see it.",
    ],
  },
  {
    num: "07",
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
    num: "08",
    title: "What Your Brokers See",
    steps: [
      "Each broker sees their own boats, plus any inventory you've shared with the brokerage.",
      "They do not see each other's private listings, and they can't see unshared house inventory.",
      "Shared boats show a small Shared badge in the listings view so it's clear what's live to the team.",
      "Brokers can download, send, and build slideshows from shared boats just like their own.",
    ],
  },
  {
    num: "09",
    title: "Team and Office Plans",
    steps: [
      "One plan covers your whole brokerage location — your brokers, all of their assistants and every boat — instead of each broker paying for their own.",
      "Two sizes, both per location: Team is $129 a month for up to 4 brokers; Office is $249 a month for up to 8.",
      "Billing lives under Brokerage → Billing. Both plans are shown there, with the one that fits your office marked; start it from its button. The same page then shows the plan's status, the renewal date, and how many brokers you have against the plan.",
      "While it's active every broker in your brokerage is covered automatically — no plan of their own needed — and your shared inventory is included.",
      "Growing past 4 brokers on Team: the page says so and offers Move to Office. If your office fits Team again, you can switch back to Team from the same page.",
      "Office covers up to 8 brokers per location. If you go over, the page says so — reach out to YachtPics to add seats.",
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
  ["Change a broker's boat (details, photos, videos)", "My Listings → open the boat → Edit, or add photos and videos on the page"],
  ["Retire an old boat", "Open the boat → Edit → Status: Sold or Archived"],
  ["Change your password", "My Profile → Change Password"],
  ["Start or manage the Team or Office plan", "Brokerage → Billing"],
  ["Cover your brokers' boats with your own plan", "Billing → choose a plan (the Portal counts the boats in use; over the range is a note only). For the whole office, Team or Office under Brokerage → Billing"],
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
