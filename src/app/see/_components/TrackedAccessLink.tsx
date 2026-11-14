"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { sendSeeEvent } from "./trackVideo";

/**
 * A "Request access" link that also reports an access_click for `video`
 * (play metrics, trackVideo.ts). Navigation is unchanged.
 */
export default function TrackedAccessLink({ href, video, className, children }: { href: string; video: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => sendSeeEvent(video, "access_click")}>
      {children}
    </Link>
  );
}
