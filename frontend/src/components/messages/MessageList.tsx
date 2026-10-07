"use client";

import { useEffect, useRef } from "react";
import { useMessageStore } from "@/store/messageStore";
import { useAuthStore } from "@/store/authStore";
import { MessageItem } from "./MessageItem";

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
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p>No messages yet. Start the conversation!</p>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <MessageItem
              key={`${message.id}-${message.client_id}`}
              message={message}
              conversationId={conversationId}
            />
          ))}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}
