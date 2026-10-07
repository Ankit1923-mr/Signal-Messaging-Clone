"use client";

import { useEffect, useRef } from "react";
import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { Message, ReceiptStatus } from "@/types/protocol";
import { ReceiptStatusBadge } from "./ReceiptStatus";
import { useMessageReadObserver } from "@/hooks/useMessageReadObserver";

interface MessageListProps {
  conversationId: number;
}

export function MessageList({ conversationId }: MessageListProps) {
  const messages = useMessageStore((state) =>
    state.getMessages(conversationId)
  );
  const user = useAuthStore((state) => state.user);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!user) {
    return <div className="flex-1 flex items-center justify-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p>No messages yet. Start the conversation!</p>
        </div>
      ) : (
        <>
          {messages.map((message) => {
            const isSent = message.sender_id === user.id;
            const isOptimistic = message.id === 0;
            // Use read observer for incoming messages
            const readObserverRef = useMessageReadObserver(
              message.id,
              conversationId
            );

            return (
              <div
                key={`${message.id}-${message.client_id}`}
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
          })}
          <div ref={messagesEndRef} />
        </>
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
