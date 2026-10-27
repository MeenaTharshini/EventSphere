
import { useEffect, useState } from "react";
import {
  loginUser,
  registerUser,
  logoutUser,
} from "./api";

import Dashboard from "./Dashboard";
import AttendeeRegistration from "./AttendeeRegistration";
import "./Auth.css";

const INITIAL_FORM = {
  name: "",
  email: "",
  password: "",
  role: "Attendee",
};

function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function getUserRole(user) {
  return String(user?.role || "").trim().toLowerCase();
}

export default function Auth() {
  const [user, setUser] = useState(getSavedUser);

  const [mode, setMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState(INITIAL_FORM);

  // Return to the login page when the session expires.
  useEffect(() => {
    function handleAuthLogout() {
      logoutUser();
      setUser(null);
      setMode("login");
      setShowPassword(false);
      setForm(INITIAL_FORM);
      setError("Your session has expired. Please sign in again.");
      setSuccess("");
    }

    window.addEventListener("auth:logout", handleAuthLogout);

    return () => {
      window.removeEventListener(
        "auth:logout",
        handleAuthLogout
      );
    };
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setShowPassword(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const email = form.email.trim().toLowerCase();

    if (!email || !form.password) {
      setError("Please enter your email and password.");
      return;
    }

    if (mode === "signup" && !form.name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (mode === "signup" && form.password.length < 6) {
      setError(
        "Your password must contain at least 6 characters."
      );
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        await registerUser({
          name: form.name.trim(),
          email,
          password: form.password,
          role: form.role,
        });

        setSuccess(
          "Account created successfully! Please sign in."
        );

        setForm((previous) => ({
          ...previous,
          name: "",
          password: "",
        }));

        setMode("login");
        setShowPassword(false);
      } else {
        const result = await loginUser({
          email,
          password: form.password,
        });

        if (!result?.user || !result?.token) {
          logoutUser();
          throw new Error(
            "Login failed. Please try again."
          );
        }

        // Keep the saved user consistent with the API result.
        localStorage.setItem(
          "user",
          JSON.stringify(result.user)
        );

        setUser(result.user);

        setForm((previous) => ({
          ...previous,
          password: "",
        }));

        setError("");
        setSuccess("");
      }
    } catch (err) {
      setError(
        err?.message ||
          "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    logoutUser();

    setUser(null);
    setMode("login");
    setShowPassword(false);
    setForm(INITIAL_FORM);
    setError("");
    setSuccess("You have been signed out.");
  }

  // Route authenticated users according to their role.
  const role = getUserRole(user);

  if (user && role === "attendee") {
    return (
      <AttendeeRegistration
        user={user}
        onLogout={handleLogout}
      />
    );
  }

  if (user && (role === "organizer" || role === "vendor")) {
    return (
      <Dashboard
        user={user}
        onLogout={handleLogout}
      />
    );
  }

  // If a saved user has an unexpected role, do not trap them
  // on the login screen or show the wrong role-specific page.
  if (user && !["attendee", "organizer", "vendor"].includes(role)) {
    logoutUser();
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <aside className="auth-visual">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="16"
                  rx="2"
                />
                <path d="M16 3v4M8 3v4M3 10h18" />
                <path d="m9 15 2 2 4-4" />
              </svg>
            </div>
            <span>EventSphere</span>
          </div>

          <div className="visual-copy">
            <span className="eyebrow">
              YOUR EVENTS. ONE PLACE.
            </span>

            <h1>
              Every great
              <br />
              event starts
              <br />
              <span>with a plan.</span>
            </h1>

            <p>
              Plan smarter, bring people together, and turn your
              ideas into unforgettable experiences.
            </p>

            <div className="visual-features">
              <div>
                <span className="feature-check">✓</span>
                Manage events effortlessly
              </div>
              <div>
                <span className="feature-check">✓</span>
                Keep everything organized
              </div>
              <div>
                <span className="feature-check">✓</span>
                Make every moment count
              </div>
            </div>
          </div>

          <div className="visual-footer">
            <span className="footer-dot" />
            One platform. Endless possibilities.
          </div>
        </aside>

        <section className="auth-panel">
          <div className="mobile-brand">
            <div className="brand-mark" aria-hidden="true">
              <span>ES</span>
            </div>
            <span>EventSphere</span>
          </div>

          <div className="auth-content">
            <div className="auth-heading">
              <span className="eyebrow">
                {mode === "login"
                  ? "WELCOME BACK"
                  : "GET STARTED"}
              </span>

              <h2>
                {mode === "login"
                  ? "Sign in to your account"
                  : "Create your account"}
              </h2>

              <p>
                {mode === "login"
                  ? "Enter your details to access your workspace."
                  : "Join EventSphere and start organizing your events."}
              </p>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>

              <button
                type="button"
                className={mode === "signup" ? "active" : ""}
                onClick={() => changeMode("signup")}
              >
                Sign up
              </button>
            </div>

            {error && (
              <div className="auth-message error" role="alert">
                {error}
              </div>
            )}

            {success && (
              <div className="auth-message success" role="status">
                {success}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="auth-form"
            >
              {mode === "signup" && (
                <div className="form-field">
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={form.name}
                    onChange={handleChange}
                    autoComplete="name"
                    required
                  />
                </div>
              )}

              <div className="form-field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  autoComplete="email"
                  required
                />
              </div>

              {mode === "signup" && (
                <div className="form-field">
                  <label htmlFor="role">Account type</label>
                  <select
                    id="role"
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                  >
                    <option value="Attendee">Attendee</option>
                    <option value="Organizer">Organizer</option>
                    <option value="Vendor">Vendor</option>
                  </select>

                  <span className="field-hint">
                    Choose the role that best describes you.
                  </span>
                </div>
              )}

              <div className="form-field">
                <div className="label-row">
                  <label htmlFor="password">Password</label>

                  {mode === "login" && (
                    <span className="secure-label">
                      <span>●</span> Secure sign in
                    </span>
                  )}
                </div>

                <div className="password-wrap">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={
                      mode === "signup"
                        ? "Create a password"
                        : "Enter your password"
                    }
                    value={form.password}
                    onChange={handleChange}
                    autoComplete={
                      mode === "login"
                        ? "current-password"
                        : "new-password"
                    }
                    minLength={
                      mode === "signup" ? 6 : undefined
                    }
                    required
                  />

                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowPassword((value) => !value)
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {mode === "login" && (
                <div className="form-options">
                  <span className="login-note">
                    Use your registered email and password.
                  </span>
                </div>
              )}

              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign in to EventSphere"
                    : "Create account"}

                {!loading && (
                  <span aria-hidden="true">→</span>
                )}
              </button>
            </form>

            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  New to EventSphere?{" "}
                  <button
                    type="button"
                    onClick={() => changeMode("signup")}
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => changeMode("login")}
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>

            <div className="auth-legal">
              By continuing, you agree to use EventSphere responsibly.
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}