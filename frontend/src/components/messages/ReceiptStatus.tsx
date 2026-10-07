"use client";

import { ReceiptStatus } from "@/types/protocol";

interface ReceiptStatusProps {
  status: ReceiptStatus;
  deliveredAt?: string;
  readAt?: string;
}

/**
 * Receipt Status Badge
 *
 * Shows:
 * - pending: ● (one dot)
 * - delivered: ✓ (check mark)
 * - read: ✓✓ (double check mark)
 *
 * Tooltip shows timestamp if available.
 */
export function ReceiptStatusBadge({
  status,
  deliveredAt,
  readAt,
}: ReceiptStatusProps) {
  let icon = "";
  let label = "";
  let timestamp = "";

  switch (status) {
    case "pending":
      icon = "●";
      label = "Pending";
      break;
    case "delivered":
      icon = "✓";
      label = "Delivered";
      timestamp = deliveredAt
        ? new Date(deliveredAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "";
      break;
    case "read":
      icon = "✓✓";
      label = "Read";
      timestamp = readAt
        ? new Date(readAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "";
      break;
  }

  return (
    <span title={`${label}${timestamp ? ` at ${timestamp}` : ""}`}>
      {icon}
    </span>
  );
}
