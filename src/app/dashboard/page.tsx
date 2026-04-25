import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#050b14] px-6 py-4 flex items-center justify-between">
        <span className="text-white font-semibold tracking-wide">
          YachtPics<span className="text-[#d4a843]"> Portal</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">Welcome back</span>
          <button className="text-gray-400 hover:text-white text-sm transition-colors">Sign out</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1 text-sm">Manage your listings and create buyer presentations.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {[
            { title: "My Shoots", desc: "View and download photos from your YachtPics sessions.", href: "/dashboard/listings", cta: "View shoots" },
            { title: "Build Slideshow", desc: "Create a branded presentation to share with a buyer.", href: "/dashboard/slideshow", cta: "Start building" },
            { title: "Upload Photos", desc: "Add photos from any listing to your portfolio.", href: "/dashboard/listings", cta: "Upload now" },
          ].map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="bg-white border border-gray-200 rounded-xl p-6 hover:border-[#d4a843] hover:shadow-sm transition-all group"
            >
              <h3 className="font-semibold text-gray-900 mb-1">{action.title}</h3>
              <p className="text-gray-500 text-sm mb-4">{action.desc}</p>
              <span className="text-[#c49a35] text-sm font-medium">{action.cta} →</span>
            </Link>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-900">Recent Listings</h2>
            <Link href="/dashboard/listings" className="text-[#c49a35] hover:text-[#b08c2a] text-sm font-medium transition-colors">
              View all →
            </Link>
          </div>
          <div className="text-center py-10 text-gray-400">
            <p className="text-sm">No listings yet.</p>
            <p className="text-sm mt-1">Your YachtPics shoot photos will appear here after delivery.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
