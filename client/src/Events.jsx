
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getVenues,
} from "./api";

import "./Events.css";

const STATUSES = ["Scheduled", "Confirmed", "Pending", "Cancelled"];

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

const EMPTY_FORM = {
  name: "",
  type: "",
  customType: "",
  event_date: "",
  venue_id: "",
  budget: "",
  status: "Scheduled",
};

/* -------------------- Helpers -------------------- */

function getArray(data, keys = []) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(data?.data?.[key])) return data.data[key];
  }

  return [];
}

function getId(item) {
  const id =
    item?.id ??
    item?._id ??
    item?.event_id ??
    item?.venue_id;

  return id == null ? "" : String(id);
}

function getErrorMessage(error, fallback) {
  const message = error?.message;

  return typeof message === "string" && message.trim()
    ? message
    : fallback;
}

function normalizeStatus(status) {
  const value = String(status || "Scheduled")
    .trim()
    .toLowerCase();

  if (["planned", "upcoming", "scheduled"].includes(value)) {
    return "Scheduled";
  }

  if (["confirmed", "ongoing", "completed", "active"].includes(value)) {
    return "Confirmed";
  }

  if (value === "pending") return "Pending";

  if (["cancelled", "canceled"].includes(value)) {
    return "Cancelled";
  }

  return "Scheduled";
}

function toDateInput(value) {
  if (!value) return "";

  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

  if (match) return match[1];

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatMoney(value) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value) {
  if (!value) return "Date not set";

  const dateString = String(value).slice(0, 10);

  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? (() => {
        const [year, month, day] = dateString.split("-").map(Number);
        return new Date(year, month - 1, day);
      })()
    : new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getUserRole(user) {
  return String(user?.role ?? user?.user?.role ?? "")
    .trim()
    .toLowerCase();
}

function getUserId(user) {
  const id =
    user?.id ??
    user?._id ??
    user?.user_id ??
    user?.user?.id ??
    user?.user?._id;

  return id == null ? null : String(id);
}

function getEventOwnerId(event) {
  const owner =
    event?.organizer_id ??
    event?.organizerId ??
    event?.created_by ??
    event?.user_id ??
    event?.owner_id ??
    event?.organizer ??
    event?.createdBy;

  if (owner && typeof owner === "object") {
    const id = owner.id ?? owner._id;
    return id == null ? null : String(id);
  }

  return owner == null ? null : String(owner);
}

function canManageEvent(event, user) {
  const role = getUserRole(user);

  if (["admin", "administrator"].includes(role)) {
    return true;
  }

  if (role !== "organizer") {
    return false;
  }

  const ownerId = getEventOwnerId(event);
  const userId = getUserId(user);

  return ownerId != null && userId != null && ownerId === userId;
}

function getEventVenueId(event) {
  const value =
    event?.venue_id ??
    event?.venueId ??
    event?.venue?.id ??
    event?.venue?._id;

  return value == null ? "" : String(value);
}

function getVenueDisplayName(venue) {
  const name = venue?.name ?? venue?.venue_name ?? "Unnamed venue";

  return venue?.city ? `${name} — ${venue.city}` : name;
}

function getEventName(event) {
  return (
    event?.name ??
    event?.title ??
    event?.event_name ??
    "Untitled event"
  );
}

function getEventType(event) {
  return event?.event_type ?? event?.type ?? "Event";
}

function getEventDate(event) {
  return event?.event_date ?? event?.date ?? event?.start_date;
}

function getEventVenueName(event) {
  const name =
    event?.venue_name ??
    event?.venue?.name ??
    (typeof event?.venue === "string" ? event.venue : "");

  return name || "Venue not set";
}

/* -------------------- Events Component -------------------- */

export default function Events({ user }) {
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const role = getUserRole(user);

  const canCreate = [
    "admin",
    "administrator",
    "organizer",
  ].includes(role);

  /* -------------------- Load Events and Venues -------------------- */

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [eventsResult, venuesResult] = await Promise.all([
        getEvents(),
        getVenues(),
      ]);

      setEvents(getArray(eventsResult, ["events", "items"]));
      setVenues(getArray(venuesResult, ["venues", "items"]));
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load events. Check that the Python backend is running."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  /* -------------------- Search and Filter -------------------- */

  const visibleEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return events.filter((event) => {
      const eventName = String(getEventName(event)).toLowerCase();

      const venueName = String(getEventVenueName(event)).toLowerCase();

      const eventType = String(getEventType(event)).toLowerCase();

      const matchesSearch =
        !query ||
        eventName.includes(query) ||
        venueName.includes(query) ||
        eventType.includes(query);

      const matchesStatus =
        statusFilter === "All" ||
        normalizeStatus(event?.status) === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [events, search, statusFilter]);

  /* -------------------- Form Helpers -------------------- */

  function updateFormField(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
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
    const eventType = event?.event_type ?? event?.type ?? "";
    const isStandardType = EVENT_TYPES.includes(eventType);

    setEditingEvent(event);

    setForm({
      name: event?.name ?? event?.title ?? event?.event_name ?? "",
      type: isStandardType ? eventType : "Other",
      customType: isStandardType ? "" : eventType,
      event_date: toDateInput(getEventDate(event)),
      venue_id: getEventVenueId(event),
      budget: String(event?.budget ?? ""),
      status: normalizeStatus(event?.status),
    });

    setError("");
    setSuccess("");
    setShowForm(true);
  }

  /* -------------------- Validation -------------------- */

  function validateForm() {
    if (!form.name.trim()) {
      return "Please enter an event name.";
    }

    const eventType =
      form.type === "Other"
        ? form.customType.trim()
        : form.type.trim();

    if (!eventType) {
      return "Please select or enter an event type.";
    }

    if (!form.event_date) {
      return "Please select an event date.";
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.event_date)) {
      return "Please select a valid event date.";
    }

    const [year, month, day] = form.event_date.split("-").map(Number);
    const parsedDate = new Date(year, month - 1, day);

    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      return "Please select a valid event date.";
    }

    if (!form.venue_id) {
      return "Please select a registered venue.";
    }

    const selectedVenue = venues.find(
      (venue) => getId(venue) === String(form.venue_id)
    );

    if (!selectedVenue) {
      return "The selected venue was not found. Refresh and select it again.";
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

  /* -------------------- Create / Update Event -------------------- */

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
      (venue) => getId(venue) === String(form.venue_id)
    );

    const payload = {
      name: form.name.trim(),
      event_type:
        form.type === "Other"
          ? form.customType.trim()
          : form.type.trim(),
      event_date: form.event_date,
      venue_id: String(form.venue_id),
      venue: selectedVenue?.name ?? selectedVenue?.venue_name ?? "",
      start_time: editingEvent?.start_time ?? "10:00",
      end_time: editingEvent?.end_time ?? "16:00",
      attendee_count: Math.max(
        0,
        Math.floor(Number(editingEvent?.attendee_count ?? 0))
      ),
      budget: Number(form.budget),
      status: form.status,
      resource_ids: Array.isArray(editingEvent?.resource_ids)
        ? editingEvent.resource_ids
        : [],
    };

    setSaving(true);

    try {
      if (editingEvent) {
        const eventId = getId(editingEvent);

        if (!eventId) {
          throw new Error(
            "Cannot update this event because its ID is missing."
          );
        }

        await updateEvent(eventId, payload);
        setSuccess("Event updated successfully.");
      } else {
        await createEvent(payload);
        setSuccess("Event created successfully.");
      }

      setShowForm(false);
      setEditingEvent(null);
      setForm({ ...EMPTY_FORM });

      await loadEvents();
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

  /* -------------------- Delete Event -------------------- */

  async function handleDelete(event) {
    if (!canManageEvent(event, user)) {
      setError("You do not have permission to delete this event.");
      return;
    }

    const eventId = getId(event);

    if (!eventId) {
      setError("Cannot delete this event because its ID is missing.");
      return;
    }

    if (
      !window.confirm(
        `Delete "${getEventName(event)}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setError("");
    setSuccess("");
    setDeletingId(eventId);

    try {
      await deleteEvent(eventId);
      setSuccess("Event deleted successfully.");
      await loadEvents();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete this event."));
    } finally {
      setDeletingId(null);
    }
  }

  /* -------------------- Render -------------------- */

  return (
    <section className="events-page">
      <header className="events-page-header">
        <div>
          <p className="events-eyebrow">EVENT MANAGEMENT</p>
          <h2>Events</h2>
          <p>Plan, organize, and track all your events in one place.</p>
        </div>

        {canCreate && (
          <button
            type="button"
            className="events-primary-button"
            onClick={openCreateForm}
          >
            + Create event
          </button>
        )}
      </header>

      {error && (
        <div className="events-alert events-alert-error" role="alert">
          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {success && (
        <div className="events-alert events-alert-success" role="status">
          <span>{success}</span>

          <button
            type="button"
            onClick={() => setSuccess("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      <section className="events-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search events, venues, or types..."
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

        <button
          type="button"
          className="events-secondary-button"
          onClick={loadEvents}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {loading ? (
        <div className="events-empty">Loading events...</div>
      ) : visibleEvents.length === 0 ? (
        <div className="events-empty">
          <h3>No events found</h3>

          <p>
            {events.length === 0
              ? "Create your first event to get started."
              : "Try changing your search or status filter."}
          </p>

          {canCreate && events.length === 0 && (
            <button
              type="button"
              className="events-primary-button"
              onClick={openCreateForm}
            >
              Create your first event
            </button>
          )}
        </div>
      ) : (
        <div className="events-grid">
          {visibleEvents.map((event, index) => {
            const eventId =
              getId(event) || `${getEventName(event)}-${index}`;

            const canManage = canManageEvent(event, user);
            const status = normalizeStatus(event.status);

            return (
              <article className="events-card" key={eventId}>
                <div className="events-card-top">
                  <span
                    className={`events-status status-${status.toLowerCase()}`}
                  >
                    {status}
                  </span>

                  <span className="events-card-date">
                    {formatDate(getEventDate(event))}
                  </span>
                </div>

                <h3>{getEventName(event)}</h3>

                <p className="events-card-type">{getEventType(event)}</p>

                <div className="events-card-details">
                  <p>
                    <span>Venue</span>
                    <strong>{getEventVenueName(event)}</strong>
                  </p>

                  <p>
                    <span>Budget</span>
                    <strong>{formatMoney(event?.budget)}</strong>
                  </p>

                  <p>
                    <span>Attendees</span>
                    <strong>
                      {Number(event?.attendee_count ?? 0)}
                    </strong>
                  </p>
                </div>

                {canManage && (
                  <div className="events-card-actions">
                    <button
                      type="button"
                      className="events-secondary-button"
                      onClick={() => startEditing(event)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="events-danger-button"
                      onClick={() => handleDelete(event)}
                      disabled={deletingId === getId(event)}
                    >
                      {deletingId === getId(event)
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* -------------------- Create / Edit Modal -------------------- */}

      {showForm && (
        <div
          className="events-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeForm();
            }
          }}
        >
          <section
            className="events-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="events-form-title"
          >
            <div className="events-modal-heading">
              <div>
                <p className="events-eyebrow">
                  {editingEvent ? "UPDATE DETAILS" : "NEW EVENT"}
                </p>

                <h2 id="events-form-title">
                  {editingEvent ? "Edit event" : "Create an event"}
                </h2>
              </div>

              <button
                type="button"
                className="events-modal-close"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close event form"
              >
                ×
              </button>
            </div>

            <form className="events-form" onSubmit={handleSubmit}>
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
                    const value = event.target.value;

                    setForm((previous) => ({
                      ...previous,
                      type: value,
                      customType:
                        value === "Other" ? previous.customType : "",
                    }));
                  }}
                  required
                >
                  <option value="">Choose an event type</option>

                  {EVENT_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {type}
                    </option>
                  ))}
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
                    maxLength={100}
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

                  {venues.map((venue, index) => {
                    const venueId = getId(venue);

                    return (
                      <option
                        value={venueId}
                        key={venueId || `venue-${index}`}
                      >
                        {getVenueDisplayName(venue)}
                      </option>
                    );
                  })}
                </select>

                {venues.length === 0 && (
                  <small>Add a venue from the Venues page first.</small>
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

              <p className="events-form-note">
                New events use a default time of 10:00 AM–4:00 PM and zero
                attendees. Adjust scheduling details on the Scheduling page.
              </p>

              <div className="events-form-actions">
                <button
                  type="button"
                  className="events-secondary-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="events-primary-button"
                  disabled={saving || venues.length === 0}
                >
                  {saving
                    ? "Saving..."
                    : editingEvent
                      ? "Save changes"
                      : "Create event"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}