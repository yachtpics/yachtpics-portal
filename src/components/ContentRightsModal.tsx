"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface Props {
  onAccept: () => void;
  onCancel: () => void;
}

export default function ContentRightsModal({ onAccept, onCancel }: Props) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 px-4">
      <div className="bg-white rounded-surface shadow-elev-3 max-w-lg w-full p-6">
        <p className="label-caps mb-1">Content rights</p>
        <h2 className="text-h2 text-ink-900 mb-1">Before you upload</h2>
        <p className="text-sm text-ink-500 mb-4">
          Please review the following before uploading files to YachtPics Portal.
        </p>

        <div className="bg-ink-50 border border-hairline rounded-card p-4 mb-4 space-y-2.5 text-sm text-ink-700">
          <div className="flex items-start gap-2.5">
            <span className="text-ink-400 mt-0.5 shrink-0">©</span>
            <p><strong>YachtPics-produced content:</strong> All photos and videos shot by YachtPics remain the intellectual property of YachtPics. You may use them to advertise the specific vessel under your YachtPics license, but may not share or transfer them to third parties without a separate license.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-ink-400 mt-0.5 shrink-0">↑</span>
            <p><strong>Content you upload yourself:</strong> For any files you upload that were not produced by YachtPics, you confirm that you own the copyright or have obtained the necessary rights to upload, store, and share that content. YachtPics claims no ownership over files you upload and accepts no liability for any third-party copyright claims arising from content you provide.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-danger-500 mt-0.5 shrink-0">✕</span>
            <p><strong>No unlicensed content:</strong> Do not upload content that you do not own or have explicit permission to use. You assume full responsibility for any uploaded content and any claims that may arise from it.</p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          />
          <span className="text-sm text-ink-700 leading-snug">
            I confirm that I own or have the right to upload all files I provide, and I understand
            that YachtPics is not responsible for any copyright claims arising from content I upload.
          </span>
        </label>

        <p className="text-xs text-ink-500 mt-3">
          This confirmation is saved to this device and won&apos;t appear again unless you clear your browser data.
        </p>

        <div className="flex gap-3 mt-5">
          <Button variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={onAccept} disabled={!checked} className="flex-1">
            Continue uploading
          </Button>
        </div>
      </div>
    </div>
  );
}
