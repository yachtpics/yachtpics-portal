export default function TermsPage() {
  const effectiveDate = "May 20, 2026";

  return (
    <div className="px-6 py-10 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Photo &amp; Video License Terms</h1>
      <p className="text-sm text-gray-400 mb-8">Effective {effectiveDate}</p>

      <div className="prose prose-sm prose-gray max-w-none space-y-8">

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">1. Copyright Ownership</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            All photographs, videos, virtual tours, and other visual media produced by YachtPics
            (&ldquo;Content&rdquo;) are and remain the exclusive intellectual property of YachtPics.
            All rights not expressly granted in these terms are reserved by YachtPics. Your payment
            for photography services does not transfer copyright ownership — it grants you a limited
            license to use the Content as described below.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">2. License Grant</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Upon full payment of the applicable service fee, YachtPics grants you a{" "}
            <strong>non-exclusive, non-transferable, royalty-free license</strong> to use the
            Content solely for the purpose of advertising the specific vessel for which the Content
            was created. This license is unlimited in duration and platform — you may use the
            Content on your website, MLS listings, social media, print materials, and any other
            advertising channel for as long as the vessel remains in your active listing inventory.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">3. Restrictions</h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            You may <strong>not</strong>, without prior written authorization from YachtPics:
          </p>
          <ul className="text-sm text-gray-600 space-y-2 list-none pl-0">
            <li className="flex items-start gap-2"><span className="text-red-400 shrink-0 mt-0.5">✕</span><span><strong>Transfer or share</strong> the Content with any other broker, brokerage, co-listing agent, or third party for their own advertising or commercial use — regardless of whether the vessel is co-listed.</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 shrink-0 mt-0.5">✕</span><span><strong>Sublicense or resell</strong> the Content to any individual, company, stock photo library, or marketing agency.</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 shrink-0 mt-0.5">✕</span><span><strong>Use the Content for a different vessel</strong> than the one it was created for, or represent it as depicting a vessel other than the one photographed.</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 shrink-0 mt-0.5">✕</span><span><strong>Remove or alter</strong> any copyright watermarks, metadata, or attribution embedded in or associated with the Content.</span></li>
            <li className="flex items-start gap-2"><span className="text-red-400 shrink-0 mt-0.5">✕</span><span><strong>Grant access</strong> to the Content to any party not employed by or working directly on behalf of your brokerage in connection with the listed vessel.</span></li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">4. Credit &amp; Attribution</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            While not required, YachtPics appreciates photo credit wherever practical (e.g.,
            &ldquo;Photos by YachtPics&rdquo;). You may not credit the Content to any other
            photographer or source.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">5. Termination</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            YachtPics reserves the right to terminate your license immediately and without notice
            if you breach any of these terms. Upon termination, you must cease all use of the
            Content and delete all copies in your possession. Termination does not entitle you to a
            refund of any service fees paid.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">6. Enforcement</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Unauthorized use of YachtPics Content may constitute copyright infringement under
            applicable law and may subject you to civil and/or criminal liability. YachtPics
            actively monitors the use of its Content and reserves the right to pursue all available
            legal remedies for unauthorized use, including injunctive relief and damages.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-2">7. Contact</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            For licensing inquiries, co-listing arrangements, or questions about these terms, please
            contact YachtPics at{" "}
            <a href="mailto:hello@yachtpics.com" className="text-[#c49a35] hover:text-[#b08c2a] underline">
              hello@yachtpics.com
            </a>.
          </p>
        </section>

      </div>

      <div className="mt-10 pt-6 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} YachtPics. All rights reserved. These terms are subject to change. Continued use of downloaded Content constitutes acceptance of the current terms.
        </p>
      </div>
    </div>
  );
}
