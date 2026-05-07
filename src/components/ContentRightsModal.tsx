"use client";

import { useState } from "react";

interface Props {
  onAccept: () => void;
  onCancel: () => void;
}

export default function ContentRightsModal({ onAccept, onCancel }: Props) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-base font-bold text-gray-900 mb-1">Before you upload</h2>
        <p className="text-sm text-gray-500 mb-5">
          To keep everyone protected, please confirm that you have the right to use the files you&apos;re uploading.
        </p>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-[#d4a843]"
          />
          <span className="text-sm text-gray-700 leading-snug">
            I confirm that I own these files or have obtained permission from the copyright holder
            to upload and share them through YachtPics Portal.
          </span>
        </label>
        <p className="text-xs text-gray-400 mt-4">
          This confirmation is saved so you won&apos;t see it again on this device.
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
            Continue uploading
          </button>
        </div>
      </div>
    </div>
  );
}
