import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { LegalSection } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Data Deletion · YachtPics Portal",
  description: "How to delete your Facebook/Instagram connection or your YachtPics Portal account and data.",
};

export const dynamic = "force-dynamic";

/**
 * Public — no login. Also the status page Meta's Data Deletion Callback
 * (POST /api/meta/data-deletion) points people to: /data-deletion?code=XXX.
 */
export default function DataDeletionPage({ searchParams }: { searchParams: { code?: string } }) {
  const raw = typeof searchParams?.code === "string" ? searchParams.code : "";
  const code = /^[A-Za-z0-9-]{4,40}$/.test(raw) ? raw : "";

  return (
    <LegalShell eyebrow="Legal" title="Deleting your data">
      {code && (
        <div className="px-4 py-3 rounded-card border bg-success-50 border-success-200 text-success-700 text-sm">
          Your deletion request <strong>{code}</strong> has been processed. The Facebook and Instagram connection details and access
          tokens linked to your Facebook account have been deleted from the YachtPics Portal.
        </div>
      )}

      <LegalSection title="1. Disconnect Facebook and Instagram">
        <p>
          Sign in to the Portal, open <strong>Profile &rarr; Social accounts</strong>, and click <strong>Disconnect</strong> next to the Page.
          This immediately deletes the stored Facebook Page access token, Page details and linked Instagram details from the Portal,
          and cancels any posts scheduled to that Page.
        </p>
        <p>
          You can also remove the <strong>YachtPics Portal</strong> app from Facebook (Settings &amp; privacy &rarr; Settings &rarr; Business
          integrations) and choose to delete your data. Facebook then notifies us automatically, we delete the same information, and
          Facebook shows you a confirmation code you can check on this page.
        </p>
        <p>Reels already published to Facebook or Instagram remain there until you delete them on those platforms.</p>
      </LegalSection>

      <LegalSection title="2. Delete your Portal account and data">
        <p>
          Email <a href="mailto:charlie@yachtpics.com?subject=Delete%20my%20YachtPics%20Portal%20account" className="text-accent-700 underline">charlie@yachtpics.com</a>{" "}
          from the address on your account and ask us to delete your account. We will confirm by email and delete your account, listing
          records, uploaded media, analytics and any social connections within <strong>30 days</strong>, except limited records we
          must keep by law (such as billing records).
        </p>
      </LegalSection>

      <LegalSection title="Questions">
        <p>
          YachtPics Enterprises LLC · 309 Lake Circle, Apt 102, North Palm Beach, FL 33408 ·{" "}
          <a href="mailto:charlie@yachtpics.com" className="text-accent-700 underline">charlie@yachtpics.com</a> · 561-602-9710.
          See also our <Link href="/privacy" className="text-accent-700 underline">Privacy Policy</Link>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
