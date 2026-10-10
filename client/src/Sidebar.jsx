import "./Sidebar.css";

const navigationItems = [
  { label: "Dashboard", icon: "◈", href: "#overview", active: true },
  { label: "Events", icon: "▦", href: "#events" },
  { label: "Venues", icon: "⌖", href: "#venues", soon: true },
  { label: "Resources", icon: "◇", href: "#resources", soon: true },
  { label: "Attendees", icon: "♙", href: "#attendees", soon: true },
  { label: "Vendors", icon: "♧", href: "#vendors", soon: true },
  { label: "Reports", icon: "▥", href: "#reports", soon: true },
];

export default function Sidebar({ user, onLogout }) {
  const initial = (user?.name || "U").charAt(0).toUpperCase();

  return (
    <aside className="es-sidebar">
      <a className="es-brand" href="#overview">
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
        <span>EventSphere</span>
      </a>

      <p className="es-sidebar-caption">WORKSPACE</p>

      <nav className="es-sidebar-nav" aria-label="Main navigation">
        {navigationItems.map((item) =>
          item.soon ? (
            <div
              key={item.label}
              className="es-sidebar-link es-sidebar-disabled"
              title={`${item.label} feature coming later`}
            >
              <span className="es-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="es-nav-label">{item.label}</span>
              <span className="es-nav-soon">Later</span>
            </div>
          ) : (
            <a
              key={item.label}
              className={`es-sidebar-link ${
                item.active ? "es-sidebar-active" : ""
              }`}
              href={item.href}
            >
              <span className="es-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="es-nav-label">{item.label}</span>
            </a>
          )
        )}
      </nav>

      <div className="es-sidebar-bottom">
        <div className="es-sidebar-user">
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
        >
          <span className="es-logout-icon" aria-hidden="true">↪</span>
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}