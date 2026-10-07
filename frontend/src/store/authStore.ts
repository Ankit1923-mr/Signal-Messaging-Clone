/**
 * Authentication Store (Zustand)
 *
 * Manages auth state on the client side:
 * - Current user info
 * - Loading/error states
 * - Two-step registration (register -> OTP verify) / login / logout
 *
 * Backend handles session via httpOnly cookies. This store never holds the
 * JWT — only non-sensitive UI state (user profile, pending verification).
 */

import { create } from "zustand";
import {
  authService,
  User,
  RegisterRequest,
  LoginRequest,
  AuthError,
  AuthErrorCode,
} from "@/services/authService";

interface PendingVerification {
  user_id: number;
  username: string;
  display_name: string;
}

interface AuthStore {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  errorCode: AuthErrorCode | null;
  pendingVerification: PendingVerification | null;

  // Actions
  register: (data: RegisterRequest) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  cancelVerification: () => void;
}

function persistUser(user: User) {
  localStorage.setItem("user", JSON.stringify(user));
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  errorCode: null,
  pendingVerification: null,

  // Step 1 of registration: create the (unverified) account.
  // Does NOT authenticate — backend issues no cookies until OTP succeeds.
  register: async (data: RegisterRequest) => {
    set({ isLoading: true, error: null, errorCode: null });
    try {
      const response = await authService.register(data);
      set({
        isLoading: false,
        pendingVerification: {
          user_id: response.user_id,
          username: response.username,
          display_name: response.display_name,
        },
      });
    } catch (err) {
      const authErr = err as AuthError;
      set({ isLoading: false, error: authErr.message, errorCode: authErr.code });
      throw err;
    }
  },

  // Step 2 of registration: verify the mock OTP (123456 in development).
  // On success, the account becomes verified and authenticated (cookies set).
  verifyOtp: async (otp: string) => {
    const pending = get().pendingVerification;
    if (!pending) {
      set({ error: "No pending registration to verify.", errorCode: "UNKNOWN" });
      return;
    }

    set({ isLoading: true, error: null, errorCode: null });
    try {
      const response = await authService.verifyOtp({ user_id: pending.user_id, otp });

      const user: User = {
        id: response.user_id,
        username: response.username,
        display_name: response.display_name,
      };
      persistUser(user);

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        pendingVerification: null,
      });
    } catch (err) {
      const authErr = err as AuthError;
      set({ isLoading: false, error: authErr.message, errorCode: authErr.code });
      throw err;
    }
  },

  // Abandon the pending OTP step and return to the login/register chooser.
  cancelVerification: () => set({ pendingVerification: null, error: null, errorCode: null }),

  // Login
  login: async (data: LoginRequest) => {
    set({ isLoading: true, error: null, errorCode: null });
    try {
      // Step 1: Get CSRF token
      const { csrf_token } = await authService.getCSRFToken();

      // Step 2: Login with CSRF token
      const response = await authService.login(data, csrf_token);

      // Step 3: Build user object from response and persist (profile only, not the JWT)
      const user: User = {
        id: response.user_id,
        username: response.username,
        display_name: response.display_name,
      };
      persistUser(user);

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      const authErr = err as AuthError;
      set({ isLoading: false, error: authErr.message, errorCode: authErr.code, isAuthenticated: false });
      throw err;
    }
  },

  // Logout
  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await authService.logout();
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
  clearError: () => set({ error: null, errorCode: null }),
}));
