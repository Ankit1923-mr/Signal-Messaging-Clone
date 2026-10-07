"use client";

import { useEffect, useRef, useState } from "react";
import { User } from "@/types/protocol";
import { conversationService } from "@/services/conversationService";
import { useMessageStore } from "@/store/messageStore";
import { Avatar } from "@/components/Avatar";

interface NewConversationModalProps {
  onClose: () => void;
  onConversationCreated: (conversationId: number) => void;
}

/** Signal-like "start a new conversation" dialog: search a user, select, done. */
export function NewConversationModal({ onClose, onConversationCreated }: NewConversationModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [creatingUserId, setCreatingUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const addConversation = useMessageStore((state) => state.addConversation);

  // Load a default short list immediately, then re-search as the user types (debounced).
  useEffect(() => {
    runSearch("");
  }, []);

  const runSearch = async (q: string) => {
    setSearching(true);
    setError(null);
    try {
      const users = await conversationService.searchUsers(q);
      setResults(users);
    } catch (err) {
      setError("Failed to search users");
    } finally {
      setSearching(false);
    }
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const handleSelectUser = async (user: User) => {
    setCreatingUserId(user.id);
    setError(null);
    try {
      const conversation = await conversationService.createDirectConversation(user.id);
      addConversation(conversation);
      onConversationCreated(conversation.id);
      onClose();
    } catch (err) {
      setError("Failed to start conversation");
      setCreatingUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">New Conversation</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="p-3 border-b border-gray-200">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search by username or name..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 text-xs text-red-600 bg-red-50">{error}</div>
        )}

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {searching ? (
            <p className="text-center text-sm text-gray-400 py-6">Searching...</p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No users found</p>
          ) : (
            results.map((user) => (
              <button
                key={user.id}
                onClick={() => handleSelectUser(user)}
                disabled={creatingUserId !== null}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Avatar avatarUrl={user.avatar_url} seed={user.username} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.display_name}</p>
                  <p className="text-xs text-gray-500 truncate">@{user.username}</p>
                </div>
                {creatingUserId === user.id && (
                  <span className="text-xs text-gray-400">Starting...</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
