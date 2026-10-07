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
  avatar_url?: string;
}

/**
 * Local cache mapping username -> avatar_url.
 *
 * The backend's login/verify-otp responses only return {user_id, username,
 * display_name} — not avatar_url — even though it's persisted server-side.
 * Rather than changing that API contract, we remember the avatar chosen at
 * registration time in localStorage (frontend-only, no backend change) so a
 * later login on the same browser can still show the right avatar.
 */
const AVATAR_CACHE_KEY = "avatarCache";

function cacheAvatar(username: string, avatarUrl?: string) {
  if (!avatarUrl) return;
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[username] = avatarUrl;
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Non-critical; avatar just falls back to a seed-derived default.
  }
}

function getCachedAvatar(username: string): string | undefined {
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw)[username];
  } catch {
    return undefined;
  }
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
      cacheAvatar(response.username, data.avatar_url);
      set({
        isLoading: false,
        pendingVerification: {
          user_id: response.user_id,
          username: response.username,
          display_name: response.display_name,
          avatar_url: data.avatar_url,
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
        avatar_url: pending.avatar_url,
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
      // avatar_url isn't in the login response, so fall back to our local cache (see cacheAvatar).
      const user: User = {
        id: response.user_id,
        username: response.username,
        display_name: response.display_name,
        avatar_url: getCachedAvatar(response.username),
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

  // Logout. Always clears local auth state and never throws, even if the
  // backend call fails (network error, server down, etc.) — the user must
  // never be stuck "logged in" client-side just because the revoke request
  // didn't reach the server.
  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await authService.logout();
    } catch (err) {
      // Best-effort: if this fails, the refresh_token row simply isn't
      // revoked server-side yet. Local state is cleared below regardless.
      console.error("Logout request to backend failed:", err);
    }
    localStorage.removeItem("user");
    set({ user: null, isAuthenticated: false, isLoading: false, error: null });
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
