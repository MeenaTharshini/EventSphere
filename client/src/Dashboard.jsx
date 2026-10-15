
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getVenues,
  logoutUser,
} from "./api";
import Sidebar from "./Sidebar";
import Venues from "./Venues";
import Resources from "./Resources";
import Scheduling from "./Scheduling";
import "./Dashboard.css";

const STATUSES = ["Scheduled", "Confirmed", "Pending", "Cancelled"];

const EMPTY_FORM = {
  name: "",
  type: "",
  customType: "",
  event_date: "",
  venue_id: "",
  budget: "",
  status: "Scheduled",
};

const EVENT_TYPES = [
  "Conference",
  "Workshop",
  "Seminar",
  "Wedding",
  "Concert",
  "Birthday",
  "Corporate Event",
  "Other",
];

function getArray(data, keys = []) {
  if (Array.isArray(data)) return data;

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }

  return [];
}

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

function normalizeStatus(status) {
  const value = String(status || "Scheduled").toLowerCase();

  if (["planned", "upcoming", "scheduled"].includes(value)) {
    return "Scheduled";
  }
  if (["confirmed", "ongoing", "completed", "active"].includes(value)) {
    return "Confirmed";
  }
  if (value === "pending") return "Pending";
  if (["cancelled", "canceled"].includes(value)) return "Cancelled";

  return "Scheduled";
}

function toDateInput(value) {
  if (!value) return "";

  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);

  if (match) return match[1];

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatMoney(value) {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value) {
  if (!value) return "Date not set";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getUserRole(user) {
  return String(user?.role || user?.user?.role || "")
    .trim()
    .toLowerCase();
}

function getUserId(user) {
  return user?.id ?? user?.user_id ?? user?.user?.id ?? null;
}

function canManageEvent(event, user) {
  const role = getUserRole(user);

  if (["admin", "administrator"].includes(role)) return true;

  const ownerId =
    event?.organizer_id ??
    event?.created_by ??
    event?.user_id ??
    event?.owner_id;

  if (["organizer", "vendor"].includes(role)) {
    if (ownerId == null || getUserId(user) == null) {
      return true;
    }

    return String(ownerId) === String(getUserId(user));
  }

  return false;
}

export default function Dashboard({ user: userProp, onLogout }) {
  const [user, setUser] = useState(userProp || null);
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [activePage, setActivePage] = useState("Dashboard");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (userProp) {
      setUser(userProp);
      return;
    }

    try {
      const storedUser = localStorage.getItem("user");
      if (storedUser) setUser(JSON.parse(storedUser));
    } catch {
      setUser(null);
    }
  }, [userProp]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [eventsResult, venuesResult] = await Promise.all([
        getEvents(),
        getVenues(),
      ]);

      setEvents(getArray(eventsResult, ["events", "schedules"]));
      setVenues(getArray(venuesResult, ["venues"]));
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load dashboard data. Check that the backend is running."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const visibleEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return events.filter((event) => {
      const eventName = String(event.name || "").toLowerCase();
      const venueName = String(
        event.venue_name || event.venue || ""
      ).toLowerCase();

      const matchesSearch =
        !query ||
        eventName.includes(query) ||
        venueName.includes(query) ||
        String(event.event_type || event.type || "")
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "All" ||
        normalizeStatus(event.status) === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [events, search, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: events.length,
      scheduled: events.filter(
        (event) => normalizeStatus(event.status) === "Scheduled"
      ).length,
      confirmed: events.filter(
        (event) => normalizeStatus(event.status) === "Confirmed"
      ).length,
      budget: events.reduce(
        (total, event) => total + Number(event.budget || 0),
        0
      ),
    };
  }, [events]);

  function updateFormField(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function openCreateForm() {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM });
    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM });
  }

  function startEditing(event) {
    setEditingEvent(event);

    const eventType = event.event_type || event.type || "";

    setForm({
      name: event.name || "",
      type: eventType,
      customType: "",
      event_date: toDateInput(event.event_date || event.date),
      venue_id:
        event.venue_id == null ? "" : String(event.venue_id),
      budget: String(event.budget ?? ""),
      status: normalizeStatus(event.status),
    });

    setError("");
    setSuccess("");
    setShowForm(true);
  }

  function validateForm() {
    if (!form.name.trim()) return "Please enter an event name.";

    const eventType =
      form.type === "Other" ? form.customType.trim() : form.type.trim();

    if (!eventType) return "Please select or enter an event type.";

    if (!form.event_date) return "Please select an event date.";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.event_date)) {
      return "Please select a valid event date.";
    }

    const parsedDate = new Date(`${form.event_date}T00:00:00`);
    if (
      Number.isNaN(parsedDate.getTime()) ||
      toDateInput(parsedDate) !== form.event_date
    ) {
      return "Please select a valid event date.";
    }

    if (!form.venue_id) return "Please select a registered venue.";

    const selectedVenue = venues.find(
      (venue) => String(venue.id) === String(form.venue_id)
    );

    if (!selectedVenue) {
      return "The selected venue was not found. Refresh the page and select a venue again.";
    }

    if (
      form.budget === "" ||
      !Number.isFinite(Number(form.budget)) ||
      Number(form.budget) < 0
    ) {
      return "Please enter a valid non-negative budget.";
    }

    if (!STATUSES.includes(form.status)) {
      return "Please select a valid event status.";
    }

    return "";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const selectedVenue = venues.find(
      (venue) => String(venue.id) === String(form.venue_id)
    );

    // Send the fields expected by the Express API.
    const payload = {
      name: form.name.trim(),
      event_type:
        form.type === "Other"
          ? form.customType.trim()
          : form.type.trim(),
      event_date: form.event_date,
      venue_id: Number(form.venue_id),
      venue: selectedVenue?.name || "",
      start_time: editingEvent?.start_time || "10:00",
      end_time: editingEvent?.end_time || "16:00",
      attendee_count: Math.max(
        0,
        Math.floor(Number(editingEvent?.attendee_count || 0))
      ),
      budget: Number(form.budget),
      status: form.status,
      resource_ids: Array.isArray(editingEvent?.resource_ids)
        ? editingEvent.resource_ids
        : [],
    };

    if (
      !Number.isInteger(payload.venue_id) ||
      payload.venue_id <= 0
    ) {
      setError("Please select a valid registered venue.");
      return;
    }

    setSaving(true);

    try {
      if (editingEvent) {
        await updateEvent(editingEvent.id, payload);
        setSuccess("Event updated successfully.");
      } else {
        await createEvent(payload);
        setSuccess("Event created successfully.");
      }

      setShowForm(false);
      setEditingEvent(null);
      setForm({ ...EMPTY_FORM });

      await loadDashboard();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Could not save the event. Check the required fields and venue availability."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(event) {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await deleteEvent(event.id);
      setSuccess("Event deleted successfully.");
      await loadDashboard();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete this event."));
    }
  }

  async function handleLogout() {
    try {
      if (typeof logoutUser === "function") {
        await logoutUser();
      }
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      localStorage.removeItem("user");
      localStorage.removeItem("token");

      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    }
  }

  const role = getUserRole(user);
  const canCreate =
    !role ||
    ["admin", "administrator", "organizer"].includes(role);

  return (
    <div className="dashboard-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
        onLogout={handleLogout}
      />

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-eyebrow">EVENTSPHERE WORKSPACE</p>
            <h1>{activePage}</h1>
            <p className="dashboard-subtitle">
              Plan, manage, and keep your events organized.
            </p>
          </div>

          <div className="dashboard-header-actions">
            <span className="dashboard-user">
              {user?.name || user?.full_name || "Welcome"}
            </span>
            <button
              type="button"
              className="dashboard-secondary-button"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </header>

        {error && (
          <div className="dashboard-alert dashboard-alert-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {success && (
          <div className="dashboard-alert dashboard-alert-success" role="status">
            <span>{success}</span>
            <button type="button" onClick={() => setSuccess("")} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}

        {activePage === "Venues" ? (
<Venues user={user} />
        ) : activePage === "Resources" ? (
          <Resources />
        ) : activePage === "Scheduling" ? (
<Scheduling user={user} />
) : (
          <>
            <section className="dashboard-welcome">
              <div>
                <p className="dashboard-eyebrow">YOUR EVENT OVERVIEW</p>
                <h2>Make every event count.</h2>
                <p>
                  Keep track of your events, venues, schedules, and budgets
                  from one place.
                </p>
              </div>

              {canCreate && (
                <button
                  type="button"
                  className="dashboard-primary-button"
                  onClick={openCreateForm}
                >
                  + Create event
                </button>
              )}
            </section>

            <section className="dashboard-stats">
              <StatCard label="Total events" value={stats.total} />
              <StatCard label="Scheduled" value={stats.scheduled} />
              <StatCard label="Confirmed" value={stats.confirmed} />
              <StatCard label="Total budget" value={formatMoney(stats.budget)} />
            </section>

            <section className="dashboard-events-section">
              <div className="dashboard-section-heading">
                <div>
                  <h2>Events</h2>
                  <p>Manage your upcoming and existing events.</p>
                </div>

                <button
                  type="button"
                  className="dashboard-secondary-button"
                  onClick={loadDashboard}
                  disabled={loading}
                >
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div className="dashboard-filters">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search events or venues…"
                  aria-label="Search events"
                />

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter events by status"
                >
                  <option value="All">All statuses</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <div className="dashboard-empty">
                  Loading your events…
                </div>
              ) : visibleEvents.length === 0 ? (
                <div className="dashboard-empty">
                  <h3>No events found</h3>
                  <p>
                    {events.length === 0
                      ? "Create your first event to get started."
                      : "Try changing your search or status filter."}
                  </p>
                  {canCreate && events.length === 0 && (
                    <button
                      type="button"
                      className="dashboard-primary-button"
                      onClick={openCreateForm}
                    >
                      Create your first event
                    </button>
                  )}
                </div>
              ) : (
                <div className="dashboard-event-grid">
                  {visibleEvents.map((event) => {
                    const canManage = canManageEvent(event, user);
                    const status = normalizeStatus(event.status);

                    return (
                      <article className="dashboard-event-card" key={event.id}>
                        <div className="dashboard-event-card-top">
                          <span className={`dashboard-status status-${status.toLowerCase()}`}>
                            {status}
                          </span>
                          <span className="dashboard-event-date">
                            {formatDate(event.event_date || event.date)}
                          </span>
                        </div>

                        <h3>{event.name || "Untitled event"}</h3>

                        <p className="dashboard-event-type">
                          {event.event_type || event.type || "Event"}
                        </p>

                        <div className="dashboard-event-details">
                          <p>
                            <span>Venue</span>
                            <strong>
                              {event.venue_name || event.venue || "Venue not set"}
                            </strong>
                          </p>
                          <p>
                            <span>Budget</span>
                            <strong>{formatMoney(event.budget)}</strong>
                          </p>
                          <p>
                            <span>Attendees</span>
                            <strong>{Number(event.attendee_count || 0)}</strong>
                          </p>
                        </div>

                        {canManage && (
                          <div className="dashboard-card-actions">
                            <button
                              type="button"
                              className="dashboard-secondary-button"
                              onClick={() => startEditing(event)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="dashboard-danger-button"
                              onClick={() => handleDelete(event)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showForm && (
        <div
          className="dashboard-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <section
            className="dashboard-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-form-title"
          >
            <div className="dashboard-modal-heading">
              <div>
                <p className="dashboard-eyebrow">
                  {editingEvent ? "UPDATE DETAILS" : "NEW EVENT"}
                </p>
                <h2 id="event-form-title">
                  {editingEvent ? "Edit event" : "Create an event"}
                </h2>
              </div>
              <button
                type="button"
                className="dashboard-modal-close"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close event form"
              >
                ×
              </button>
            </div>

            <form className="dashboard-event-form" onSubmit={handleSubmit}>
              <label>
                Event name
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) =>
                    updateFormField("name", event.target.value)
                  }
                  placeholder="e.g. Annual Tech Summit"
                  maxLength={150}
                  required
                />
              </label>

              <label>
                Event type
                <select
                  value={form.type}
                  onChange={(event) => {
                    updateFormField("type", event.target.value);
                    if (event.target.value !== "Other") {
                      updateFormField("customType", "");
                    }
                  }}
                  required
                >
                  <option value="">Choose an event type</option>
                  {EVENT_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {type}
                    </option>
                  ))}
                  {form.type &&
                    !EVENT_TYPES.includes(form.type) && (
                      <option value={form.type}>{form.type}</option>
                    )}
                </select>
              </label>

              {form.type === "Other" && (
                <label>
                  Specify event type
                  <input
                    type="text"
                    value={form.customType}
                    onChange={(event) =>
                      updateFormField("customType", event.target.value)
                    }
                    placeholder="Enter event type"
                    required
                  />
                </label>
              )}

              <label>
                Event date
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(event) =>
                    updateFormField("event_date", event.target.value)
                  }
                  required
                />
              </label>

              <label>
                Registered venue
                <select
                  value={form.venue_id}
                  onChange={(event) =>
                    updateFormField("venue_id", event.target.value)
                  }
                  required
                >
                  <option value="">Select a venue</option>
                  {venues.map((venue) => (
                    <option value={String(venue.id)} key={venue.id}>
                      {venue.name}
                      {venue.city ? ` — ${venue.city}` : ""}
                    </option>
                  ))}
                </select>
                {venues.length === 0 && (
                  <small>
                    No venues found. Add a venue first from the Venues page.
                  </small>
                )}
              </label>

              <label>
                Budget (₹)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.budget}
                  onChange={(event) =>
                    updateFormField("budget", event.target.value)
                  }
                  placeholder="e.g. 25000"
                  required
                />
              </label>

              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) =>
                    updateFormField("status", event.target.value)
                  }
                  required
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <p className="dashboard-form-note">
                New events use a default time of 10:00 AM–4:00 PM and zero
                attendees. You can adjust scheduling details on the Scheduling
                page.
              </p>

              {error && (
                <div className="dashboard-alert dashboard-alert-error" role="alert">
                  {error}
                </div>
              )}

              <div className="dashboard-form-actions">
                <button
                  type="button"
                  className="dashboard-secondary-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="dashboard-primary-button"
                  disabled={saving || venues.length === 0}
                >
                  {saving
                    ? "Saving…"
                    : editingEvent
                      ? "Save changes"
                      : "Create event"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <article className="dashboard-stat-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}
