import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl font-semibold whitespace-nowrap " +
  "transition-colors duration-fast ease-quiet select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 " +
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  // The single loud thing a screen is allowed to have (besides the photos).
  primary: "bg-accent-500 text-ink-950 hover:bg-accent-400",
  secondary:
    "bg-white text-ink-700 border border-hairline-strong hover:border-ink-400 hover:text-ink-900",
  ghost: "text-ink-500 hover:text-ink-900 hover:bg-ink-950/[0.04]",
  danger: "bg-danger-600 text-white hover:bg-danger-500",
};

const sizes: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-2",
  md: "text-sm px-4 py-2.5",
};

/**
 * Presentational button. Disabled state only dims and blocks pointer events —
 * it never changes copy or removes the control (access gating stays visible).
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
});

export default Button;
