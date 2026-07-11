import ShowcaseGrid from "@/components/ShowcaseGrid";

export const dynamic = "force-dynamic";

// Recently Photographed inside the admin shell, so admins stay in /admin
// instead of getting dropped into the broker dashboard layout.
export default function AdminShowcasePage() {
  return <ShowcaseGrid />;
}
