import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { LegalSection } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy · YachtPics Portal",
  description: "How YachtPics Enterprises LLC collects, uses and protects information in the YachtPics Portal.",
};

const UPDATED = "October 18, 2026";

/** Public — no login (middleware only guards /dashboard, /admin, /client). */
export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Legal" title="Privacy Policy" updated={UPDATED}>
      <LegalSection title="Who we are">
        <p>
          The YachtPics Portal (portal.yachtpics.com, the &ldquo;Portal&rdquo;) is operated by YachtPics Enterprises LLC, a Florida
          limited liability company (&ldquo;YachtPics&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). The Portal delivers yacht photography
          and video to yacht brokers and helps them share it with their clients. This policy explains what information the Portal
          collects, how we use it, and the choices you have.
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Account information</strong> — for brokers, assistants and brokerage administrators: name, email address, phone number, brokerage name and address, license number, logo, bio, and your sign-in credentials (passwords are stored hashed by our authentication provider; we never see them).</li>
          <li><strong>Listing media and details</strong> — photos, videos, documents and vessel details (such as name, make, model, year, length and location) that we produce for you or that you upload.</li>
          <li><strong>Usage and analytics</strong> — when a slideshow, listing page, reel or gallery is viewed we record the view (for example, which item was opened, when, and the type of browser or device) so brokers can see engagement. We also record basic technical logs needed to run and secure the service.</li>
          <li><strong>Client contacts</strong> — email addresses of the people a broker chooses to send a slideshow or gallery to, and whether they opened it.</li>
          <li><strong>Payments</strong> — subscriptions are processed by Stripe. Card details go directly to Stripe; we receive only limited information such as your plan, billing status and payment history.</li>
          <li><strong>Facebook and Instagram</strong> — only if you choose to connect them; see the section below.</li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use information">
        <ul className="list-disc pl-5 space-y-2">
          <li>To provide the Portal: store and deliver your media, build slideshows and reels, and send the emails you ask us to send.</li>
          <li>To show you how your listings and slideshows are performing.</li>
          <li>To manage your account and subscription, provide support, and send service messages (for example, delivery confirmations, password resets and billing notices).</li>
          <li>To send occasional product news, which you can turn off at any time in your Profile or from the link in any such email.</li>
          <li>To keep the service secure, prevent abuse, and meet legal obligations.</li>
        </ul>
        <p><strong>We do not sell your personal information</strong>, and we do not share it with third parties for their own advertising.</p>
      </LegalSection>

      <LegalSection title="Facebook and Instagram">
        <p>
          The Portal can post reels to a Facebook Page and its linked Instagram professional account for you. This is optional and
          only happens if you connect your account in Profile &rarr; Social accounts. When you connect, Facebook asks you which Pages
          and permissions to allow, and we store:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>your Facebook user ID (app-scoped) and the ID and name of each Page you choose;</li>
          <li>the ID and username of the Instagram professional account linked to that Page, if there is one; and</li>
          <li>a Page access token, stored encrypted (AES-256).</li>
        </ul>
        <p>
          We use this access <strong>only to publish the reels you choose</strong>, with the caption you approve, at the time you choose,
          and to show you the status of and link to those posts. We do not read your messages, comments, followers, insights or ads
          data, and we do not post anything you haven&rsquo;t asked us to.
        </p>
        <p>
          You can disconnect at any time in Profile &rarr; Social accounts. Disconnecting immediately deletes the stored token and Page
          details from the Portal and cancels any scheduled posts. You can also remove the YachtPics Portal app in your Facebook settings
          (Settings &amp; privacy &rarr; Settings &rarr; Business integrations); if you then ask Facebook to delete your data, Facebook
          notifies us and we delete it automatically. See our <Link href="/data-deletion" className="text-accent-700 underline">data deletion instructions</Link>.
          Posts already published to Facebook or Instagram stay there until you delete them on those platforms. Our use of information
          received from Meta follows the Meta Platform Terms.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>We use a small number of trusted providers to run the Portal. They process information only on our behalf and under their own security and privacy commitments:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Supabase</strong> — database, authentication and file storage.</li>
          <li><strong>Vercel</strong> — hosting of the Portal application.</li>
          <li><strong>Cloudflare R2</strong> — storage and delivery of photos and videos.</li>
          <li><strong>Stripe</strong> — subscription billing and payments.</li>
          <li><strong>Resend</strong> — sending the Portal&rsquo;s emails.</li>
          <li><strong>Meta (Facebook and Instagram)</strong> — only when you connect an account and ask us to post.</li>
        </ul>
        <p>We may also disclose information if required by law, or to protect the rights, property or safety of YachtPics, our users or others.</p>
      </LegalSection>

      <LegalSection title="Retention">
        <p>
          We keep account information and listing media for as long as your account is active, so the Portal can keep delivering and
          sharing it. View analytics are kept while the related listing exists. Facebook and Instagram connection data is kept only
          until you disconnect. When an account is closed we delete or anonymise its personal information within 30 days, except where
          we must keep limited records (for example, billing records for tax purposes) or where backups roll over on their normal cycle.
        </p>
      </LegalSection>

      <LegalSection title="Your rights and choices">
        <ul className="list-disc pl-5 space-y-2">
          <li>Update your account details at any time in your Profile.</li>
          <li>Turn product emails off in your Profile or from the unsubscribe link.</li>
          <li>Disconnect Facebook and Instagram at any time in Profile &rarr; Social accounts.</li>
          <li>Ask us for a copy of your information, to correct it, or to delete your account and data by emailing <a href="mailto:charlie@yachtpics.com" className="text-accent-700 underline">charlie@yachtpics.com</a>. We respond within 30 days.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is sent over encrypted connections (HTTPS). Media files are stored privately and shared through short-lived links, access
          to your records is restricted to you, your linked assistants and YachtPics staff who need it to provide the service, and
          social access tokens are encrypted at rest. No system is perfectly secure, but we work to protect your information.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>The Portal is a business service for yacht brokers and is not directed to children under 16. We do not knowingly collect their information.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>If we change this policy we will update the date above, and for significant changes we will tell account holders by email or in the Portal.</p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          YachtPics Enterprises LLC<br />
          309 Lake Circle, Apt 102<br />
          North Palm Beach, FL 33408<br />
          <a href="mailto:charlie@yachtpics.com" className="text-accent-700 underline">charlie@yachtpics.com</a> · <a href="tel:+15616029710" className="text-accent-700 underline">561-602-9710</a>
        </p>
      </LegalSection>
    </LegalShell>
  );
}
