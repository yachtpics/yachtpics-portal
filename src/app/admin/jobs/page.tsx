import { requireAdminPage } from "@/lib/requireAdminPage";
import JobsBoard from "./_components/JobsBoard";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-display text-ink-900">Jobs</h1>
        <p className="text-ink-500 mt-1 text-sm">
          Long admin tasks that run on the server in the background — they keep going if you close the tab.
          Recent runs, their progress, and Retry for any that failed.
        </p>
      </div>
      <JobsBoard />
    </div>
  );
}
