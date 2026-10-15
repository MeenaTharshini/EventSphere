
import { useEffect, useState } from "react";
import "./Sidebar.css";

const navigationItems = [
  { label: "Dashboard", icon: "◈", href: "#overview" },
  { label: "Events", icon: "▦", href: "#events" },
  { label: "Venues", icon: "⌖", href: "#venues" },
  { label: "Resources", icon: "◇", href: "#resources" },
  { label: "Scheduling", icon: "◷", href: "#scheduling" },
  { label: "Attendees", icon: "♙", href: "#attendees", soon: true },
  { label: "Vendors", icon: "♧", href: "#vendors", soon: true },
  { label: "Reports", icon: "▥", href: "#reports", soon: true },
];

export default function Sidebar({
  user,
  onLogout,
  onNavigate,
  activePage = "Dashboard",
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const initial = (user?.name || "U").charAt(0).toUpperCase();

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");

    const updateScreen = () => {
      setIsMobile(mediaQuery.matches);
      setMobileOpen(false);
    };

    updateScreen();
    mediaQuery.addEventListener("change", updateScreen);

    return () => {
      mediaQuery.removeEventListener("change", updateScreen);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen]);

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((previous) => !previous);
    } else {
      setCollapsed((previous) => !previous);
    }
  }

  function closeMobileSidebar() {
    if (isMobile) {
      setMobileOpen(false);
    }
  }

  function handleNavigation(event, item) {
    event.preventDefault();

    if (item.soon) return;

    closeMobileSidebar();

    if (item.label === "Events") {
      if (activePage !== "Dashboard") {
        onNavigate?.("Dashboard");

        window.setTimeout(() => {
          document.getElementById("events")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 100);
      } else {
        document.getElementById("events")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }

      return;
    }

    // Dashboard, Venues, Resources, and Scheduling
    // are managed by Dashboard.jsx.
    onNavigate?.(item.label);
  }

  const sidebarClass = [
    "es-sidebar",
    collapsed && !isMobile ? "es-sidebar-collapsed" : "",
    mobileOpen && isMobile ? "es-sidebar-mobile-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const toggleLabel = isMobile
    ? mobileOpen
      ? "Close navigation menu"
      : "Open navigation menu"
    : collapsed
      ? "Expand sidebar"
      : "Collapse sidebar";

  return (
    <>
      {isMobile && !mobileOpen && (
        <button
          type="button"
          className="es-mobile-menu-button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={false}
        >
          <span aria-hidden="true">☰</span>
        </button>
      )}

      {isMobile && mobileOpen && (
        <button
          type="button"
          className="es-sidebar-overlay"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={sidebarClass}
        aria-label="EventSphere sidebar"
        aria-hidden={isMobile && !mobileOpen}
      >
        <div className="es-sidebar-header">
          <a
            className="es-brand"
            href="#overview"
            onClick={(event) => {
              event.preventDefault();
              onNavigate?.("Dashboard");
              closeMobileSidebar();
            }}
            title="EventSphere"
          >
            <span className="es-brand-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4" />
              </svg>
            </span>

            <span className="es-brand-name">EventSphere</span>
          </a>

          <button
            type="button"
            className="es-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={toggleLabel}
            aria-expanded={isMobile ? mobileOpen : !collapsed}
            title={toggleLabel}
          >
            <span aria-hidden="true">
              {isMobile && mobileOpen
                ? "×"
                : collapsed && !isMobile
                  ? "☰"
                  : "‹"}
            </span>
          </button>
        </div>

        <p className="es-sidebar-caption">WORKSPACE</p>

        <nav className="es-sidebar-nav" aria-label="Main navigation">
          {navigationItems.map((item) => {
            const isActive = item.label === activePage;

            if (item.soon) {
              return (
                <div
                  key={item.label}
                  className="es-sidebar-link es-sidebar-disabled"
                  title={`${item.label} feature coming later`}
                  aria-disabled="true"
                >
                  <span className="es-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>

                  <span className="es-nav-label">{item.label}</span>
                  <span className="es-nav-soon">Later</span>
                </div>
              );
            }

            return (
              <a
                key={item.label}
                className={`es-sidebar-link ${
                  isActive ? "es-sidebar-active" : ""
                }`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => handleNavigation(event, item)}
                title={
                  collapsed && !isMobile ? item.label : undefined
                }
              >
                <span className="es-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>

                <span className="es-nav-label">{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="es-sidebar-bottom">
          <div
            className="es-sidebar-user"
            title={`${user?.name || "User"} — ${
              user?.role || "Attendee"
            }`}
          >
            <span className="es-user-avatar">{initial}</span>

            <span className="es-user-details">
              <strong>{user?.name || "User"}</strong>
              <small>{user?.role || "Attendee"}</small>
            </span>
          </div>

          <button
            type="button"
            className="es-sidebar-logout"
            onClick={onLogout}
            title={collapsed && !isMobile ? "Log out" : undefined}
          >
            <span className="es-logout-icon" aria-hidden="true">
              ↪
            </span>

            <span className="es-logout-label">Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}