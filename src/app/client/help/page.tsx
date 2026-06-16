const sections = [
  {
    num: "01",
    title: "Signing In",
    steps: [
      "You received an email from YachtPics with a link and a temporary password.",
      "Go to portal.yachtpics.com/auth/login and sign in with your email and that temporary password.",
      "Once you're in, click Change password in the top-right to set your own password.",
    ],
  },
  {
    num: "02",
    title: "Viewing Your Photos",
    steps: [
      "After signing in you'll see Your galleries — click one to open it.",
      "Click Play slideshow to watch a full-screen slideshow of the photos (and any videos).",
      "Use the Slideshow / All Photos toggle at the top of the slideshow to switch between the playing view and a grid of everything.",
    ],
  },
  {
    num: "03",
    title: "Downloading Photos & Videos",
    steps: [
      "Click Download all photos to get every photo at once as a single ZIP file.",
      "To grab just one, hover (or tap) a photo and click Download. Videos have their own Download button in the Videos section.",
      "Downloads are available until the date shown on the gallery. After that you can still watch and share the slideshow, but downloads turn off — contact YachtPics if you need the files again.",
    ],
  },
  {
    num: "04",
    title: "Sharing the Slideshow",
    steps: [
      "Click Copy slideshow link to share to copy a link you can paste anywhere (text, email, social).",
      "Or click Email slideshow to send the link straight from here — enter an email and an optional note.",
      "Anyone you share with can watch the slideshow without logging in. Sharing the slideshow never gives them download access — only people you'd ask YachtPics to add can download.",
    ],
  },
  {
    num: "05",
    title: "Choosing What's in the Slideshow",
    steps: [
      "Want only certain photos in the slideshow you share? Hover a photo and click the eye icon to hide it.",
      "Hidden photos drop out of the slideshow but stay fully downloadable for you — they're just not part of the show.",
      "Drag photos to reorder them; the slideshow plays in the order you set. Changes save automatically.",
    ],
  },
];

const quickRef = [
  ["Change your password", "Top-right → Change password"],
  ["Watch the slideshow", "Open a gallery → Play slideshow"],
  ["Download everything", "Open a gallery → Download all photos"],
  ["Download one photo", "Hover a photo → Download"],
  ["Download a video", "Videos section → Download"],
  ["Copy the slideshow link", "Open a gallery → Copy slideshow link to share"],
  ["Email the slideshow to someone", "Open a gallery → Email slideshow"],
  ["Hide a photo from the slideshow", "Hover a photo → eye icon"],
  ["Reorder photos", "Drag a photo to a new spot"],
  ["Sign out", "Top-right → Sign out"],
];

export default function ClientHelpPage() {
  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <div className="mb-8">
        <a href="/client" className="text-gray-400 hover:text-gray-600 text-sm transition-colors">&larr; Your galleries</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-3">Help &amp; Guide</h1>
        <p className="text-gray-500 mt-1 text-sm">How to view, download, and share your YachtPics gallery.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {sections.map((s) => (
          <div key={s.num} className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-[#d4a843] bg-[#d4a843]/10 px-2 py-0.5 rounded-full">{s.num}</span>
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

      <div className="bg-[#d4a843]/10 border border-[#d4a843]/30 rounded-xl px-6 py-5">
        <p className="text-sm font-semibold text-gray-900 mb-1">Need a hand?</p>
        <p className="text-gray-500 text-xs leading-relaxed">
          Email YachtPics at{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-[#c49a35] hover:underline font-medium">charlie@yachtpics.com</a>
          {" "}and we&apos;ll help you out.
        </p>
      </div>
    </div>
  );
}
