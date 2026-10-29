import PageSkeleton from "@/components/PageSkeleton";

// Shown the moment Assistants is clicked (Brokers and Listings already had
// one), so switching admin pages never looks frozen while the server renders.
export default function Loading() {
  return <PageSkeleton variant="list" />;
}
