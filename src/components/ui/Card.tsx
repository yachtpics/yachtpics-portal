import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Quiet surface: white, hairline border, layered low-blur shadow.
 * Surfaces recede so the photography stays the loudest thing on screen.
 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("bg-white rounded-card border border-hairline shadow-elev-1", className)}
      {...rest}
    />
  );
}

/** Header row with an optional wide-tracked kicker and right-aligned action. */
export function CardHeader({
  title,
  kicker,
  description,
  action,
  className,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-6 py-4 border-b border-hairline", className)}>
      <div className="min-w-0">
        {kicker && <p className="label-caps mb-1">{kicker}</p>}
        <h2 className="text-h2 text-ink-900">{title}</h2>
        {description && <p className="text-small text-ink-500 mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-6 py-5", className)} {...rest} />;
}
