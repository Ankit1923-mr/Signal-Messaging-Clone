"use client";

import { useState, useRef } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

interface MessageInputProps {
  conversationId: number;
  disabled?: boolean;
}

const MAX_MESSAGE_LENGTH = 4000;

export function MessageInput({ conversationId, disabled }: MessageInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isConnected, sendTyping } = useWebSocket();

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;

    if (value.length > MAX_MESSAGE_LENGTH) {
      setError(
        `Message exceeds ${MAX_MESSAGE_LENGTH} character limit (${value.length}/${MAX_MESSAGE_LENGTH})`
      );
      return;
    }

    setError(null);
    setText(value);

    // Send typing indicator (debounced by useWebSocket)
    if (value.length > 0) {
      sendTyping(conversationId, true);
    } else {
      sendTyping(conversationId, false);
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();

    if (!trimmed) {
      setError("Message cannot be empty");
      return;
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setError(`Message exceeds ${MAX_MESSAGE_LENGTH} character limit`);
      return;
    }

    if (!isConnected) {
      setError("Not connected to server");
      return;
    }

    try {
      setError(null);
      await sendMessage(conversationId, trimmed);
      setText("");
      sendTyping(conversationId, false);

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to send message";
      setError(errorMsg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (unless Shift+Enter for newline)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // Auto-grow textarea
    if (e.key === "Enter") {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(
            textareaRef.current.scrollHeight,
            200 // Max height 200px
          ) + "px";
        }
      }, 0);
    }
  };

  const isDisabled = disabled || !isConnected;
  const charCount = text.length;
  const charPercentage = (charCount / MAX_MESSAGE_LENGTH) * 100;
  const isNearLimit = charPercentage > 80;

  return (
    <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4 space-y-2">
      {/* Error message */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-3">
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Shift+Enter for newline)"
          disabled={isDisabled}
          rows={1}
          className="flex-1 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
          style={{
            maxHeight: "200px",
            overflowY: charCount > 100 ? "auto" : "hidden",
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={isDisabled || !text.trim()}
          className="bg-blue-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors self-end"
        >
          Send
        </button>
      </div>

      {/* Character counter */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <div>
          {charCount} / {MAX_MESSAGE_LENGTH}
        </div>

        {/* Character limit progress bar */}
        <div className="w-32 h-1 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-colors ${
              isNearLimit ? "bg-red-500" : "bg-blue-500"
            }`}
            style={{ width: `${Math.min(charPercentage, 100)}%` }}
          />
        </div>
      </div>

      {/* Connection status */}
      {!isConnected && (
        <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
          ⚠️ Reconnecting...
        </div>
      )}
    </div>
  );
}
