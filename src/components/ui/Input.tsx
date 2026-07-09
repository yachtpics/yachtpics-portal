import { forwardRef, type InputHTMLAttributes } from "react";
import { cx } from "./cx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** "light" for white surfaces, "dark" for ink surfaces (e.g. login). */
  tone?: "light" | "dark";
}

const base =
  "w-full rounded-ctl px-4 py-2.5 text-sm transition-colors duration-fast ease-quiet " +
  "focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

const tones = {
  light:
    "bg-white border border-hairline-strong text-ink-900 placeholder:text-ink-400 " +
    "focus:border-accent-500 focus:ring-1 focus:ring-accent-500/40",
  dark:
    "bg-white/[0.04] border border-hairline-inverse text-white placeholder:text-ink-500 " +
    "focus:border-accent-400 focus:ring-1 focus:ring-accent-400/40",
} as const;

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { tone = "light", className, ...rest },
  ref
) {
  return <input ref={ref} className={cx(base, tones[tone], className)} {...rest} />;
});

export default Input;
