
import { useEffect, useState } from "react";

import {
  loginUser,
  registerUser,
  logoutUser,
} from "./api";

import Dashboard from "./Dashboard";
import AttendeeRegistration from "./AttendeeRegistration";
import VendorProfile from "./VendorProfile";
import AssignedEvents from "./AssignedEvents";

import "./Auth.css";

const INITIAL_FORM = {
  name: "",
  email: "",
  password: "",
  role: "Attendee",
};

const VALID_ROLES = [
  "attendee",
  "organizer",
  "vendor",
];

// Read saved user safely.
function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

// Normalize role names.
function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

// Get the role used for the current session.
// activeRole takes priority over the account's original role.
function getUserRole(user) {
  return normalizeRole(
    user?.activeRole || user?.role
  );
}

// Get all roles associated with the account.
function getAvailableRoles(user) {
  const roles = Array.isArray(user?.roles)
    ? user.roles
    : [user?.role];

  const normalizedRoles = roles
    .map(normalizeRole)
    .filter((role) => VALID_ROLES.includes(role));

  // Every account can enter the attendee experience.
  if (!normalizedRoles.includes("attendee")) {
    normalizedRoles.unshift("attendee");
  }

  return [...new Set(normalizedRoles)];
}

// Display role names.
function formatRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function Auth() {
  const [user, setUser] = useState(getSavedUser);

  const [mode, setMode] = useState("login");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState(INITIAL_FORM);
  const [vendorPage, setVendorPage] = useState("profile");
  // Role selected on the login screen.
  const [loginRole, setLoginRole] = useState("attendee");
  const [selectedRegistrationEvent, setSelectedRegistrationEvent] =
  useState(null);
  // Handle session expiration.
  useEffect(() => {
    function handleAuthLogout() {
      logoutUser();

      setUser(null);
      setMode("login");
      setShowPassword(false);
      setLoginRole("attendee");
      setForm(INITIAL_FORM);

      setError(
        "Your session has expired. Please sign in again."
      );

      setSuccess("");
    }

    window.addEventListener(
      "auth:logout",
      handleAuthLogout
    );

    return () => {
      window.removeEventListener(
        "auth:logout",
        handleAuthLogout
      );
    };
  }, []);

  // Update form fields.
  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  // Switch between login and signup.
  function changeMode(nextMode) {
    setMode(nextMode);

    setError("");
    setSuccess("");
    setShowPassword(false);
  }

  // Login or signup.
  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const email = form.email.trim().toLowerCase();
    const password = form.password;

    if (!email || !password) {
      setError(
        "Please enter your email and password."
      );
      return;
    }

    if (
      mode === "signup" &&
      !form.name.trim()
    ) {
      setError("Please enter your full name.");
      return;
    }

    if (
      mode === "signup" &&
      password.length < 6
    ) {
      setError(
        "Your password must contain at least 6 characters."
      );
      return;
    }

    setLoading(true);

    try {
      // SIGNUP
      if (mode === "signup") {
        await registerUser({
          name: form.name.trim(),
          email,
          password,
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
        setLoginRole("attendee");
        setShowPassword(false);
      }

      // LOGIN
      else {
        const result = await loginUser({
          email,
          password,
        });

        if (!result?.user || !result?.token) {
          logoutUser();

          throw new Error(
            "Login failed. Please try again."
          );
        }

        const loggedInUser = result.user;

        const accountRoles = getAvailableRoles(
          loggedInUser
        );

        // Attendee access is available to every account.
        // Organizer/vendor access requires the corresponding role.
        const selectedRole = normalizeRole(loginRole);

        if (
          selectedRole !== "attendee" &&
          !accountRoles.includes(selectedRole)
        ) {
          logoutUser();

          throw new Error(
            `Your account does not have the ${formatRole(
              selectedRole
            )} role.`
          );
        }

        // Store the selected role separately.
        const sessionUser = {
          ...loggedInUser,
          activeRole: selectedRole,
        };

        localStorage.setItem(
          "user",
          JSON.stringify(sessionUser)
        );

        setUser(sessionUser);

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

  // Logout.
  function handleLogout() {
    logoutUser();

    setUser(null);
    setMode("login");
    setShowPassword(false);
    setLoginRole("attendee");
    setForm(INITIAL_FORM);

    setError("");
    setSuccess("You have been signed out.");
  }

  // Route according to the selected session role.
  const role = getUserRole(user);

  if (user) {
    switch (role) {
      case "attendee":
        return (
          <AttendeeRegistration
            user={user}
            onLogout={handleLogout}
          />
        );

      case "vendor":
  if (vendorPage === "assigned-events") {
    return (
      <AssignedEvents
        user={user}
        onBack={() => setVendorPage("profile")}
        onLogout={handleLogout}
        onRegister={(event) => {
          setSelectedRegistrationEvent(event);
          setVendorPage("attendee-registration");
        }}
      />
    );
  }

  if (vendorPage === "attendee-registration") {
    return (
      <AttendeeRegistration
        user={user}
        event={selectedRegistrationEvent}
        onLogout={handleLogout}
        onBack={() => setVendorPage("assigned-events")}
      />
    );
  }

  return (
    <VendorProfile
      user={user}
      onLogout={handleLogout}
      onViewAssignedEvents={() =>
        setVendorPage("assigned-events")
      }
    />
  );

      case "organizer":
        return (
          <Dashboard
            user={user}
            onLogout={handleLogout}
          />
        );

      default:
        return (
          <main className="auth-page">
            <section className="auth-shell">
              <div className="auth-panel">
                <div className="auth-content">
                  <h2>
                    Account role not recognized
                  </h2>

                  <p>
                    Please sign in with a valid account.
                  </p>

                  <button
                    type="button"
                    className="submit-button"
                    onClick={handleLogout}
                  >
                    Back to login
                  </button>
                </div>
              </div>
            </section>
          </main>
        );
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">

        {/* LEFT VISUAL SECTION */}

        <aside className="auth-visual">
          <div className="brand">
            <div
              className="brand-mark"
              aria-hidden="true"
            >
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
              Plan smarter, bring people together,
              and turn your ideas into unforgettable
              experiences.
            </p>

            <div className="visual-features">
              <div>
                <span className="feature-check">
                  ✓
                </span>

                Manage events effortlessly
              </div>

              <div>
                <span className="feature-check">
                  ✓
                </span>

                Keep everything organized
              </div>

              <div>
                <span className="feature-check">
                  ✓
                </span>

                Make every moment count
              </div>
            </div>
          </div>

          <div className="visual-footer">
            <span className="footer-dot" />

            One platform. Endless possibilities.
          </div>
        </aside>

        {/* RIGHT AUTHENTICATION SECTION */}

        <section className="auth-panel">
          <div className="mobile-brand">
            <div
              className="brand-mark"
              aria-hidden="true"
            >
              <span>ES</span>
            </div>

            <span>EventSphere</span>
          </div>

          <div className="auth-content">

            {/* Heading */}

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
                  ? "Choose how you want to continue."
                  : "Join EventSphere and start organizing your events."}
              </p>
            </div>

            {/* Login / Signup tabs */}

            <div className="auth-tabs">
              <button
                type="button"
                className={
                  mode === "login" ? "active" : ""
                }
                onClick={() =>
                  changeMode("login")
                }
              >
                Sign in
              </button>

              <button
                type="button"
                className={
                  mode === "signup" ? "active" : ""
                }
                onClick={() =>
                  changeMode("signup")
                }
              >
                Sign up
              </button>
            </div>

            {/* Error message */}

            {error && (
              <div
                className="auth-message error"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* Success message */}

            {success && (
              <div
                className="auth-message success"
                role="status"
              >
                {success}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="auth-form"
            >

              {/* Full name - signup only */}

              {mode === "signup" && (
                <div className="form-field">
                  <label htmlFor="name">
                    Full name
                  </label>

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

              {/* Email */}

              <div className="form-field">
                <label htmlFor="email">
                  Email address
                </label>

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

              {/* Account type - signup only */}

              {mode === "signup" && (
                <div className="form-field">
                  <label htmlFor="role">
                    Account type
                  </label>

                  <select
                    id="role"
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                    required
                  >
                    <option value="Attendee">
                      Attendee
                    </option>

                    <option value="Organizer">
                      Organizer
                    </option>

                    <option value="Vendor">
                      Vendor
                    </option>
                  </select>

                  <span className="field-hint">
                    Choose the role that best describes you.
                  </span>
                </div>
              )}

              {/* Login role selection */}

              {mode === "login" && (
                <div className="form-field">
                  <label htmlFor="loginRole">
                    Continue as
                  </label>

                  <select
                    id="loginRole"
                    name="loginRole"
                    value={loginRole}
                    onChange={(event) => {
                      setLoginRole(event.target.value);
                      setError("");
                    }}
                  >
                    <option value="attendee">
                      Attendee
                    </option>

                    <option value="organizer">
                      Organizer
                    </option>

                    <option value="vendor">
                      Vendor
                    </option>
                  </select>

                  <span className="field-hint">
                    Attendee access is available to everyone.
                    Organizer and Vendor access requires the
                    corresponding account role.
                  </span>
                </div>
              )}

              {/* Password */}

              <div className="form-field">
                <div className="label-row">
                  <label htmlFor="password">
                    Password
                  </label>

                  {mode === "login" && (
                    <span className="secure-label">
                      <span>●</span>
                      Secure sign in
                    </span>
                  )}
                </div>

                <div className="password-wrap">
                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
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
                      mode === "signup"
                        ? 6
                        : undefined
                    }
                    required
                  />

                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowPassword(
                        (previous) => !previous
                      )
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword
                      ? "Hide"
                      : "Show"}
                  </button>
                </div>
              </div>

              {/* Login note */}

              {mode === "login" && (
                <div className="form-options">
                  <span className="login-note">
                    Use your registered email and password.
                  </span>
                </div>
              )}

              {/* Submit */}

              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : mode === "login"
                    ? `Continue as ${formatRole(loginRole)}`
                    : "Create account"}

                {!loading && (
                  <span aria-hidden="true">
                    →
                  </span>
                )}
              </button>
            </form>

            {/* Switch between modes */}

            <div className="auth-switch">
              {mode === "login" ? (
                <>
                  New to EventSphere?{" "}

                  <button
                    type="button"
                    onClick={() =>
                      changeMode("signup")
                    }
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}

                  <button
                    type="button"
                    onClick={() =>
                      changeMode("login")
                    }
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>

            <div className="auth-legal">
              By continuing, you agree to use
              EventSphere responsibly.
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
