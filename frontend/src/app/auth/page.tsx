"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

export default function AuthPage() {
  const router = useRouter();
  const { login, register, error, isLoading, clearError } = useAuthStore();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [formData, setFormData] = useState({
    identifier: "",
    username: "",
    password: "",
    displayName: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.identifier || !formData.password) {
      setFormError("Email, phone, or username and password are required");
      return;
    }

    try {
      await login({
        username: formData.identifier,
        password: formData.password,
      });
      // Redirect to conversations on success
      router.push("/conversations");
    } catch (err) {
      setFormError(error || "Login failed");
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
      });
      // After successful registration, show login mode
      setMode("login");
      setFormData({ ...formData, password: "", displayName: "" });
      setFormError("Registration successful! Please log in.");
    } catch (err) {
      setFormError(error || "Registration failed");
    }
  };

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
            onClick={() => {
              setMode("login");
              setFormError(null);
              clearError();
            }}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === "login"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => {
              setMode("register");
              setFormError(null);
              clearError();
            }}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-colors ${
              mode === "register"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            Register
          </button>
        </div>

        {/* Error Message */}
        {(formError || error) && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${
              formError?.includes("successful")
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {formError || error}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name
              </label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
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

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {isLoading ? "Registering..." : "Register"}
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
