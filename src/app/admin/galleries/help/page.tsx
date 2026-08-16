import Link from "next/link";

const sections = [
  {
    num: "01",
    title: "What Galleries Are For",
    steps: [
      "Galleries deliver photos and videos to people who aren't brokers — event coordinators, yacht owners, anyone.",
      "Recipients get a free login (no billing, no trial) that only lets them view, download, and share — never upload.",
      "Use them for one-off deliveries: a charity event, an owner's copy of a shoot, etc. They're separate from broker listings.",
    ],
  },
  {
    num: "02",
    title: "Creating a Gallery",
    steps: [
      "Galleries → New Gallery. Give it a title (e.g. 'Autism Charity Event'), pick a type, and set the download window.",
      "Download window options: 30 / 60 / 90 days, a custom date, or no expiry. You can change this anytime later.",
      "Click Create — you'll land on the gallery page where you upload media and add recipients.",
    ],
  },
  {
    num: "03",
    title: "Adding Photos & Videos",
    steps: [
      "Click Upload photos or Upload videos on the gallery page. You can select many at once.",
      "Drag photos to reorder them — that's the order the slideshow plays in.",
      "Click the eye icon on a photo to hide it from the slideshow (it stays downloadable). Hidden photos dim with a 'Hidden' tag.",
    ],
  },
  {
    num: "04",
    title: "Adding Recipients",
    steps: [
      "Under Recipients, enter an email (and optional name) and click Add & invite.",
      "If they're new, a free client account is created and they're emailed a login + temporary password. If a temp password shows, you can pass it along too.",
      "You can add several recipients to one gallery (e.g. a coordinator plus an assistant). Click Remove to revoke a recipient's access.",
    ],
  },
  {
    num: "05",
    title: "Sharing & Sending the Slideshow",
    steps: [
      "Every gallery has a public slideshow link (under Slideshow link). Anyone with the link can watch — no login, no downloads.",
      "Click Copy to copy the link, or Email this slideshow to someone to send it with an optional note.",
      "Recipients can also copy/email the slideshow link and curate it (hide/reorder) from their own login before sharing it onward.",
    ],
  },
  {
    num: "06",
    title: "Expiry & Tracking",
    steps: [
      "When the download window passes, downloads turn off automatically — the slideshow stays viewable.",
      "The Activity panel shows slideshow views, files downloaded, download sessions, and the last download time.",
      "Every invite and slideshow send is also recorded in the admin Email Log.",
    ],
  },
];

const quickRef = [
  ["Create a gallery", "Galleries → New Gallery"],
  ["Upload photos / videos", "Open gallery → Upload photos / Upload videos"],
  ["Reorder photos", "Open gallery → drag a photo"],
  ["Hide a photo from the slideshow", "Open gallery → eye icon on a photo"],
  ["Add a recipient", "Open gallery → Recipients → Add & invite"],
  ["Remove a recipient", "Open gallery → Recipients → Remove"],
  ["Change the download window", "Open gallery → Download window"],
  ["Copy the slideshow link", "Open gallery → Slideshow link → Copy"],
  ["Email the slideshow", "Open gallery → Email this slideshow to someone"],
  ["See views & downloads", "Open gallery → Activity"],
  ["Delete a gallery", "Open gallery → Delete this gallery (bottom)"],
];

export default function AdminGalleriesHelpPage() {
  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <Link href="/admin/galleries" className="text-ink-400 hover:text-ink-600 text-sm transition-colors duration-fast ease-quiet">&larr; Back to Galleries</Link>
        <h1 className="text-display text-ink-900 mt-3">Galleries — How It Works</h1>
        <p className="text-ink-500 mt-1 text-sm">Delivering photos and videos to non-broker recipients.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {sections.map((s) => (
          <div key={s.num} className="bg-white border border-hairline rounded-card shadow-elev-1 p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-accent-700 bg-accent-50 px-2 py-0.5 rounded-full tabular-nums">{s.num}</span>
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

      <div className="bg-white border border-hairline rounded-card shadow-elev-1 overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="label-caps">Quick Reference</h2>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-hairline">
            {quickRef.map(([task, where], i) => (
              <tr key={i} className="hover:bg-ink-50 transition-colors duration-fast ease-quiet">
                <td className="px-6 py-3 text-ink-700 font-medium text-xs w-1/2">{task}</td>
                <td className="px-6 py-3 text-ink-500 text-xs">{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
