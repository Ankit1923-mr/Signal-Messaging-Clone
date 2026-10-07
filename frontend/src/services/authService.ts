/**
 * Authentication Service
 *
 * Integrates with Component 2 backend (app/routes/auth.py).
 * Handles registration, login, refresh, logout via REST API.
 *
 * Cookie-based auth: browser sends cookies automatically.
 * Don't manually store JWT in localStorage.
 */

import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Send cookies with requests
});

// ============================================================================
// TYPES
// ============================================================================

export interface RegisterRequest {
  identifier: string; // email, phone, or username
  password: string; // 8+ characters
  display_name: string;
  avatar_url?: string; // e.g. "/avatars/avatar-3.png"
}

export interface LoginRequest {
  username: string; // username, email, or phone
  password: string;
}

export interface VerifyOtpRequest {
  user_id: number;
  otp: string; // 6-digit mock OTP (123456 in development)
}

/**
 * Structured auth error, parsed from the backend's HTTPException detail.
 * code distinguishes the scenarios the UI needs to react to differently.
 */
export type AuthErrorCode =
  | "ACCOUNT_NOT_FOUND" // 404 — login identifier doesn't exist
  | "WRONG_CREDENTIALS" // 401 — login password is wrong
  | "NOT_VERIFIED" // 403 — login before OTP verification
  | "ACCOUNT_EXISTS" // 409 — register with existing identifier
  | "INVALID_OTP" // 401 — wrong OTP code
  | "ALREADY_VERIFIED" // 400 — OTP re-verification
  | "UNKNOWN";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

function parseAuthError(error: any): AuthError {
  const status = error?.response?.status;
  const detail: string = error?.response?.data?.detail || "Something went wrong. Please try again.";

  if (status === 404) return { code: "ACCOUNT_NOT_FOUND", message: detail };
  if (status === 403) return { code: "NOT_VERIFIED", message: detail };
  if (status === 409) return { code: "ACCOUNT_EXISTS", message: detail };
  if (status === 401 && detail.toLowerCase().includes("otp")) {
    return { code: "INVALID_OTP", message: detail };
  }
  if (status === 401) return { code: "WRONG_CREDENTIALS", message: detail };
  if (status === 400 && detail.toLowerCase().includes("already verified")) {
    return { code: "ALREADY_VERIFIED", message: detail };
  }
  return { code: "UNKNOWN", message: detail };
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  phone_number?: string;
  avatar_url?: string;
}

export interface AuthResponse {
  user_id: number;
  username: string;
  display_name: string;
}

// ============================================================================
// API CALLS
// ============================================================================

export const authService = {
  /**
   * Register new user with Component 2.
   *
   * identifier can be:
   * - Email: user@example.com
   * - Phone: +1234567890
   * - Username: myusername
   */
  async register(data: RegisterRequest) {
    try {
      const response = await apiClient.post<AuthResponse>("/auth/register", {
        identifier: data.identifier,
        password: data.password,
        display_name: data.display_name,
        avatar_url: data.avatar_url,
      });
      return response.data;
    } catch (error) {
      throw parseAuthError(error);
    }
  },

  /**
   * Verify OTP to complete registration.
   *
   * Mock OTP in development: 123456
   * On success, the backend issues access_token/refresh_token httpOnly cookies
   * (same as login) — the account becomes is_verified=True and authenticated.
   */
  async verifyOtp(data: VerifyOtpRequest) {
    try {
      const response = await apiClient.post<AuthResponse>("/auth/verify-otp", data);
      return response.data;
    } catch (error) {
      throw parseAuthError(error);
    }
  },

  /**
   * Get CSRF token for login (unauthenticated).
   *
   * Step 1 of login flow: get CSRF token from /auth/csrf
   * Step 2: send username + CSRF token to /auth/login
   */
  async getCSRFToken(): Promise<{ csrf_token: string }> {
    const response = await apiClient.get<{ csrf_token: string }>("/auth/csrf");
    return response.data;
  },

  /**
   * Login user with Component 2.
   *
   * Flow:
   * 1. GET /auth/csrf → get csrf_token
   * 2. POST /auth/login with csrf_token in header
   * 3. Browser receives access_token + refresh_token cookies
   * 4. Subsequent requests auto-send cookies
   */
  async login(data: LoginRequest, csrfToken: string) {
    try {
      const response = await apiClient.post<AuthResponse>("/auth/login", data, {
        headers: {
          "X-CSRF-Token": csrfToken,
        },
      });
      return response.data;
    } catch (error) {
      throw parseAuthError(error);
    }
  },

  /**
   * Refresh access token when expired.
   *
   * Cookie-based: browser sends refresh_token cookie automatically.
   * Don't call manually; let the app handle token expiry.
   */
  async refresh() {
    const response = await apiClient.post<{ status: string }>("/auth/refresh");
    return response.data;
  },

  /**
   * Logout: revoke refresh token + clear cookies.
   *
   * Browser handles cookie clearing.
   */
  async logout() {
    const response = await apiClient.post<{ status: string }>("/auth/logout");
    return response.data;
  },

  /**
   * Check if currently authenticated by testing a protected endpoint.
   *
   * Returns user info if authenticated, null otherwise.
   * Uses refresh endpoint to validate session without making a separate call.
   */
  async checkAuthentication(): Promise<User | null> {
    try {
      // Try to refresh — if it succeeds, we're authenticated
      // If it fails, user needs to login
      await apiClient.post<{ status: string }>("/auth/refresh");
      // Refresh succeeded, but we don't have user info
      // Return null — component should rely on stored state or login response
      return null;
    } catch (error) {
      // Not authenticated
      return null;
    }
  },
};

// ============================================================================
// HTTP INTERCEPTORS
// ============================================================================

// Endpoints where a 401 means "wrong credentials" / "wrong OTP", not "expired
// access token" — the refresh-and-retry behavior below must not fire for these,
// or a wrong-password/wrong-OTP attempt would silently redirect to /auth instead
// of showing the error on the current screen.
const AUTH_ENDPOINTS = ["/auth/login", "/auth/verify-otp", "/auth/register", "/auth/csrf", "/auth/refresh"];

function isAuthEndpoint(url?: string): boolean {
  return !!url && AUTH_ENDPOINTS.some((path) => url.includes(path));
}

// Redirect to login if an access token expires on a non-auth request.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !isAuthEndpoint(error.config?.url)) {
      // Access token expired
      try {
        // Try to refresh
        await authService.refresh();
        // Retry original request
        return apiClient.request(error.config);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        window.location.href = "/auth";
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);
