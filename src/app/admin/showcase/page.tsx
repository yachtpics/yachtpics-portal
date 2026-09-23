import { requireAdminPage } from "@/lib/requireAdminPage";
import ShowcaseGrid from "@/components/ShowcaseGrid";
import ShowcaseMetrics from "@/components/ShowcaseMetrics";

export const dynamic = "force-dynamic";

// Recently Photographed inside the admin shell, so admins stay in /admin
// instead of getting dropped into the broker dashboard layout.
export default async function AdminShowcasePage() {
  // Role check lives in the page, not only the layout — see requireAdminPage.
  await requireAdminPage();
  return (
    <>
      <ShowcaseMetrics />
      <ShowcaseGrid />
    </>
  );
}
