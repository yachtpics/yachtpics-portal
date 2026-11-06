import { Badge } from "@/components/ui";
import { STATUS_LABEL, type InvoiceStatus } from "@/lib/books/types";

export default function StatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="danger">{STATUS_LABEL.overdue}</Badge>;
  const tone = status === "paid" ? "success" : status === "partial" ? "warn" : status === "sent" ? "info" : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}
