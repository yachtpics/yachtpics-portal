import ListingEditForm from "@/components/ListingEditForm";

/**
 * Correcting vessel details from the admin side.
 *
 * Previously the admin listing page showed the year, make, length and so on as
 * plain text with no way to change them — so a typo entered at upload could
 * only be fixed by deleting the listing and starting again, photos and all.
 *
 * Same form the brokers use; the update API already permitted admins.
 */
export default function AdminEditListingPage() {
  return <ListingEditForm basePath="/admin/listings" />;
}
