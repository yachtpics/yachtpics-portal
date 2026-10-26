/**
 * Pass-through layout for a broker's website (/b/{slug} and its boat pages).
 * It exists so the editor can refresh the whole site at once with
 * revalidatePath(`/b/${slug}`, "layout") — home page and every boat page.
 */
export default function BrokerSiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
