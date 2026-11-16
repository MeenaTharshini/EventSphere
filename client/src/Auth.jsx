
import { useEffect, useState } from "react";

import {
  loginUser,
  loginAdmin,
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

// =========================================================
// USER HELPERS
// =========================================================

function getSavedUser() {
  try {
    return JSON.parse(
      localStorage.getItem("user") || "null"
    );
  } catch {
    return null;
  }
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getUserRole(user) {
  return normalizeRole(
    user?.activeRole || user?.role
  );
}

function getAvailableRoles(user) {
  const roles = Array.isArray(user?.roles)
    ? user.roles
    : [user?.role];

  const normalizedRoles = roles
    .map(normalizeRole)
    .filter((role) => VALID_ROLES.includes(role));

  if (!normalizedRoles.includes("attendee")) {
    normalizedRoles.unshift("attendee");
  }

  return [...new Set(normalizedRoles)];
}

function formatRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// =========================================================
// AUTH COMPONENT
// =========================================================

export default function Auth() {
  const [user, setUser] = useState(getSavedUser);

  // login | signup | admin-login
  const [mode, setMode] = useState("login");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState(INITIAL_FORM);

  const [vendorPage, setVendorPage] = useState("profile");

  const [loginRole, setLoginRole] = useState("attendee");

  const [
    selectedRegistrationEvent,
    setSelectedRegistrationEvent,
  ] = useState(null);

  // =======================================================
  // SESSION EXPIRATION
  // =======================================================

  useEffect(() => {
    function handleAuthLogout() {
      logoutUser();

      setUser(null);
      setMode("login");
      setShowPassword(false);
      setLoginRole("attendee");
      setVendorPage("profile");
      setSelectedRegistrationEvent(null);
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

  // =======================================================
  // FORM HANDLERS
  // =======================================================

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
  }

  function changeMode(nextMode) {
    setMode(nextMode);

    setError("");
    setSuccess("");
    setShowPassword(false);
  }

  // =======================================================
  // LOGIN AND REGISTRATION
  // =======================================================

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

    // Backend password requirement is 8 characters.
    if (
      mode === "signup" &&
      password.length < 8
    ) {
      setError(
        "Your password must contain at least 8 characters."
      );
      return;
    }

    setLoading(true);

    try {
      // =================================================
      // PUBLIC USER SIGNUP
      // =================================================

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

      // =================================================
      // SEPARATE ADMIN LOGIN
      // =================================================

      else if (mode === "admin-login") {
        const result = await loginAdmin({
          email,
          password,
        });

        if (!result?.user || !result?.token) {
          logoutUser();

          throw new Error(
            "Admin login failed. Please try again."
          );
        }

        const adminRole = normalizeRole(
          result.user.role
        );

        if (
          adminRole !== "admin" &&
          adminRole !== "administrator"
        ) {
          logoutUser();

          throw new Error(
            "This account does not have administrator access."
          );
        }

        // Set Admin as the active session role.
        const sessionUser = {
          ...result.user,
          activeRole: "admin",
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

      // =================================================
      // NORMAL USER LOGIN
      // =================================================

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

        // Admin accounts must use the separate portal.
        const accountRole = normalizeRole(
          loggedInUser.role
        );

        if (
          accountRole === "admin" ||
          accountRole === "administrator"
        ) {
          logoutUser();

          throw new Error(
            "Administrators must use the separate Admin Login portal."
          );
        }

        const accountRoles = getAvailableRoles(
          loggedInUser
        );

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

  // =======================================================
  // LOGOUT
  // =======================================================

  function handleLogout() {
    logoutUser();

    setUser(null);
    setMode("login");
    setShowPassword(false);
    setLoginRole("attendee");
    setVendorPage("profile");
    setSelectedRegistrationEvent(null);
    setForm(INITIAL_FORM);

    setError("");
    setSuccess("You have been signed out.");
  }

  // =======================================================
  // ROLE-BASED ROUTING
  // =======================================================

  const role = getUserRole(user);

  if (user) {
    switch (role) {
      // ADMIN
      case "admin":
      case "administrator":
        return (
          <Dashboard
            user={user}
            onLogout={handleLogout}
          />
        );

      // ATTENDEE
      case "attendee":
        return (
          <AttendeeRegistration
            user={user}
            onLogout={handleLogout}
          />
        );

      // VENDOR
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

      // ORGANIZER
      case "organizer":
        return (
          <Dashboard
            user={user}
            onLogout={handleLogout}
          />
        );

      // UNKNOWN ROLE
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

  // =======================================================
  // AUTHENTICATION PAGE
  // =======================================================

  const isAdminLogin = mode === "admin-login";

  return (
    <main className="auth-page">
      <section className="auth-shell">

        {/* ============================================= */}
        {/* LEFT VISUAL SECTION */}
        {/* ============================================= */}

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

        {/* ============================================= */}
        {/* RIGHT AUTHENTICATION SECTION */}
        {/* ============================================= */}

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

            {/* HEADING */}

            <div className="auth-heading">
              <span className="eyebrow">
                {isAdminLogin
                  ? "ADMINISTRATOR ACCESS"
                  : mode === "login"
                    ? "WELCOME BACK"
                    : "GET STARTED"}
              </span>

              <h2>
                {isAdminLogin
                  ? "Admin Sign In"
                  : mode === "login"
                    ? "Sign in to your account"
                    : "Create your account"}
              </h2>

              <p>
                {isAdminLogin
                  ? "Access the EventSphere administration workspace using your authorized credentials."
                  : mode === "login"
                    ? "Choose how you want to continue."
                    : "Join EventSphere and start organizing your events."}
              </p>
            </div>

            {/* LOGIN / SIGNUP TABS */}

            {!isAdminLogin && (
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
            )}

            {/* ERROR MESSAGE */}

            {error && (
              <div
                className="auth-message error"
                role="alert"
              >
                {error}
              </div>
            )}

            {/* SUCCESS MESSAGE */}

            {success && (
              <div
                className="auth-message success"
                role="status"
              >
                {success}
              </div>
            )}

            {/* AUTHENTICATION FORM */}

            <form
              onSubmit={handleSubmit}
              className="auth-form"
            >

              {/* FULL NAME */}

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

              {/* EMAIL */}

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

              {/* SIGNUP ROLE */}

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

              {/* NORMAL LOGIN ROLE */}

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

              {/* PASSWORD */}

              <div className="form-field">
                <div className="label-row">
                  <label htmlFor="password">
                    Password
                  </label>

                  {(mode === "login" || isAdminLogin) && (
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
                      mode === "signup"
                        ? "new-password"
                        : "current-password"
                    }
                    minLength={
                      mode === "signup"
                        ? 8
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

              {/* LOGIN NOTE */}

              {mode === "login" && (
                <div className="form-options">
                  <span className="login-note">
                    Use your registered email and password.
                  </span>
                </div>
              )}

              {isAdminLogin && (
                <div className="form-options">
                  <span className="login-note">
                    This portal is restricted to authorized administrators.
                  </span>
                </div>
              )}

              {/* SUBMIT BUTTON */}

              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading
                  ? "Please wait..."
                  : isAdminLogin
                    ? "Sign in as Admin"
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

            {/* ========================================= */}
            {/* MODE SWITCH */}
            {/* ========================================= */}

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
              ) : mode === "signup" ? (
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
              ) : (
                <>
                  Not an administrator?{" "}

                  <button
                    type="button"
                    onClick={() => {
                      changeMode("login");
                      setForm(INITIAL_FORM);
                    }}
                  >
                    Back to user login
                  </button>
                </>
              )}
            </div>

            {/* SEPARATE ADMIN LOGIN LINK */}

            {mode === "login" && (
              <div className="auth-switch admin-login-link">
                <span>
                  Administrator?
                </span>{" "}

                <button
                  type="button"
                  onClick={() => {
                    setForm((previous) => ({
                      ...previous,
                      password: "",
                    }));

                    setMode("admin-login");
                    setError("");
                    setSuccess("");
                    setShowPassword(false);
                  }}
                >
                  Admin Login
                </button>
              </div>
            )}

            {/* FOOTER */}

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
