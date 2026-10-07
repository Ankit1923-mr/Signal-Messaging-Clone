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
  /** The reply target's sender profile, when known — for the quoted preview's name. */
  replySender?: User;
  /** True when this is the first message of a consecutive same-sender run
   * (or the only message so far) — controls whether the avatar/sender name
   * are shown, so a burst of messages from one person doesn't repeat them. */
  isFirstInRun?: boolean;
  /** True for group conversations — only groups show a per-message sender name. */
  isGroup?: boolean;
  /** Called with this message when the user clicks the hover "Reply" action. */
  onReply?: (message: Message) => void;
  /** Called with the original message's id when the quoted preview is clicked. */
  onJumpToReply?: (messageId: number) => void;
}

/**
 * Single message item with read observer
 * Handles its own read receipt tracking
 */
export function MessageItem({
  message,
  conversationId,
  sender,
  replySender,
  isFirstInRun = true,
  isGroup = false,
  onReply,
  onJumpToReply,
}: MessageItemProps) {
  const user = useAuthStore((state) => state.user);
  const readObserverRef = useMessageReadObserver(message.id, conversationId);

  const isSent = message.sender_id === user?.id;
  const isOptimistic = message.id === 0;
  const showAvatar = !isSent && isFirstInRun;
  const showSenderName = isGroup && !isSent && isFirstInRun;

  return (
    <div
      ref={readObserverRef}
      className={`group flex items-end gap-2 ${isSent ? "justify-end" : "justify-start"}`}
    >
      {/* Incoming: sender's avatar on the left — only on the first message of
          a consecutive run, to avoid repeating it for every message. A
          same-sized spacer keeps later messages in the run aligned with it. */}
      {!isSent && (
        showAvatar ? (
          <Avatar
            avatarUrl={sender?.avatar_url}
            seed={sender?.username || String(message.sender_id)}
            size={28}
          />
        ) : (
          <div className="w-7 flex-shrink-0" aria-hidden="true" />
        )
      )}

      <div className="relative max-w-[70%]">
        {/* Hover action: Reply. Only meaningful for a persisted message
            (optimistic/pending ones have no id the server would recognize
            as a reply target yet). */}
        {onReply && !isOptimistic && (
          <button
            onClick={() => onReply(message)}
            className={`absolute top-0 ${
              isSent ? "-left-8" : "-right-8"
            } opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800`}
            aria-label="Reply"
            title="Reply"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17L4 12m0 0l5-5m-5 5h11a4 4 0 010 8h-1" />
            </svg>
          </button>
        )}

        <div
          className={`px-4 py-2 rounded-lg ${
            isSent
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
          } ${isOptimistic ? "opacity-75" : ""}`}
        >
          {/* Group sender name — only the first message of a consecutive run,
              only for received messages in a group conversation. */}
          {showSenderName && (
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-0.5">
              {sender?.display_name || sender?.username || "Unknown"}
            </p>
          )}

          {/* Quoted reply preview — clicking it scrolls to/highlights the
              original message (no-op if it's not currently in this list). */}
          {message.reply_to_message_id !== undefined && message.reply_to_message_id !== null && (
            <button
              onClick={() => onJumpToReply?.(message.reply_to_message_id!)}
              className={`block w-full text-left mb-1.5 px-2 py-1 rounded border-l-2 text-xs ${
                isSent
                  ? "border-blue-300 bg-blue-500/30"
                  : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900"
              }`}
            >
              {message.reply_to_deleted ? (
                <span className={isSent ? "text-blue-100 italic" : "text-gray-400 italic"}>
                  Original message unavailable
                </span>
              ) : (
                <>
                  <span className={`block font-semibold ${isSent ? "text-blue-100" : "text-blue-600 dark:text-blue-400"}`}>
                    {replySender?.display_name || replySender?.username || "Unknown"}
                  </span>
                  <span className={`block truncate ${isSent ? "text-blue-100" : "text-gray-600 dark:text-gray-300"}`}>
                    {message.reply_to_content}
                  </span>
                </>
              )}
            </button>
          )}

          {/* Message content */}
          <p className="break-words text-sm">{message.content}</p>

        {/* Timestamp and receipt status */}
        <div
          className={`flex items-center gap-1 mt-1 text-xs ${
            isSent ? "text-blue-200" : "text-gray-500 dark:text-gray-400"
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
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}
