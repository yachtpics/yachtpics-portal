import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "success" | "info" | "warn" | "danger" | "accent";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-600 border-hairline",
  success: "bg-success-50 text-success-700 border-success-200",
  info: "bg-info-50 text-info-700 border-info-200",
  warn: "bg-warn-50 text-warn-700 border-warn-200",
  danger: "bg-danger-50 text-danger-700 border-danger-200",
  accent: "bg-accent-50 text-accent-700 border-accent-200",
};

export default function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        tones[tone],
        className
      )}
      {...rest}
    />
  );
}
