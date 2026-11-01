
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  MapPin,
  RefreshCw,
  Tag,
  Building2,
  CheckCircle2,
  AlertCircle,
  CalendarCheck,
  BriefcaseBusiness,
  ClipboardList,
  ShieldCheck,
  Info,
  Ticket,
} from "lucide-react";

import { getMyAssignedEvents } from "./api";
import "./AssignedEvents.css";

/* =========================================================
   RESPONSE NORMALIZATION
   ========================================================= */

function unwrapResponse(response) {
  let result = response?.data ?? response;

  if (
    result &&
    !Array.isArray(result) &&
    typeof result === "object" &&
    result.data !== undefined
  ) {
    result = result.data;
  }

  return result;
}

function normalizeEvents(response) {
  const result = unwrapResponse(response);

  const items = Array.isArray(result)
    ? result
    : result?.events ??
      result?.assigned_events ??
      result?.items ??
      [];

  if (!Array.isArray(items)) return [];

  return items
    .filter((event) => event && typeof event === "object")
    .map((event, index) => {
      const nested = event.event ?? {};

      const rawLocation =
        event.location ??
        event.venue ??
        event.venue_name ??
        nested.location ??
        nested.venue ??
        "";

      const location =
        typeof rawLocation === "object" && rawLocation
          ? rawLocation.name ??
            rawLocation.venue_name ??
            rawLocation.address ??
            rawLocation.city ??
            ""
          : rawLocation;

      return {
        ...event,

        id: String(
          event.id ??
            event._id ??
            event.event_id ??
            nested.id ??
            nested._id ??
            `${event.name ?? nested.name ?? "event"}-${index}`
        ),

        name: String(
          event.name ??
            event.title ??
            event.event_name ??
            nested.name ??
            nested.title ??
            "Untitled event"
        ),

        description:
          event.description ?? nested.description ?? "",

        date:
          event.event_date ??
          event.date ??
          event.start_date ??
          event.start_datetime ??
          nested.event_date ??
          nested.date ??
          "",

        startTime:
          event.start_time ??
          event.event_time ??
          event.time ??
          nested.start_time ??
          "",

        endTime:
          event.end_time ?? nested.end_time ?? "",

        location: String(location || ""),

        category:
          event.event_type ??
          event.category ??
          event.service ??
          nested.event_type ??
          nested.category ??
          "",

        eventStatus: String(
          event.event_status ??
            event.status ??
            nested.status ??
            "Scheduled"
        ),

        registrationStatus: String(
          event.registration_status ??
            event.registration?.status ??
            "Assigned"
        ),

        responsibility:
          event.assigned_service ??
          event.responsibility ??
          event.assignment ??
          event.registration?.service ??
          "",
      };
    });
}

/* =========================================================
   DATE AND TIME HELPERS
   ========================================================= */

function formatDate(value) {
  if (!value) return "Date to be announced";

  // Handle YYYY-MM-DD as a local calendar date.
  const dateOnly = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      )
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "";

  const text = String(value).trim();

  // Preserve plain values like "10:30" and "10:30 AM".
  if (
    /^\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?$/i.test(text)
  ) {
    return text;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function titleCase(value) {
  return String(value || "Assigned")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function statusClass(value) {
  const status = String(value || "").toLowerCase();

  if (
    status.includes("complete") ||
    status.includes("approved") ||
    status.includes("confirmed") ||
    status.includes("registered")
  ) {
    return "is-success";
  }

  if (
    status.includes("cancel") ||
    status.includes("reject") ||
    status.includes("declined")
  ) {
    return "is-danger";
  }

  if (
    status.includes("progress") ||
    status.includes("ongoing")
  ) {
    return "is-warning";
  }

  return "is-neutral";
}

/* =========================================================
   ASSIGNED EVENTS PAGE
   ========================================================= */

function AssignedEvents({
  onBack,
  onLogout,
  onRegister,
  user,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState("");

  /* ---------- Load assigned events ---------- */

  const loadAssignedEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getMyAssignedEvents();

      setEvents(normalizeEvents(response));
      setLastUpdated(new Date());
    } catch (err) {
      const message =
        err?.response?.data?.detail ??
        err?.response?.data?.message ??
        err?.message ??
        "Unable to load your assigned events. Please try again.";

      setError(
        typeof message === "string"
          ? message
          : "Unable to load your assigned events. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssignedEvents();
  }, [loadAssignedEvents]);

  /* ---------- Search ---------- */

  const visibleEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return events;

    return events.filter((event) =>
      [
        event.name,
        event.description,
        event.location,
        event.category,
        event.responsibility,
        event.eventStatus,
        event.registrationStatus,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [events, search]);

  /* ---------- Upcoming events count ---------- */

  const upcomingCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter((event) => {
      if (!event.date) return false;

      const dateOnly = String(event.date).match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

      const date = dateOnly
        ? new Date(
            Number(dateOnly[1]),
            Number(dateOnly[2]) - 1,
            Number(dateOnly[3])
          )
        : new Date(event.date);

      if (Number.isNaN(date.getTime())) {
        return false;
      }

      date.setHours(0, 0, 0, 0);

      return date >= today;
    }).length;
  }, [events]);

  /* ---------- Register for selected event ---------- */

  const handleRegister = useCallback(
    (event) => {
      if (typeof onRegister !== "function") {
        console.error(
          "onRegister was not provided to AssignedEvents. " +
            "Pass the navigation callback from Auth.jsx."
        );

        return;
      }

      onRegister(event);
    },
    [onRegister]
  );

  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <div className="es-assigned">
      {/* ---------- Header ---------- */}

      <header className="es-header">
        <a
          className="es-brand"
          href="/"
          aria-label="EventSphere home"
        >
          <CalendarDays
            className="es-brand-icon"
            size={29}
          />

          <span>EventSphere</span>
        </a>

        <nav
          className="es-header-nav"
          aria-label="Main navigation"
        >
          <span>Plan</span>
          <i>•</i>
          <span>Manage</span>
          <i>•</i>
          <span>Create Better Events</span>
        </nav>

        <div className="es-user-actions">
          {user?.name && (
            <span className="es-user-name">
              Hi, {user.name}
            </span>
          )}

          {typeof onLogout === "function" && (
            <button
              type="button"
              className="es-logout-button"
              onClick={onLogout}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* ---------- Main ---------- */}

      <main className="es-assigned-layout">
        <div className="es-assigned-toolbar">
          <button
            type="button"
            className="es-assigned-back"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Back to vendor profile
          </button>

          <span className="es-assigned-page-label">
            VENDOR WORKSPACE
          </span>
        </div>

        <div className="es-assigned-columns">
          {/* =============================================
              MAIN ASSIGNED EVENTS CARD
              ============================================= */}

          <section className="es-assigned-main-card">
            {/* Heading */}

            <div className="es-assigned-heading">
              <div className="es-assigned-heading-icon">
                <CalendarCheck size={30} />
              </div>

              <div>
                <span className="es-assigned-eyebrow">
                  YOUR BUSINESS SPACE
                </span>

                <h1>Your Assigned Events</h1>

                <p>
                  Keep track of the events assigned to your
                  business and the responsibilities you need
                  to prepare for.
                </p>
              </div>
            </div>

            <div className="es-assigned-card-divider" />

            {/* Error alert */}

            {error && (
              <div
                className="es-alert es-alert-error"
                role="alert"
              >
                <AlertCircle size={19} />

                <span>{error}</span>

                <button
                  type="button"
                  onClick={loadAssignedEvents}
                >
                  Try again
                </button>
              </div>
            )}

            {/* List toolbar */}

            <div className="es-assigned-list-toolbar">
              <div>
                <span className="es-assigned-eyebrow">
                  EVENT SCHEDULE
                </span>

                <h2>Events assigned to you</h2>

                <p>
                  Your event assignments in one place.
                </p>
              </div>

              <button
                type="button"
                className="es-refresh-button"
                onClick={loadAssignedEvents}
                disabled={loading}
                aria-label="Refresh assigned events"
                title="Refresh assigned events"
              >
                <RefreshCw
                  size={17}
                  className={
                    loading ? "es-assigned-spin" : ""
                  }
                />
              </button>
            </div>

            {/* Search */}

            {!loading &&
              !error &&
              events.length > 0 && (
                <div className="es-assigned-search">
                  <input
                    type="search"
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                    placeholder="Search event, venue, service..."
                    aria-label="Search assigned events"
                  />
                </div>
              )}

            {/* Loading */}

            {loading ? (
              <div className="es-assigned-state">
                <RefreshCw
                  size={25}
                  className="es-assigned-spin"
                />

                <strong>
                  Loading your assignments...
                </strong>

                <p>
                  Please wait while we retrieve your event
                  details.
                </p>
              </div>
            ) : error ? (
              /* Error state */

              <div className="es-assigned-state es-assigned-error-state">
                <AlertCircle size={29} />

                <strong>
                  We couldn't load your events
                </strong>

                <p>
                  Check your connection and try refreshing
                  the list.
                </p>

                <button
                  type="button"
                  className="es-assigned-primary-button"
                  onClick={loadAssignedEvents}
                >
                  <RefreshCw size={16} />
                  Try again
                </button>
              </div>
            ) : events.length === 0 ? (
              /* Empty state */

              <div className="es-assigned-state es-assigned-empty">
                <div className="es-assigned-empty-icon">
                  <CalendarDays size={30} />
                </div>

                <strong>
                  No assigned events yet
                </strong>

                <p>
                  When an organizer assigns your business
                  to an event, the details will appear here.
                </p>

                <button
                  type="button"
                  className="es-assigned-secondary-button"
                  onClick={onBack}
                >
                  <ArrowLeft size={15} />
                  Return to vendor profile
                </button>
              </div>
            ) : visibleEvents.length === 0 ? (
              /* No search matches */

              <div className="es-assigned-state es-assigned-empty">
                <ClipboardList size={29} />

                <strong>No matching events</strong>

                <p>
                  Try a different event name, venue or service.
                </p>

                <button
                  type="button"
                  className="es-assigned-secondary-button"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              </div>
            ) : (
              /* Event cards */

              <div className="es-assigned-event-list">
                {visibleEvents.map((event) => {
                  const startTime = formatTime(
                    event.startTime
                  );

                  const endTime = formatTime(
                    event.endTime
                  );

                  return (
                    <article
                      className="es-assigned-event"
                      key={event.id}
                    >
                      {/* Event top */}

                      <div className="es-assigned-event-top">
                        <div className="es-assigned-event-icon">
                          <Building2 size={19} />
                        </div>

                        <span
                          className={`es-assigned-status ${statusClass(
                            event.registrationStatus
                          )}`}
                        >
                          <CheckCircle2 size={13} />

                          {titleCase(
                            event.registrationStatus
                          )}
                        </span>
                      </div>

                      {/* Event title */}

                      <div className="es-assigned-event-title">
                        <h3>{event.name}</h3>

                        {event.description && (
                          <p>{event.description}</p>
                        )}
                      </div>

                      {/* Event details */}

                      <div className="es-assigned-event-details">
                        <div>
                          <CalendarDays size={16} />

                          <span>
                            {formatDate(event.date)}
                          </span>
                        </div>

                        {(startTime || endTime) && (
                          <div>
                            <Clock3 size={16} />

                            <span>
                              {startTime ||
                                "Time not specified"}

                              {endTime
                                ? ` – ${endTime}`
                                : ""}
                            </span>
                          </div>
                        )}

                        {event.location && (
                          <div>
                            <MapPin size={16} />

                            <span>
                              {event.location}
                            </span>
                          </div>
                        )}

                        {event.category && (
                          <div>
                            <Tag size={16} />

                            <span>
                              {titleCase(event.category)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Responsibility */}

                      {event.responsibility && (
                        <div className="es-assigned-responsibility">
                          <span>
                            <BriefcaseBusiness size={14} />

                            YOUR RESPONSIBILITY
                          </span>

                          <strong>
                            {event.responsibility}
                          </strong>
                        </div>
                      )}

                      {/* Event status */}

                      <div className="es-assigned-event-footer">
                        <span>
                          <ShieldCheck size={14} />

                          Event status:{" "}
                          {titleCase(event.eventStatus)}
                        </span>
                      </div>

                      {/* Register button */}

                      <div className="es-assigned-register-row">
                        <button
                          type="button"
                          className="es-assigned-register-button"
                          onClick={() =>
                            handleRegister(event)
                          }
                        >
                          <Ticket size={17} />

                          Register for this event

                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Footer note */}

            <p className="es-assigned-footer-note">
              <Info size={14} />

              Event details are provided by the event
              organizer. Contact the organizer if an
              assignment needs clarification.
            </p>
          </section>

          {/* =============================================
              RIGHT SUMMARY PANEL
              ============================================= */}

          <aside className="es-assigned-side-card">
            <div className="es-assigned-side-heading">
              <div>
                <span className="es-assigned-eyebrow">
                  YOUR EVENT SPACE
                </span>

                <h2>Assignment Overview</h2>

                <p>
                  A quick look at your event schedule.
                </p>
              </div>

              <div className="es-assigned-side-icon">
                <CalendarDays size={21} />
              </div>
            </div>

            {/* Total events */}

            <div className="es-assigned-summary">
              <div className="es-assigned-summary-icon">
                <ClipboardList size={19} />
              </div>

              <div>
                <strong>{events.length}</strong>

                <span>
                  {events.length === 1
                    ? "event assigned"
                    : "events assigned"}
                </span>
              </div>
            </div>

            {/* Upcoming events */}

            <div className="es-assigned-summary">
              <div className="es-assigned-summary-icon es-summary-green">
                <CalendarCheck size={19} />
              </div>

              <div>
                <strong>{upcomingCount}</strong>

                <span>
                  {upcomingCount === 1
                    ? "upcoming event"
                    : "upcoming events"}
                </span>
              </div>
            </div>

            <div className="es-assigned-side-divider" />

            {/* Information */}

            <div className="es-assigned-side-section">
              <h3>
                <ShieldCheck size={17} />

                Assignment information
              </h3>

              <p>
                Events shown here are linked to your
                approved vendor profile. Keep your business
                profile and contact information up to date.
              </p>
            </div>

            {/* Last updated */}

            <div className="es-assigned-side-section es-assigned-last-updated">
              <span>LAST UPDATED</span>

              <strong>
                {lastUpdated
                  ? lastUpdated.toLocaleTimeString(
                      "en-IN",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )
                  : "Not updated yet"}
              </strong>
            </div>

            {/* Back button */}

            <button
              type="button"
              className="es-assigned-side-button"
              onClick={onBack}
            >
              Back to vendor profile

              <ArrowUpRight size={16} />
            </button>

            <p className="es-assigned-side-note">
              EventSphere <span>·</span> Every event starts
              with a connection.
            </p>
          </aside>
        </div>
      </main>

      {/* ---------- Footer ---------- */}

      <footer className="es-footer">
        EventSphere <span>·</span> Every event starts with a
        connection.
      </footer>
    </div>
  );
}

export default AssignedEvents;
