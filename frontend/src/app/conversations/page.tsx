"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function ConversationsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, loadUser, logout } =
    useAuthStore();

  // Load user on mount
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/auth");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/auth");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar: Conversations List */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-gray-900">Signal</h1>
          <p className="text-xs text-gray-500">
            Signed in as {user.display_name}
          </p>
        </div>

        {/* Conversations List (Placeholder) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-center text-gray-500 py-8">
            <p className="text-sm">No conversations yet</p>
            <p className="text-xs mt-1">
              Create a new conversation to get started
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 space-y-2">
          <button className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
            + New Conversation
          </button>
          <button
            onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-800 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Area: Message View */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Empty State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">💬</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              No conversation selected
            </h2>
            <p className="text-gray-600">
              Select a conversation or create a new one to start messaging
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
