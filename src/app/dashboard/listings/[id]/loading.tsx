import ListingSkeleton from "./_components/ListingSkeleton";

/**
 * Shown if the route itself still has to be fetched. In practice this rarely
 * appears — the page is a client component and Next prefetches it, so the
 * transition usually resolves immediately and the page's own loading state
 * (which renders the same skeleton) is what you see instead. Kept so there is
 * never a moment where a click produces nothing on screen.
 */
export default function Loading() {
  return <ListingSkeleton />;
}
