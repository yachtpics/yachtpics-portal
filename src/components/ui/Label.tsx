import type { LabelHTMLAttributes } from "react";
import { cx } from "./cx";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** "light" for white surfaces, "dark" for ink surfaces. */
  tone?: "light" | "dark";
}

/**
 * Wide-tracked small-caps form/section label — the logo's
 * "Y A C H T   P H O T O G R A P H Y" treatment as a component.
 */
export default function Label({ tone = "light", className, ...rest }: LabelProps) {
  return (
    <label
      className={cx("block", tone === "dark" ? "label-caps-inverse" : "label-caps", className)}
      {...rest}
    />
  );
}
