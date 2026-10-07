"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      router.replace("/conversations");
    } else {
      router.replace("/auth");
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <p className="text-gray-600 text-lg">Loading...</p>
      </div>
    </div>
  );
}
