"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

const AVATAR_OPTIONS = ["👨", "👩", "🧑", "🧔", "👨‍💻", "👩‍💻"];

type Mode = "login" | "register";

export default function AuthPage() {
  const router = useRouter();
  const {
    login,
    register,
    verifyOtp,
    cancelVerification,
    pendingVerification,
    error,
    errorCode,
    isLoading,
    clearError,
  } = useAuthStore();

  const [mode, setMode] = useState<Mode>("login");
  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
    displayName: "",
  });
  const [avatar, setAvatar] = useState(AVATAR_OPTIONS[0]);
  const [otp, setOtp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    clearError();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.identifier || !formData.password) {
      setFormError("Email, phone, or username and password are required");
      return;
    }

    try {
      await login({ username: formData.identifier, password: formData.password });
      router.push("/conversations");
    } catch {
      // error / errorCode are set by the store; rendered below
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.identifier || !formData.password || !formData.displayName) {
      setFormError("All fields are required");
      return;
    }

    if (formData.password.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }

    try {
      await register({
        identifier: formData.identifier,
        password: formData.password,
        display_name: formData.displayName,
        avatar_url: avatar,
      });
      // On success, pendingVerification is set and the OTP screen renders below.
    } catch {
      // error / errorCode are set by the store; rendered below
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (otp.length !== 6) {
      setFormError("Enter the 6-digit code");
      return;
    }

    try {
      await verifyOtp(otp);
      router.push("/conversations");
    } catch {
      // error / errorCode are set by the store; rendered below
    }
  };

  // ============================================================================
  // OTP VERIFICATION SCREEN
  // ============================================================================
  if (pendingVerification) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Verify your account</h1>
            <p className="text-gray-600 mt-2 text-sm">
              Hi {pendingVerification.display_name}, enter the 6-digit code to finish creating your account.
            </p>
          </div>

          {(formError || error) && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-100 text-red-800">
              {formError || error}
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                6-digit OTP
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-center text-2xl tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                Demo OTP: <span className="font-mono">123456</span> (mocked verification for this assignment)
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {isLoading ? "Verifying..." : "Verify"}
            </button>

            <button
              type="button"
              onClick={() => {
                cancelVerification();
                setOtp("");
                setMode("login");
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel and go back
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LOGIN / REGISTER SCREEN
  // ============================================================================
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Signal</h1>
          <p className="text-gray-600 mt-2">Secure messaging</p>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === "login" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => switchMode("register")}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === "register" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Register
          </button>
        </div>

        {/* Error Message (with contextual actions per the backend error code) */}
        {(formError || error) && (
          <div className="mb-4 p-3 rounded-lg text-sm bg-red-100 text-red-800">
            <p>{formError || error}</p>
            {errorCode === "ACCOUNT_NOT_FOUND" && (
              <button
                onClick={() => switchMode("register")}
                className="mt-2 font-semibold underline"
              >
                Register instead
              </button>
            )}
            {errorCode === "ACCOUNT_EXISTS" && (
              <button
                onClick={() => switchMode("login")}
                className="mt-2 font-semibold underline"
              >
                Go to Login
              </button>
            )}
          </div>
        )}

        {/* Login Form */}
        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email, Phone, or Username
              </label>
              <input
                type="text"
                name="identifier"
                value={formData.identifier}
                onChange={handleChange}
                placeholder="user@example.com or +1234567890"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {isLoading ? "Logging in..." : "Login"}
            </button>
          </form>
        )}

        {/* Register Form */}
        {mode === "register" && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email, Phone, or Username
              </label>
              <input
                type="text"
                name="identifier"
                value={formData.identifier}
                onChange={handleChange}
                placeholder="user@example.com or +1234567890"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="John Doe"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Profile Avatar</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setAvatar(emoji)}
                    className={`w-12 h-12 flex items-center justify-center text-2xl rounded-full border-2 transition-colors ${
                      avatar === emoji
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {isLoading ? "Creating account..." : "Create Account"}
            </button>
          </form>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          Your messages are encrypted and secured.
        </p>
      </div>
    </div>
  );
}
