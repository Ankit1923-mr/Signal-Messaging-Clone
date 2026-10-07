"use client";

import { Message, User } from "@/types/protocol";
import { ReceiptStatusBadge } from "./ReceiptStatus";
import { useMessageReadObserver } from "@/hooks/useMessageReadObserver";
import { useAuthStore } from "@/store/authStore";
import { Avatar } from "@/components/Avatar";

interface MessageItemProps {
  message: Message;
  conversationId: number;
  /** The message sender's profile, when known (used for the received-message avatar). */
  sender?: User;
}

/**
 * Single message item with read observer
 * Handles its own read receipt tracking
 */
export function MessageItem({ message, conversationId, sender }: MessageItemProps) {
  const user = useAuthStore((state) => state.user);
  const readObserverRef = useMessageReadObserver(message.id, conversationId);

  const isSent = message.sender_id === user?.id;
  const isOptimistic = message.id === 0;

  return (
    <div
      ref={readObserverRef}
      className={`flex items-end gap-2 ${isSent ? "justify-end" : "justify-start"}`}
    >
      {/* Incoming: sender's avatar on the left */}
      {!isSent && (
        <Avatar
          avatarUrl={sender?.avatar_url}
          seed={sender?.username || String(message.sender_id)}
          size={28}
        />
      )}

      <div
        className={`max-w-[70%] px-4 py-2 rounded-lg ${
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

          {/* Receipt status — outgoing messages only. Incoming messages never
              show the current user's own receipt ticks. */}
          {isSent && (
            <ReceiptStatusBadge
              status={message.status}
              deliveredAt={message.delivered_at}
              readAt={message.read_at}
              isOptimistic={isOptimistic}
            />
          )}
        </div>
      </div>

      {/* Outgoing: current user's own avatar on the right */}
      {isSent && (
        <Avatar avatarUrl={user?.avatar_url} seed={user?.username || "me"} size={28} />
      )}
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
