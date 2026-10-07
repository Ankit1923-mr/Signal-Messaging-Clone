"use client";

import { Message, ReceiptStatus } from "@/types/protocol";
import { ReceiptStatusBadge } from "./ReceiptStatus";
import { useMessageReadObserver } from "@/hooks/useMessageReadObserver";
import { useAuthStore } from "@/store/authStore";

interface MessageItemProps {
  message: Message;
  conversationId: number;
}

/**
 * Single message item with read observer
 * Handles its own read receipt tracking
 */
export function MessageItem({ message, conversationId }: MessageItemProps) {
  const user = useAuthStore((state) => state.user);
  const readObserverRef = useMessageReadObserver(message.id, conversationId);

  const isSent = message.sender_id === user?.id;
  const isOptimistic = message.id === 0;

  return (
    <div
      ref={readObserverRef}
      className={`flex ${isSent ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-xs px-4 py-2 rounded-lg ${
          isSent
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-900 shadow-sm"
        } ${isOptimistic ? "opacity-75" : ""}`}
      >
        {/* Message content */}
        <p className="break-words text-sm">{message.content}</p>

        {/* Timestamp and receipt status */}
        <div
          className={`flex items-center gap-1 mt-1 text-xs ${
            isSent ? "text-blue-200" : "text-gray-500"
          }`}
        >
          <span>{formatTime(message.created_at)}</span>

          {/* Receipt status (for sent messages) */}
          {isSent && (
            <ReceiptStatusBadge
              status={message.status}
              deliveredAt={message.delivered_at}
              readAt={message.read_at}
            />
          )}

          {/* Optimistic indicator */}
          {isOptimistic && <span>●</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Format ISO timestamp to HH:MM
 */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}
