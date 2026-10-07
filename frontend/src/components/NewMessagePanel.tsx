"use client";

import { useEffect, useRef, useState } from "react";
import { User } from "@/types/protocol";
import { conversationService } from "@/services/conversationService";
import { useMessageStore } from "@/store/messageStore";
import { Avatar } from "@/components/Avatar";

interface NewMessagePanelProps {
  onBack: () => void;
  onConversationCreated: (conversationId: number) => void;
}

/**
 * "New message" sidebar state (Signal Desktop pattern): replaces the normal
 * conversation list in place, rather than opening as a floating modal.
 * Search an existing backend user, select them, and the sidebar returns to
 * the normal conversation list with the new/found conversation selected.
 */
export function NewMessagePanel({ onBack, onConversationCreated }: NewMessagePanelProps) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      onBack();
    } catch (err) {
      setError("Failed to start conversation");
      setCreatingUserId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header: back button + title */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 p-1 -ml-1 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-semibold text-gray-900">New message</h2>
      </div>

      {/* Search input */}
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search people..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-50 flex-shrink-0">{error}</div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <p className="text-center text-sm text-gray-400 py-6">Searching...</p>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-12">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-gray-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.964 0a9 9 0 10-11.964 0m11.964 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-600">No users found</p>
            <p className="text-xs text-gray-400 mt-1">Try a different username or name</p>
          </div>
        ) : (
          results.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user)}
              disabled={creatingUserId !== null}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Avatar avatarUrl={user.avatar_url} seed={user.username} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.display_name}</p>
                <p className="text-xs text-gray-500 truncate">@{user.username}</p>
              </div>
              {creatingUserId === user.id && (
                <span className="text-xs text-gray-400 flex-shrink-0">Starting...</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
