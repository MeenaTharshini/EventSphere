// src/Dashboard.jsx

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Activity,
  AlertCircle,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock3,
  DoorOpen,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Users,
  Building2,
} from "lucide-react";

import {
  getEvents,
  getVenues,
  logoutUser,
} from "./api";

import Sidebar from "./Sidebar";
import Events from "./Events";
import Venues from "./Venues";
import Resources from "./Resources";
import Scheduling from "./Scheduling";
import Attendance from "./Attendance";
import OrganizerVendors from "./OrganizerVendors";

import "./Dashboard.css";

const EMPTY_ARRAY = [];

function toArray(response, keys = []) {
  if (Array.isArray(response)) return response;

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  for (const key of keys) {
    if (Array.isArray(response?.[key])) {
      return response[key];
    }

    if (Array.isArray(response?.data?.[key])) {
      return response.data[key];
    }
  }

  return EMPTY_ARRAY;
}

function getEventDate(event) {
  const value =
    event?.date ??
    event?.event_date ??
    event?.start_date ??
    event?.startDate;

  if (!value) return null;

  // Parse date-only strings in local time to avoid timezone shifts.
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "Date not available";

  const date =
    value instanceof Date
      ? value
      : getEventDate({ date: value });

  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "Time not available";

  if (
    typeof value === "string" &&
    value.includes("T")
  ) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }
  }

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return String(value);

  const date = new Date(
    2000,
    0,
    1,
    Number(match[1]),
    Number(match[2])
  );

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getEventName(event) {
  return (
    event?.title ??
    event?.event_name ??
    event?.name ??
    "Untitled event"
  );
}

function getStatus(event) {
  const value = String(event?.status ?? "").toLowerCase();

  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("complete")) return "Completed";

  if (
    value.includes("progress") ||
    value.includes("ongoing")
  ) {
    return "In Progress";
  }

  if (value.includes("confirm")) return "Confirmed";
  if (value.includes("draft")) return "Draft";

  return event?.status || "Scheduled";
}

function getVenueName(event, venues) {
  if (event?.venue_name) return event.venue_name;
  if (event?.venue?.name) return event.venue.name;

  const venueId =
    event?.venue_id ??
    event?.venueId ??
    event?.venue?.id;

  if (venueId == null) {
    return "Venue not assigned";
  }

  const venue = venues.find(
    (item) =>
      String(item?.id ?? item?.venue_id ?? item?._id) ===
      String(venueId)
  );

  return (
    venue?.name ??
    venue?.venue_name ??
    "Venue not assigned"
  );
}

function getUserName(user) {
  return (
    user?.name ??
    user?.full_name ??
    user?.username ??
    user?.user?.name ??
    ""
  );
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  onClick,
}) {
  return (
    <button
      type="button"
      className="dashboard-stat-card"
      onClick={onClick}
    >
      <span className="dashboard-stat-icon">
        <Icon size={21} />
      </span>

      <span className="dashboard-stat-label">
        {label}
      </span>

      <strong className="dashboard-stat-value">
        {value}
      </strong>

      <span className="dashboard-stat-helper">
        {helper}
      </span>
    </button>
  );
}

function StatusBadge({ status }) {
  const className = String(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return (
    <span className={`dashboard-status-badge ${className}`}>
      {status}
    </span>
  );
}

function MiniCalendar({ events, onSelectDate }) {
  const [monthDate, setMonthDate] = useState(
    () => new Date()
  );

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventDays = useMemo(() => {
    const days = new Set();

    events.forEach((event) => {
      const date = getEventDate(event);

      if (
        date &&
        date.getFullYear() === year &&
        date.getMonth() === month
      ) {
        days.add(date.getDate());
      }
    });

    return days;
  }, [events, year, month]);

  const cells = [
    ...Array.from(
      { length: firstWeekday },
      () => null
    ),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    ),
  ];

  const today = new Date();

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>Event calendar</h2>
          <p>Dates containing scheduled events.</p>
        </div>

        <div className="dashboard-calendar-controls">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() =>
              setMonthDate(
                new Date(year, month - 1, 1)
              )
            }
          >
            ‹
          </button>

          <button
            type="button"
            aria-label="Next month"
            onClick={() =>
              setMonthDate(
                new Date(year, month + 1, 1)
              )
            }
          >
            ›
          </button>
        </div>
      </div>

      <p className="dashboard-calendar-month">
        {new Intl.DateTimeFormat(undefined, {
          month: "long",
          year: "numeric",
        }).format(monthDate)}
      </p>

      <div className="dashboard-calendar-grid">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            className="dashboard-calendar-weekday"
            key={index}
          >
            {new Intl.DateTimeFormat(undefined, {
              weekday: "short",
            }).format(new Date(2024, 0, index + 7))}
          </span>
        ))}

        {cells.map((day, index) => {
          const isToday =
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

          return (
            <button
              type="button"
              key={`${year}-${month}-${index}`}
              disabled={!day}
              aria-label={
                day
                  ? `${formatDate(
                      new Date(year, month, day)
                    )}${
                      eventDays.has(day)
                        ? ", has events"
                        : ""
                    }`
                  : undefined
              }
              className={[
                "dashboard-calendar-day",
                isToday ? "today" : "",
                day && eventDays.has(day)
                  ? "has-event"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                if (day) {
                  onSelectDate?.(
                    new Date(year, month, day)
                  );
                }
              }}
            >
              {day || ""}

              {day && eventDays.has(day) && (
                <span className="dashboard-calendar-dot" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DashboardOverview({
  user,
  events,
  venues,
  loading,
  error,
  onRefresh,
  onNavigate,
}) {
  const upcomingEvents = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return events
      .filter((event) => {
        const date = getEventDate(event);
        const status = String(
          getStatus(event)
        ).toLowerCase();

        return (
          date &&
          date >= todayStart &&
          !status.includes("cancel") &&
          !status.includes("complete")
        );
      })
      .sort(
        (a, b) =>
          getEventDate(a) - getEventDate(b)
      );
  }, [events]);

  const attendeeCount = useMemo(() => {
    return events.reduce((total, event) => {
      const count =
        event?.attendee_count ??
        event?.attendees_count ??
        event?.registered_attendees ??
        event?.attendees?.length;

      const number = Number(count);

      return (
        total +
        (Number.isFinite(number) ? number : 0)
      );
    }, 0);
  }, [events]);

  const nextEvent = upcomingEvents[0];

  return (
    <>
      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">
            EVENT MANAGEMENT WORKSPACE
          </p>

          <h2>
            {getGreeting()}
            {getUserName(user)
              ? `, ${getUserName(user)}`
              : ""}
            !
          </h2>

          <p>
            Manage your events, venues, attendance, and
            scheduling from one workspace.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-primary-button"
          onClick={() => onNavigate("Events")}
        >
          <Plus size={18} />
          Manage events
        </button>
      </section>

      {error && (
        <div className="dashboard-alert" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>

          <button
            type="button"
            onClick={onRefresh}
          >
            Retry
          </button>
        </div>
      )}

      <div className="dashboard-section-heading">
        <div>
          <h2>Overview</h2>
          <p>
            Statistics calculated from your API data.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            size={16}
            className={
              loading ? "dashboard-spinning" : ""
            }
          />
          Refresh
        </button>
      </div>

      <section className="dashboard-stat-grid">
        <StatCard
          icon={CalendarDays}
          label="Events"
          value={loading ? "…" : events.length}
          helper="Records returned by the API"
          onClick={() => onNavigate("Events")}
        />

        <StatCard
          icon={DoorOpen}
          label="Venues"
          value={loading ? "…" : venues.length}
          helper="Registered venue records"
          onClick={() => onNavigate("Venues")}
        />

        <StatCard
          icon={CalendarPlus}
          label="Upcoming events"
          value={
            loading ? "…" : upcomingEvents.length
          }
          helper="Future non-cancelled events"
          onClick={() => onNavigate("Scheduling")}
        />

        <StatCard
          icon={Users}
          label="Attendees"
          value={loading ? "…" : attendeeCount}
          helper="Based on attendee fields in event data"
          onClick={() => onNavigate("Attendance")}
        />
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Upcoming events</h2>
              <p>Sorted by event date.</p>
            </div>

            <button
              type="button"
              className="dashboard-text-button"
              onClick={() => onNavigate("Events")}
            >
              View all <ChevronRight size={16} />
            </button>
          </div>

          {loading ? (
            <p className="dashboard-empty-state">
              Loading events…
            </p>
          ) : upcomingEvents.length === 0 ? (
            <div className="dashboard-empty-state">
              <CalendarDays size={28} />

              <h3>No upcoming events</h3>

              <p>
                Events will appear here when the API returns
                scheduled future events.
              </p>
            </div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Venue</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {upcomingEvents
                    .slice(0, 6)
                    .map((event, index) => (
                      <tr
                        key={
                          event?.id ??
                          event?.event_id ??
                          event?._id ??
                          `${getEventName(event)}-${index}`
                        }
                      >
                        <td>
                          <strong>
                            {getEventName(event)}
                          </strong>

                          <span className="dashboard-subtext">
                            {event?.category ??
                              event?.event_type ??
                              ""}
                          </span>
                        </td>

                        <td>
                          {formatDate(
                            getEventDate(event)
                          )}

                          <span className="dashboard-subtext">
                            {formatTime(
                              event?.time ??
                                event?.start_time
                            )}
                          </span>
                        </td>

                        <td>
                          {getVenueName(event, venues)}
                        </td>

                        <td>
                          <StatusBadge
                            status={getStatus(event)}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <MiniCalendar
          events={events}
          onSelectDate={() =>
            onNavigate("Scheduling")
          }
        />
      </div>

      <div className="dashboard-secondary-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Next event</h2>
              <p>Your nearest upcoming event.</p>
            </div>

            <Clock3 size={20} />
          </div>

          {nextEvent ? (
            <div className="dashboard-next-event">
              <strong>
                {getEventName(nextEvent)}
              </strong>

              <p>
                <CalendarDays size={16} />
                {formatDate(
                  getEventDate(nextEvent)
                )}
              </p>

              <p>
                <Clock3 size={16} />
                {formatTime(
                  nextEvent?.time ??
                    nextEvent?.start_time
                )}
              </p>

              <p>
                <MapPin size={16} />
                {getVenueName(nextEvent, venues)}
              </p>

              <StatusBadge
                status={getStatus(nextEvent)}
              />
            </div>
          ) : (
            <p className="dashboard-empty-state">
              No upcoming event data is available.
            </p>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Workspace modules</h2>
              <p>
                Open a module to manage its records.
              </p>
            </div>

            <Activity size={20} />
          </div>

          <div className="dashboard-module-list">
            {[
              {
                label: "Events",
                icon: CalendarDays,
              },
              {
                label: "Venues",
                icon: DoorOpen,
              },
              {
                label: "Resources",
                icon: Package,
              },
              {
                label: "Scheduling",
                icon: CalendarPlus,
              },
              {
                label: "Attendance",
                icon: Users,
              },
              {
                label: "Vendors",
                icon: Building2,
              },
            ].map(({ label, icon: Icon }) => (
              <button
                type="button"
                key={label}
                onClick={() => onNavigate(label)}
              >
                <Icon size={18} />
                <strong>{label}</strong>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="dashboard-footer">
        <span>{new Date().getFullYear()}</span>

        <span>
          Dashboard values are calculated from API responses.
        </span>
      </footer>
    </>
  );
}

export default function Dashboard({
  user: userProp,
  onLogout,
}) {
  const [user, setUser] = useState(() => {
    if (userProp) return userProp;

    try {
      return JSON.parse(
        localStorage.getItem("user") || "null"
      );
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState("Dashboard");
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userProp) {
      setUser(userProp);
    }
  }, [userProp]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [
        eventsResponse,
        venuesResponse,
      ] = await Promise.all([
        getEvents(),
        getVenues(),
      ]);

      setEvents(
        toArray(eventsResponse, [
          "events",
          "items",
        ])
      );

      setVenues(
        toArray(venuesResponse, [
          "venues",
          "items",
        ])
      );
    } catch (err) {
      setError(
        err?.message ??
          "Unable to load dashboard data."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleNavigate = useCallback((page) => {
    setActivePage(page);
  }, []);

  const handleLogout = useCallback(async () => {
    // Auth.jsx owns logout when its callback is provided.
    // Avoid calling logoutUser twice in that case.
    if (typeof onLogout === "function") {
      onLogout();
      return;
    }

    try {
      await logoutUser();
    } catch {
      // Clear local credentials even if the API is unavailable.
    } finally {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("access_token");

      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      sessionStorage.removeItem("access_token");

      window.location.assign("/");
    }
  }, [onLogout]);

  let pageContent;

  switch (activePage) {
    case "Events":
      pageContent = <Events user={user} />;
      break;

    case "Venues":
      pageContent = <Venues user={user} />;
      break;

    case "Resources":
      pageContent = <Resources user={user} />;
      break;

    case "Scheduling":
      pageContent = <Scheduling user={user} />;
      break;

    case "Attendance":
      pageContent = <Attendance user={user} />;
      break;
    
    case "Vendors":
      pageContent = <OrganizerVendors user={user} />;
      break;
    default:
      pageContent = (
        <DashboardOverview
          user={user}
          events={events}
          venues={venues}
          loading={loading}
          error={error}
          onRefresh={loadDashboardData}
          onNavigate={handleNavigate}
        />
      );
  }

  return (
    <div className="dashboard-app">
      <Sidebar
        user={user}
        activePage={activePage}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <div>
            <p className="dashboard-breadcrumb">
              Workspace / {activePage}
            </p>

            <h1>{activePage}</h1>
          </div>

          <div className="dashboard-topbar-actions">
            <span className="dashboard-user-name">
              {getUserName(user)}
            </span>

            <button
              type="button"
              className="dashboard-avatar"
              aria-label="Log out"
              title="Log out"
              onClick={handleLogout}
            >
              {(
                getUserName(user)
                  .trim()
                  .charAt(0) || "U"
              ).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="dashboard-content">
          {pageContent}
        </div>
      </main>
    </div>
  );
}