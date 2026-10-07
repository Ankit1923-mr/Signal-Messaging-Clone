/**
 * Authentication Store (Zustand)
 *
 * Manages auth state on the client side:
 * - Current user info
 * - Loading/error states
 * - Login/logout/register actions
 *
 * Backend handles session via cookies.
 * Store handles UI state only.
 */

import { create } from "zustand";
import { authService, User, RegisterRequest, LoginRequest } from "@/services/authService";

interface AuthStore {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  register: (data: RegisterRequest) => Promise<void>;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  // Register new user
  register: async (data: RegisterRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authService.register(data);
      // After register, user still needs to login
      // Don't auto-login
      set({ isLoading: false });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Registration failed";
      set({ isLoading: false, error });
      throw err;
    }
  },

  // Login
  login: async (data: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      // Step 1: Get CSRF token
      const { csrf_token } = await authService.getCSRFToken();

      // Step 2: Login with CSRF token
      const response = await authService.login(data, csrf_token);

      // Step 3: Build user object from response
      const user: User = {
        id: response.user_id,
        username: response.username,
        display_name: response.display_name,
      };

      // Step 4: Store user in localStorage for persistence across refreshes
      localStorage.setItem("user", JSON.stringify(user));

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Login failed";
      set({ isLoading: false, error, isAuthenticated: false });
      throw err;
    }
  },

  // Logout
  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await authService.logout();
      // Clear localStorage
      localStorage.removeItem("user");
      set({ user: null, isAuthenticated: false, isLoading: false });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Logout failed";
      set({ isLoading: false, error });
      throw err;
    }
  },

  // Load current user (on app init)
  loadUser: async () => {
    set({ isLoading: true });
    try {
      // Step 1: Try to restore user from localStorage
      const stored = localStorage.getItem("user");
      if (!stored) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }

      const storedUser: User = JSON.parse(stored);

      // Step 2: Validate session by trying to refresh
      // This tests if the httpOnly cookies are still valid
      try {
        await authService.refresh();
        // Refresh succeeded, session is valid
        set({
          user: storedUser,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        // Refresh failed, session expired or invalid
        localStorage.removeItem("user");
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (err) {
      localStorage.removeItem("user");
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  // Clear error
  clearError: () => set({ error: null }),
}));
