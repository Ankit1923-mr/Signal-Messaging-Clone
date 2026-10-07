"use client";

import { ReceiptStatus } from "@/types/protocol";

interface ReceiptStatusProps {
  /** Backend receipt status: pending | delivered | read. Reused as-is, no new states added. */
  status: ReceiptStatus;
  deliveredAt?: string;
  readAt?: string;
  /**
   * True while the message is a client-side optimistic entry that hasn't
   * been ACKed by the server yet (message.id === 0). Distinct from the
   * backend's "pending" receipt status, which means "ACKed/persisted but
   * not yet delivered to the recipient" (Signal's single-check "sent").
   */
  isOptimistic?: boolean;
}

/**
 * Receipt Status Badge (Signal-like)
 *
 * Visual states, all derived from the existing pending/delivered/read
 * backend data — no new receipt state was added:
 * - optimistic (not yet ACKed): small clock/dot — "sending"
 * - status "pending" (ACKed, not yet delivered): single check — "sent"
 * - status "delivered": double check, muted — matches delivered, not read
 * - status "read": double check, bright blue — ONLY when actually read
 */
export function ReceiptStatusBadge({
  status,
  deliveredAt,
  readAt,
  isOptimistic,
}: ReceiptStatusProps) {
  if (isOptimistic) {
    return (
      <span title="Sending..." className="text-blue-200">
        ○
      </span>
    );
  }

  if (status === "read") {
    const timestamp = readAt
      ? new Date(readAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "";
    return (
      <span title={`Read${timestamp ? ` at ${timestamp}` : ""}`} className="text-sky-300 font-semibold">
        ✓✓
      </span>
    );
  }

  if (status === "delivered") {
    const timestamp = deliveredAt
      ? new Date(deliveredAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "";
    return (
      <span title={`Delivered${timestamp ? ` at ${timestamp}` : ""}`} className="text-blue-200">
        ✓✓
      </span>
    );
  }

  // status === "pending" (ACKed/persisted, not yet delivered) -> "sent"
  return (
    <span title="Sent" className="text-blue-200">
      ✓
    </span>
  );
}
