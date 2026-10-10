
import { useCallback, useEffect, useState } from "react";
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  logoutUser,
} from "./api";
import Sidebar from "./Sidebar";
import "./Dashboard.css";

const emptyForm = {
  name: "",
  type: "",
  event_date: "",
  venue: "",
  budget: "0",
  status: "Planned",
};

const statuses = [
  "Planned",
  "Upcoming",
  "Ongoing",
  "Completed",
  "Cancelled",
];

function formatDate(value) {
  if (!value) return "Not scheduled";

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function getStatusClass(status) {
  return String(status || "Planned")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

export default function Dashboard({ user, onLogout }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState({ ...emptyForm });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const canCreate =
    user.role === "Admin" || user.role === "Organizer";

  const canManageEvent = (event) =>
    user.role === "Admin" ||
    (user.role === "Organizer" &&
      Number(event.organizer_id) === Number(user.id));

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await getEvents();
      setEvents(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  function handleEditChange(event) {
    const { name, value } = event.target;
    setEditForm((previous) => ({ ...previous, [name]: value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await createEvent({
        ...form,
        budget: Number(form.budget),
      });

      setForm({ ...emptyForm });
      setShowForm(false);
      await loadEvents();
      setNotice("Event created successfully.");
    } catch (err) {
      setError(err.message || "Could not create event.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(event) {
    setEditingEvent(event);
    setEditForm({
      name: event.name || "",
      type: event.type || "",
      event_date: event.event_date
        ? String(event.event_date).slice(0, 10)
        : "",
      venue: event.venue || "",
      budget: String(event.budget ?? 0),
      status: event.status || "Planned",
    });

    setShowForm(false);
    setError("");
    setNotice("");
  }

  async function handleUpdateEvent(event) {
    event.preventDefault();
    if (!editingEvent) return;

    setSavingEdit(true);
    setError("");
    setNotice("");

    try {
      await updateEvent(editingEvent.id, {
        ...editForm,
        budget: Number(editForm.budget),
      });

      setEditingEvent(null);
      await loadEvents();
      setNotice("Event updated successfully.");
    } catch (err) {
      setError(err.message || "Could not update event.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteEvent(event) {
    const confirmed = window.confirm(
      `Delete "${event.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(event.id);
    setError("");
    setNotice("");

    try {
      await deleteEvent(event.id);

      if (editingEvent?.id === event.id) {
        setEditingEvent(null);
      }

      await loadEvents();
      setNotice("Event deleted successfully.");
    } catch (err) {
      setError(err.message || "Could not delete event.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleLogout() {
    logoutUser();
    onLogout();
  }

  const query = search.trim().toLowerCase();

  const visibleEvents = events.filter((event) => {
    const matchesSearch =
      !query ||
      [
        event.name,
        event.type,
        event.venue,
        event.status,
        event.organizer_name,
      ].some((value) =>
        String(value || "").toLowerCase().includes(query)
      );

    const matchesStatus =
      statusFilter === "All" ||
      (event.status || "Planned") === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const upcomingCount = events.filter((event) =>
    ["Upcoming", "Planned"].includes(event.status || "Planned")
  ).length;

  const activeCount = events.filter((event) =>
    ["Ongoing", "Active"].includes(event.status || "")
  ).length;

  const venueCount = new Set(
    events
      .map((event) => String(event.venue || "").trim())
      .filter(Boolean)
  ).size;

  const totalBudget = events.reduce(
    (total, event) => total + (Number(event.budget) || 0),
    0
  );

  return (
    <div className="dashboard-layout">
      {/* Sidebar is maintained in Sidebar.jsx */}
      <Sidebar user={user} onLogout={handleLogout} />

      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <div className="topbar-context">
            <span className="context-dot" />
            <span>Workspace overview</span>
          </div>

          <div className="topbar-profile">
            <span className="profile-status" />
            <div className="profile-avatar">
              {(user.name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="profile-text">
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
          </div>
        </header>

        <section className="dashboard-intro">
          <div>
            <p className="dashboard-eyebrow">
              EVENTSPHERE WORKSPACE
            </p>
            <h1>Event Management</h1>
            <p className="intro-description">
              Create, organize, and manage your events efficiently.
            </p>
          </div>

          {canCreate && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setShowForm((previous) => !previous);
                setEditingEvent(null);
                setError("");
                setNotice("");
              }}
            >
              <span aria-hidden="true">＋</span>
              {showForm ? "Cancel" : "Add event"}
            </button>
          )}
        </section>

        <section
          className="dashboard-stats"
          aria-label="Event statistics"
        >
          <article className="stat-card stat-green">
            <div className="stat-icon">▦</div>
            <div className="stat-content">
              <p>Total events</p>
              <strong>{loading ? "…" : events.length}</strong>
              <span>In your workspace</span>
            </div>
          </article>

          <article className="stat-card stat-gold">
            <div className="stat-icon">◷</div>
            <div className="stat-content">
              <p>Planned / upcoming</p>
              <strong>{loading ? "…" : upcomingCount}</strong>
              <span>Ready to organize</span>
            </div>
          </article>

          <article className="stat-card stat-teal">
            <div className="stat-icon">⌖</div>
            <div className="stat-content">
              <p>Venues in use</p>
              <strong>{loading ? "…" : venueCount}</strong>
              <span>Unique event venues</span>
            </div>
          </article>

          <article className="stat-card stat-neutral">
            <div className="stat-icon">₹</div>
            <div className="stat-content">
              <p>Combined budget</p>
              <strong className="budget-stat">
                {loading ? "…" : formatMoney(totalBudget)}
              </strong>
              <span>{activeCount} ongoing event(s)</span>
            </div>
          </article>
        </section>

        {notice && (
          <div className="dashboard-message message-success" role="status">
            <span>✓</span>
            <p>{notice}</p>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div className="dashboard-message message-error" role="alert">
            <span>!</span>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {(showForm || editingEvent) && canCreate && (
          <section className="editor-grid">
            {showForm && (
              <EventForm
                title="Create event"
                subtitle="Add the details for your new event."
                form={form}
                onChange={handleChange}
                onSubmit={handleCreate}
                onCancel={() => setShowForm(false)}
                saving={saving}
                submitLabel="Save event"
                prefix="create"
              />
            )}

            {editingEvent && (
              <EventForm
                title="Edit event"
                subtitle={`Updating: ${editingEvent.name}`}
                form={editForm}
                onChange={handleEditChange}
                onSubmit={handleUpdateEvent}
                onCancel={() => setEditingEvent(null)}
                saving={savingEdit}
                submitLabel="Update event"
                prefix="edit"
              />
            )}
          </section>
        )}

        <section className="events-section" id="events">
          <div className="events-heading">
            <div>
              <h2>All events</h2>
              <p>Keep track of your events and their current status.</p>
            </div>

            <div className="event-filters">
              <label className="filter-search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Filter events by keyword"
                  placeholder="Filter events"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <select
                aria-label="Filter by event status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="All">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="button button-outline"
                onClick={loadEvents}
                disabled={loading}
              >
                {loading ? "Loading..." : "↻ Refresh"}
              </button>
            </div>
          </div>

          <div className="events-table-wrap">
            {loading ? (
              <div className="dashboard-empty">
                <span className="loading-spinner" />
                <p>Loading your events...</p>
              </div>
            ) : visibleEvents.length === 0 ? (
              <div className="dashboard-empty">
                <div className="empty-icon">▦</div>
                <h3>
                  {events.length === 0
                    ? "No events yet"
                    : "No matching events"}
                </h3>
                <p>
                  {events.length === 0
                    ? canCreate
                      ? "Create your first event to get started."
                      : "Events will appear here when they become available."
                    : "Try a different search term or status filter."}
                </p>

                {canCreate && events.length === 0 && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setShowForm(true)}
                  >
                    ＋ Create your first event
                  </button>
                )}
              </div>
            ) : (
              <table className="events-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Event name</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Venue</th>
                    <th>Budget (₹)</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleEvents.map((event, index) => (
                    <tr key={event.id}>
                      <td className="row-number">{index + 1}</td>

                      <td>
                        <div className="table-event-name">
                          <span className="event-mini-icon">✦</span>
                          <strong>{event.name}</strong>
                        </div>
                      </td>

                      <td>{event.type || "General"}</td>
                      <td>{formatDate(event.event_date)}</td>
                      <td>{event.venue || "Not set"}</td>
                      <td className="budget-cell">
                        {formatMoney(event.budget)}
                      </td>

                      <td>
                        <span
                          className={`status-badge status-${getStatusClass(
                            event.status
                          )}`}
                        >
                          {event.status || "Planned"}
                        </span>
                      </td>

                      <td>
                        {canManageEvent(event) ? (
                          <div className="table-actions">
                            <button
                              type="button"
                              className="icon-button edit-action"
                              title="Edit event"
                              aria-label={`Edit ${event.name}`}
                              onClick={() => startEditing(event)}
                            >
                              ✎
                            </button>

                            <button
                              type="button"
                              className="icon-button delete-action"
                              title="Delete event"
                              aria-label={`Delete ${event.name}`}
                              disabled={deletingId === event.id}
                              onClick={() => handleDeleteEvent(event)}
                            >
                              {deletingId === event.id ? "…" : "×"}
                            </button>
                          </div>
                        ) : (
                          <span className="muted-action">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && visibleEvents.length > 0 && (
            <footer className="table-footer">
              <span>
                Showing {visibleEvents.length} of {events.length} event(s)
              </span>
              <span className="table-footer-note">
                EventSphere · Your events, organized
              </span>
            </footer>
          )}
        </section>

        <footer className="dashboard-footer">
          <span>© {new Date().getFullYear()} EventSphere</span>
          <span>Plan thoughtfully. Make every moment count.</span>
        </footer>
      </main>
    </div>
  );
}

function EventForm({
  title,
  subtitle,
  form,
  onChange,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
  prefix,
}) {
  return (
    <form className="event-editor" onSubmit={onSubmit}>
      <div className="editor-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>

        <button
          type="button"
          className="editor-close"
          onClick={onCancel}
          aria-label="Close event form"
        >
          ×
        </button>
      </div>

      <div className="editor-fields">
        <div className="editor-field">
          <label htmlFor={`${prefix}-name`}>Event name *</label>
          <input
            id={`${prefix}-name`}
            name="name"
            value={form.name}
            onChange={onChange}
            placeholder="e.g. Annual Cultural Fest"
            required
          />
        </div>

        <div className="editor-field">
          <label htmlFor={`${prefix}-type`}>Event type</label>
          <input
            id={`${prefix}-type`}
            name="type"
            value={form.type}
            onChange={onChange}
            placeholder="Conference, Workshop..."
          />
        </div>

        <div className="editor-field">
          <label htmlFor={`${prefix}-date`}>Event date</label>
          <input
            id={`${prefix}-date`}
            type="date"
            name="event_date"
            value={form.event_date}
            onChange={onChange}
          />
        </div>

        <div className="editor-field">
          <label htmlFor={`${prefix}-venue`}>Venue</label>
          <input
            id={`${prefix}-venue`}
            name="venue"
            value={form.venue}
            onChange={onChange}
            placeholder="Enter venue"
          />
        </div>

        <div className="editor-field">
          <label htmlFor={`${prefix}-budget`}>Budget (₹)</label>
          <input
            id={`${prefix}-budget`}
            type="number"
            name="budget"
            min="0"
            step="0.01"
            value={form.budget}
            onChange={onChange}
          />
        </div>

        <div className="editor-field">
          <label htmlFor={`${prefix}-status`}>Status</label>
          <select
            id={`${prefix}-status`}
            name="status"
            value={form.status}
            onChange={onChange}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="editor-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="button button-primary"
          disabled={saving}
        >
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
