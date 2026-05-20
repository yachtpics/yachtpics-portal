"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  onAccept: () => void;
  onCancel: () => void;
}

export default function DownloadLicenseModal({ onAccept, onCancel }: Props) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
        <h2 className="text-base font-bold text-gray-900 mb-1">Photo &amp; Video License Agreement</h2>
        <p className="text-sm text-gray-500 mb-4">
          All photos and videos produced and delivered by YachtPics are the intellectual property of YachtPics.
          Please review your license terms before downloading. Content you uploaded yourself is not subject to these terms.
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 space-y-2.5 text-sm text-gray-700">
          <div className="flex items-start gap-2.5">
            <span className="text-[#d4a843] mt-0.5 shrink-0">✓</span>
            <p><strong>What you&apos;re licensed to do:</strong> Use these photos and videos to advertise the specific vessel they were created for, on any platform, for as long as the vessel is listed — with no per-use fees.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-red-400 mt-0.5 shrink-0">✕</span>
            <p><strong>What is not permitted:</strong> Transferring, sharing, sublicensing, or selling these files to any other broker, brokerage, or third party for their own advertising use without a separate written license from YachtPics.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-red-400 mt-0.5 shrink-0">✕</span>
            <p><strong>Resale prohibited:</strong> These files may not be resold, redistributed, or incorporated into any stock photo library, marketing agency asset, or third-party commercial product.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-gray-400 mt-0.5 shrink-0">©</span>
            <p><strong>Copyright:</strong> All rights not expressly granted remain with YachtPics. Unauthorized use may result in license termination and legal action.</p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-[#d4a843]"
          />
          <span className="text-sm text-gray-700 leading-snug">
            I have read and agree to the YachtPics{" "}
            <Link
              href="/dashboard/terms"
              target="_blank"
              className="text-[#c49a35] underline hover:text-[#b08c2a]"
            >
              Photo &amp; Video License Terms
            </Link>
            . I understand that YachtPics-produced files are copyright of YachtPics and may not be shared with or transferred to other parties without a separate license.
          </span>
        </label>

        <p className="text-xs text-gray-400 mt-3">
          This agreement is saved to this device. You won&apos;t be asked again unless you clear your browser data.
        </p>

        <div className="flex gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onAccept}
            disabled={!checked}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-[#d4a843] hover:bg-[#c49a35] text-[#050b14] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Agree &amp; Download
          </button>
        </div>
      </div>
    </div>
  );
}
