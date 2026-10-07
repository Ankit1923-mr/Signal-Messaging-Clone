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
}

export interface LoginRequest {
  username: string; // username, email, or phone
  password: string;
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
    const response = await apiClient.post<AuthResponse>("/auth/register", {
      identifier: data.identifier,
      password: data.password,
      display_name: data.display_name,
    });
    return response.data;
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
    const response = await apiClient.post<AuthResponse>("/auth/login", data, {
      headers: {
        "X-CSRF-Token": csrfToken,
      },
    });
    return response.data;
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

// Optional: Add response interceptor to handle 401 (token expired)
// Redirect to login if access token expired
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
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
