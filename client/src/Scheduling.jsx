
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getVenues,
  getResources,
} from "./api";
import "./Scheduling.css";

const EVENT_TYPES = [
  "Conference",
  "Social",
  "Business",
  "Internal",
  "Education",
  "Wedding",
  "Workshop",
  "Charity",
  "Other",
];

const EVENT_STATUSES = ["Scheduled", "Confirmed", "Pending", "Cancelled"];

const EMPTY_FORM = {
  name: "",
  event_type: "Conference",
  event_date: "",
  start_time: "10:00",
  end_time: "16:00",
  venue_id: "",
  attendee_count: "100",
  status: "Scheduled",
  resource_ids: [],
};

const PAGE_SIZE = 5;
const pad = (value) => String(value).padStart(2, "0");

function todayString() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getArray(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getId(item) {
  const id = item?.id ?? item?._id ?? item?.event_id ?? item?.venue_id ?? item?.resource_id;
  return id == null ? "" : String(id);
}

function eventName(event) {
  return event?.name ?? event?.event_name ?? "Untitled event";
}

function eventType(event) {
  return event?.event_type ?? event?.type ?? "Other";
}

function eventDate(event) {
  return String(event?.event_date ?? event?.date ?? "").slice(0, 10);
}

function eventStatus(event) {
  return event?.status ?? "Scheduled";
}

function eventVenueId(event) {
  const id = event?.venue_id ?? event?.venueId;
  return id == null ? "" : String(id);
}

function eventResourceIds(event) {
  return Array.isArray(event?.resource_ids)
    ? event.resource_ids.map(String)
    : [];
}

function formatDate(value) {
  if (!value) return "Not scheduled";

  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMonth(date) {
  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "—";

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value);

  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function timeRange(event) {
  return `${formatTime(event?.start_time)} – ${formatTime(event?.end_time)}`;
}

function minutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return NaN;

  const hours = Number(match[1]);
  const mins = Number(match[2]);

  if (hours > 23 || mins > 59) return NaN;

  return hours * 60 + mins;
}

function overlaps(startA, endA, startB, endB) {
  const a = minutes(startA);
  const b = minutes(endA);
  const c = minutes(startB);
  const d = minutes(endB);

  if ([a, b, c, d].some(Number.isNaN)) return false;

  return a < d && c < b;
}

function isCancelled(event) {
  return String(eventStatus(event)).toLowerCase() === "cancelled";
}

function calendarDays(year, month) {
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells = Array(firstDay).fill(null);

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(day);
  }

  while (cells.length % 7) {
    cells.push(null);
  }

  return cells;
}

function statusClass(status) {
  return String(status || "Scheduled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

export default function Scheduling({ user }) {
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [resources, setResources] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showForm, setShowForm] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [page, setPage] = useState(1);

  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    event_date: todayString(),
  }));

  const [calendarDate, setCalendarDate] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });

  const [selectedDate, setSelectedDate] = useState(todayString());

  const userRole = String(user?.role ?? user?.user?.role ?? "")
    .trim()
    .toLowerCase();

  const canManage = ["admin", "administrator", "organizer"].includes(userRole);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      getEvents(),
      getVenues(),
      getResources(),
    ]);

    const failures = [];

    if (results[0].status === "fulfilled") {
      setEvents(getArray(results[0].value, "events"));
    } else {
      failures.push(
        `Events: ${results[0].reason?.message || "Unable to load events."}`
      );
    }

    if (results[1].status === "fulfilled") {
      setVenues(getArray(results[1].value, "venues"));
    } else {
      setVenues([]);
      failures.push(
        `Venues: ${results[1].reason?.message || "Unable to load venues."}`
      );
    }

    if (results[2].status === "fulfilled") {
      setResources(getArray(results[2].value, "resources"));
    } else {
      setResources([]);
      failures.push(
        `Resources: ${results[2].reason?.message || "Unable to load resources."}`
      );
    }

    if (failures.length) setError(failures.join(" "));

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => getId(venue) === String(form.venue_id)),
    [venues, form.venue_id]
  );

  const venueCapacity = Number(selectedVenue?.capacity) || 0;
  const attendeeCount = Number(form.attendee_count);

  const venueConflict = useMemo(() => {
    if (!form.event_date || !form.venue_id) return false;

    return events.some((event) => {
      if (isCancelled(event)) return false;

      if (
        editingId !== null &&
        editingId !== undefined &&
        getId(event) === String(editingId)
      ) {
        return false;
      }

      return (
        eventDate(event) === form.event_date &&
        eventVenueId(event) === String(form.venue_id) &&
        overlaps(
          event.start_time,
          event.end_time,
          form.start_time,
          form.end_time
        )
      );
    });
  }, [events, form, editingId]);

  const validTime =
    Number.isFinite(minutes(form.start_time)) &&
    Number.isFinite(minutes(form.end_time)) &&
    minutes(form.start_time) < minutes(form.end_time);

  const capacityExceeded =
    Boolean(selectedVenue) &&
    Number.isFinite(attendeeCount) &&
    attendeeCount > venueCapacity;

  const available =
    Boolean(form.name.trim()) &&
    Boolean(form.event_date) &&
    Boolean(form.venue_id) &&
    Boolean(selectedVenue) &&
    validTime &&
    Number.isInteger(attendeeCount) &&
    attendeeCount >= 0 &&
    !venueConflict &&
    !capacityExceeded;

  const calendarYear = calendarDate.getFullYear();
  const calendarMonth = calendarDate.getMonth();

  const cells = useMemo(
    () => calendarDays(calendarYear, calendarMonth),
    [calendarYear, calendarMonth]
  );

  const eventsForSelectedDate = useMemo(
    () => events.filter((event) => eventDate(event) === selectedDate),
    [events, selectedDate]
  );

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return events
      .filter((event) => {
        if (
          statusFilter !== "All" &&
          String(eventStatus(event)).toLowerCase() !== statusFilter.toLowerCase()
        ) {
          return false;
        }

        if (!query) return true;

        const venue = venues.find(
          (item) => getId(item) === eventVenueId(event)
        );

        const values = [
          eventName(event),
          eventType(event),
          eventStatus(event),
          event?.venue_name,
          typeof event?.venue === "string" ? event.venue : event?.venue?.name,
          venue?.name,
          eventDate(event),
        ];

        return values.some((value) =>
          String(value ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) =>
        `${eventDate(a)}${a.start_time || ""}`.localeCompare(
          `${eventDate(b)}${b.start_time || ""}`
        )
      );
  }, [events, venues, search, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredEvents.length / PAGE_SIZE)
  );

  const visibleEvents = filteredEvents.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const activeEvents = events.filter((event) => !isCancelled(event));

  const confirmedEvents = events.filter(
    (event) => String(eventStatus(event)).toLowerCase() === "confirmed"
  );

  function setField(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setAvailabilityChecked(false);
    setError("");
    setNotice("");
  }

  function openNewForm(date = selectedDate) {
    if (!canManage) {
      setError("Only Admins and Organizers can schedule events.");
      return;
    }

    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      event_date: date || todayString(),
    });
    setAvailabilityChecked(false);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function openEditForm(event) {
    if (!canManage) return;

    const id = getId(event);

    if (!id) {
      setError("This event has no valid ID and cannot be edited.");
      return;
    }

    const date = eventDate(event);

    setEditingId(id);
    setForm({
      ...EMPTY_FORM,
      name: eventName(event),
      event_type: eventType(event),
      event_date: date,
      start_time: String(event.start_time || "10:00").slice(0, 5),
      end_time: String(event.end_time || "16:00").slice(0, 5),
      venue_id: eventVenueId(event),
      attendee_count: String(event.attendee_count ?? 0),
      status: eventStatus(event),
      resource_ids: eventResourceIds(event),
    });

    setSelectedDate(date || todayString());

    if (date) {
      const parsedDate = new Date(`${date}T12:00:00`);

      if (!Number.isNaN(parsedDate.getTime())) {
        setCalendarDate(
          new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1)
        );
      }
    }

    setAvailabilityChecked(false);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setAvailabilityChecked(false);
  }

  function checkAvailability() {
    setError("");
    setNotice("");
    setAvailabilityChecked(false);

    if (!form.name.trim()) {
      setError("Enter an event name.");
      return;
    }

    if (!form.event_date) {
      setError("Choose an event date.");
      return;
    }

    if (!form.venue_id || !selectedVenue) {
      setError("Select a valid venue.");
      return;
    }

    if (!validTime) {
      setError("End time must be later than start time.");
      return;
    }

    if (!Number.isInteger(attendeeCount) || attendeeCount < 0) {
      setError("Attendee count must be a non-negative whole number.");
      return;
    }

    if (capacityExceeded) {
      setError(`This venue can accommodate ${venueCapacity} guests.`);
      return;
    }

    if (venueConflict) {
      setError("This venue already has an event during that time.");
      return;
    }

    setAvailabilityChecked(true);
    setNotice("No scheduling conflict was found in the currently loaded events.");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canManage) {
      setError("You do not have permission to schedule events.");
      return;
    }

    if (saving) return;

    setError("");
    setNotice("");

    if (!available) {
      setError(
        venueConflict
          ? "This venue is already booked during that time."
          : capacityExceeded
            ? "Attendee count exceeds the venue capacity."
            : "Please complete the required fields and check the event details."
      );
      return;
    }

    // Keep MongoDB ObjectIds as strings.
    const payload = {
      name: form.name.trim(),
      event_type: form.event_type,
      event_date: form.event_date,
      start_time: form.start_time,
      end_time: form.end_time,
      venue_id: String(form.venue_id),
      attendee_count: attendeeCount,
      status: form.status,
      resource_ids: form.resource_ids.map(String),
    };

    setSaving(true);

    try {
      if (editingId !== null && editingId !== undefined) {
        await updateEvent(editingId, payload);
        setNotice("Event schedule updated successfully.");
      } else {
        await createEvent(payload);
        setNotice("Event scheduled successfully.");
      }

      const savedDate = form.event_date;
      setSelectedDate(savedDate);

      const date = new Date(`${savedDate}T12:00:00`);

      if (!Number.isNaN(date.getTime())) {
        setCalendarDate(new Date(date.getFullYear(), date.getMonth(), 1));
      }

      setShowForm(false);
      setEditingId(null);
      setAvailabilityChecked(false);

      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to save the event schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(event) {
    if (!canManage) {
      setError("You do not have permission to delete events.");
      return;
    }

    const id = getId(event);

    if (!id) {
      setError("This event does not have a valid ID.");
      return;
    }

    if (
      !window.confirm(
        `Delete "${eventName(event)}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(id);
    setError("");
    setNotice("");

    try {
      await deleteEvent(id);
      setNotice(`"${eventName(event)}" was deleted.`);
      await loadData();
    } catch (err) {
      setError(err?.message || "Unable to delete this event.");
    } finally {
      setDeletingId(null);
    }
  }

  function selectDay(day) {
    if (!day) return;

    const date = `${calendarYear}-${pad(calendarMonth + 1)}-${pad(day)}`;

    setSelectedDate(date);

    if (showForm) {
      setForm((previous) => ({
        ...previous,
        event_date: date,
      }));
      setAvailabilityChecked(false);
      setError("");
      setNotice("");
    }
  }

  function dayEvents(day) {
    if (!day) return [];

    const date = `${calendarYear}-${pad(calendarMonth + 1)}-${pad(day)}`;

    return events.filter(
      (event) => eventDate(event) === date && !isCancelled(event)
    );
  }

  return (
    <main className="scheduling-page">
      <header className="scheduling-topbar">
        <div className="scheduling-title-block">
          <p className="scheduling-eyebrow">EVENTSPHERE WORKSPACE</p>
          <h1>Event Scheduling</h1>
          <p className="scheduling-subtitle">
            Schedule your events by selecting a date, time and venue.
            Check for conflicts and availability before confirming.
          </p>
        </div>

        <div className="scheduling-header-actions">
          <button
            type="button"
            className="schedule-btn schedule-btn-light"
            onClick={loadData}
            disabled={loading}
          >
            ↻ {loading ? "Loading..." : "Refresh"}
          </button>

          <button
            type="button"
            className="schedule-btn schedule-btn-primary"
            onClick={() => openNewForm(selectedDate)}
          >
            + Add Schedule
          </button>

          {canManage && showForm && (
            <button
              type="button"
              className="schedule-btn schedule-btn-light"
              onClick={closeForm}
              disabled={saving}
            >
              × Close form
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className="schedule-alert schedule-alert-success" role="status">
          <span>✓</span>
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="schedule-alert schedule-alert-error" role="alert">
          <span>!</span>
          <p>{error}</p>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <section className="scheduling-main-grid">
        {showForm && canManage ? (
          <form
            className="schedule-panel schedule-create-panel"
            onSubmit={handleSubmit}
          >
            <div className="schedule-panel-heading">
              <div>
                <span className="schedule-section-label">
                  {editingId !== null ? "EDIT SCHEDULE" : "EVENT DETAILS"}
                </span>
                <h2>
                  {editingId !== null
                    ? "Update Event"
                    : "Create New Event Schedule"}
                </h2>
              </div>

              <button
                type="button"
                className="schedule-icon-btn"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            <div className="schedule-form-grid">
              <label className="schedule-field schedule-field-wide">
                <span>Event Name <b>*</b></span>
                <input
                  name="name"
                  value={form.name}
                  onChange={setField}
                  placeholder="e.g. Tech Conference 2026"
                  maxLength={150}
                  required
                />
              </label>

              <label className="schedule-field">
                <span>Event Type <b>*</b></span>
                <select
                  name="event_type"
                  value={form.event_type}
                  onChange={setField}
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>

              <label className="schedule-field">
                <span>Status</span>
                <select
                  name="status"
                  value={form.status}
                  onChange={setField}
                >
                  {EVENT_STATUSES.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>

              <label className="schedule-field">
                <span>Date <b>*</b></span>
                <input
                  type="date"
                  name="event_date"
                  value={form.event_date}
                  onChange={setField}
                  required
                />
              </label>

              <label className="schedule-field">
                <span>Attendees <b>*</b></span>
                <input
                  type="number"
                  name="attendee_count"
                  min="0"
                  step="1"
                  value={form.attendee_count}
                  onChange={setField}
                  required
                />
              </label>

              <label className="schedule-field">
                <span>Start Time <b>*</b></span>
                <input
                  type="time"
                  name="start_time"
                  value={form.start_time}
                  onChange={setField}
                  required
                />
              </label>

              <label className="schedule-field">
                <span>End Time <b>*</b></span>
                <input
                  type="time"
                  name="end_time"
                  value={form.end_time}
                  onChange={setField}
                  required
                />
              </label>

              <label className="schedule-field schedule-field-wide">
                <span>Venue <b>*</b></span>
                <select
                  name="venue_id"
                  value={form.venue_id}
                  onChange={setField}
                  required
                >
                  <option value="">Select a venue</option>
                  {venues.map((venue, index) => (
                    <option
                      key={getId(venue) || `${venue.name}-${index}`}
                      value={getId(venue)}
                    >
                      {venue.name} (Capacity: {Number(venue.capacity) || 0})
                    </option>
                  ))}
                </select>

                {venues.length === 0 && !loading && (
                  <small className="schedule-field-help">
                    No venues found. Add a venue on the Venues page first.
                  </small>
                )}
              </label>

              {resources.length > 0 && (
                <fieldset className="schedule-resource-field schedule-field-wide">
                  <legend>Required Resources (optional)</legend>
                  <div className="schedule-resource-list">
                    {resources.map((resource, index) => {
                      const id = getId(resource);

                      return (
                        <label
                          key={id || `${resource.name}-${index}`}
                          className="schedule-resource-choice"
                        >
                          <input
                            type="checkbox"
                            checked={form.resource_ids.includes(id)}
                            onChange={(event) => {
                              setForm((previous) => ({
                                ...previous,
                                resource_ids: event.target.checked
                                  ? [...previous.resource_ids, id]
                                  : previous.resource_ids.filter(
                                      (item) => item !== id
                                    ),
                              }));
                              setAvailabilityChecked(false);
                              setError("");
                              setNotice("");
                            }}
                          />
                          {resource.name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </div>

            <div
              className={`schedule-inline-status ${
                venueConflict || capacityExceeded
                  ? "has-error"
                  : availabilityChecked
                    ? "is-good"
                    : ""
              }`}
            >
              <span className="schedule-inline-status-icon">
                {venueConflict || capacityExceeded
                  ? "!"
                  : availabilityChecked
                    ? "✓"
                    : "i"}
              </span>
              <div>
                <strong>
                  {venueConflict
                    ? "Venue Conflict"
                    : capacityExceeded
                      ? "Capacity Exceeded"
                      : availabilityChecked
                        ? "Venue Available!"
                        : "Check Venue Availability"}
                </strong>
                <p>
                  {venueConflict
                    ? "Another event overlaps this venue and time."
                    : capacityExceeded
                      ? `Venue capacity is ${venueCapacity} guests.`
                      : selectedVenue
                        ? `Capacity: ${venueCapacity} guests. Review the time slot before confirming.`
                        : "Select a venue and time to check availability."}
                </p>
              </div>
            </div>

            <div className="schedule-form-actions">
              <button
                type="button"
                className="schedule-btn schedule-btn-light schedule-check-btn"
                onClick={checkAvailability}
                disabled={saving || loading}
              >
                ◷ Check Availability
              </button>

              <button
                type="submit"
                className="schedule-btn schedule-btn-primary schedule-submit-btn"
                disabled={saving || loading || venues.length === 0}
              >
                {saving
                  ? "Saving..."
                  : editingId !== null
                    ? "Save Changes"
                    : "✓ Schedule Event"}
              </button>
            </div>
          </form>
        ) : (
          <section className="schedule-panel schedule-create-panel schedule-form-placeholder">
            <div className="schedule-placeholder-icon">＋</div>
            <h2>Ready to plan your next event?</h2>
            <p>Create a schedule, select a venue and check for time conflicts.</p>
            {canManage && (
              <button
                type="button"
                className="schedule-btn schedule-btn-primary"
                onClick={() => openNewForm(selectedDate)}
              >
                + Create New Schedule
              </button>
            )}
          </section>
        )}

        <section className="schedule-panel schedule-calendar-panel">
          <div className="schedule-calendar-heading">
            <button
              type="button"
              className="schedule-month-nav"
              onClick={() =>
                setCalendarDate(
                  new Date(calendarYear, calendarMonth - 1, 1)
                )
              }
              aria-label="Previous month"
            >
              ‹
            </button>

            <h2>{formatMonth(calendarDate)}</h2>

            <button
              type="button"
              className="schedule-month-nav"
              onClick={() =>
                setCalendarDate(
                  new Date(calendarYear, calendarMonth + 1, 1)
                )
              }
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="schedule-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="schedule-calendar-days">
            {cells.map((day, index) => {
              if (!day) {
                return (
                  <span
                    key={`empty-${index}`}
                    className="schedule-empty-day"
                  />
                );
              }

              const date = `${calendarYear}-${pad(calendarMonth + 1)}-${pad(day)}`;
              const selected = date === selectedDate;
              const today = date === todayString();
              const hasEvents = dayEvents(day).length > 0;

              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    "schedule-day",
                    selected ? "selected" : "",
                    today ? "today" : "",
                    hasEvents ? "has-events" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => selectDay(day)}
                  aria-pressed={selected}
                  aria-label={`${formatDate(date)}${hasEvents ? ", has events" : ""}`}
                >
                  {day}
                  {hasEvents && <i />}
                </button>
              );
            })}
          </div>

          <div className="schedule-calendar-legend">
            <span><i className="legend-dot legend-dot-available" /> Available</span>
            <span><i className="legend-dot legend-dot-booked" /> Booked</span>
            <span><i className="legend-dot legend-dot-selected" /> Selected</span>
          </div>

          <div className="schedule-selected-date">
            <span className="schedule-section-label">SELECTED DATE</span>
            <strong>{formatDate(selectedDate)}</strong>
            <p>{eventsForSelectedDate.length} event(s) scheduled</p>

            {canManage && (
              <button
                type="button"
                className="schedule-btn schedule-btn-outline schedule-add-btn"
                onClick={() => openNewForm(selectedDate)}
              >
                + Add
              </button>
            )}
          </div>

          {eventsForSelectedDate.length > 0 && (
            <div className="schedule-calendar-event-list">
              {eventsForSelectedDate.slice(0, 3).map((event, index) => (
                <div
                  key={getId(event) || `${eventName(event)}-${index}`}
                  className="schedule-mini-event"
                >
                  <span className="schedule-mini-event-dot" />
                  <div>
                    <strong>{eventName(event)}</strong>
                    <small>{timeRange(event)}</small>
                  </div>
                </div>
              ))}

              {eventsForSelectedDate.length > 3 && (
                <small>
                  +{eventsForSelectedDate.length - 3} more event(s)
                </small>
              )}
            </div>
          )}
        </section>

        <aside className="schedule-panel schedule-overview-panel">
          <div
            className={`schedule-availability-card ${
              venueConflict || capacityExceeded
                ? "unavailable"
                : availabilityChecked
                  ? "available"
                  : ""
            }`}
          >
            <span className="schedule-availability-symbol">
              {venueConflict || capacityExceeded ? "!" : "✓"}
            </span>
            <div>
              <strong>
                {venueConflict
                  ? "Venue Unavailable"
                  : capacityExceeded
                    ? "Capacity Exceeded"
                    : availabilityChecked
                      ? "Venue Available!"
                      : "Venue Availability"}
              </strong>
              <p>
                {venueConflict
                  ? "A time conflict was detected."
                  : capacityExceeded
                    ? "Choose a larger venue or reduce attendees."
                    : availabilityChecked
                      ? "No conflicts found in the currently loaded events."
                      : "Check your event details before scheduling."}
              </p>
            </div>
          </div>

          <div className="schedule-overview-list">
            <div className="schedule-overview-item">
              <span className="schedule-overview-icon">⌖</span>
              <div>
                <small>Venue</small>
                <strong>{selectedVenue?.name || "Select a venue"}</strong>
                {selectedVenue?.address && <small>{selectedVenue.address}</small>}
              </div>
            </div>

            <div className="schedule-overview-item">
              <span className="schedule-overview-icon">◷</span>
              <div>
                <small>Time Slot</small>
                <strong>
                  {formatTime(form.start_time)} – {formatTime(form.end_time)}
                </strong>
                <small>{formatDate(form.event_date)}</small>
              </div>
            </div>

            <div className="schedule-overview-item">
              <span className="schedule-overview-icon">♙</span>
              <div>
                <small>Capacity</small>
                <strong>
                  {selectedVenue ? `${venueCapacity} guests` : "Not selected"}
                </strong>
                <small>
                  Expected: {Number(form.attendee_count) || 0} attendees
                </small>
              </div>
            </div>

            <div className="schedule-overview-item">
              <span className="schedule-overview-icon">▦</span>
              <div>
                <small>Event Summary</small>
                <strong>{activeEvents.length} active event(s)</strong>
                <small>{confirmedEvents.length} confirmed</small>
              </div>
            </div>
          </div>

          {canManage && (
            <button
              type="button"
              className="schedule-btn schedule-btn-outline schedule-overview-action"
              onClick={() =>
                showForm ? checkAvailability() : openNewForm(selectedDate)
              }
            >
              ✓ {showForm ? "Check Availability" : "Schedule Event"}
            </button>
          )}

          <div className="schedule-note">
            <span>i</span>
            <p>
              One venue cannot host two active events at the same time.
              Cancelled events do not count as conflicts.
            </p>
          </div>
        </aside>
      </section>

      <section className="schedule-panel schedule-events-panel">
        <div className="schedule-events-heading">
          <div>
            <span className="schedule-section-label">EVENT MANAGEMENT</span>
            <h2>Scheduled Events</h2>
            <p>View and manage your upcoming event schedules.</p>
          </div>

          <div className="schedule-events-tools">
            <label className="schedule-search">
              <span>⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search events..."
                aria-label="Search events"
              />
            </label>

            <select
              className="schedule-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="All">All statuses</option>
              {EVENT_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="schedule-empty-state">
            <span className="schedule-spinner" />
            <p>Loading scheduled events...</p>
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="schedule-empty-state">
            <span className="schedule-empty-icon">▦</span>
            <h3>
              {events.length ? "No matching events" : "No events scheduled yet"}
            </h3>
            <p>
              {search || statusFilter !== "All"
                ? "Try changing your search or status filter."
                : "Create a schedule to see your events here."}
            </p>

            {canManage && (
              <button
                type="button"
                className="schedule-btn schedule-btn-primary"
                onClick={() => openNewForm(selectedDate)}
              >
                + Create Schedule
              </button>
            )}
          </div>
        ) : (
          <div className="schedule-table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Event Name</th>
                  <th>Date &amp; Time</th>
                  <th>Venue</th>
                  <th>Attendees</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {visibleEvents.map((event, index) => {
                  const venue = venues.find(
                    (item) => getId(item) === eventVenueId(event)
                  );

                  const venueValue =
                    typeof event?.venue === "string"
                      ? event.venue
                      : event?.venue?.name;

                  const venueName =
                    event?.venue_name ??
                    venueValue ??
                    venue?.name ??
                    "Venue not specified";

                  const id = getId(event);

                  return (
                    <tr key={id || `${eventName(event)}-${index}`}>
                      <td className="schedule-row-number">
                        {(page - 1) * PAGE_SIZE + index + 1}
                      </td>

                      <td>
                        <div className="schedule-event-cell">
                          <strong>{eventName(event)}</strong>
                          <span
                            className={`schedule-type-tag type-${statusClass(eventType(event))}`}
                          >
                            {eventType(event)}
                          </span>
                        </div>
                      </td>

                      <td>
                        <strong className="schedule-table-date">
                          {formatDate(eventDate(event))}
                        </strong>
                        <small className="schedule-table-time">
                          {timeRange(event)}
                        </small>
                      </td>

                      <td>{venueName}</td>
                      <td>{Number(event.attendee_count) || 0}</td>

                      <td>
                        <span
                          className={`schedule-status status-${statusClass(eventStatus(event))}`}
                        >
                          {eventStatus(event)}
                        </span>
                      </td>

                      <td>
                        {canManage ? (
                          <div className="schedule-row-actions">
                            <button
                              type="button"
                              className="schedule-edit-btn"
                              onClick={() => openEditForm(event)}
                              disabled={!id || saving}
                              title="Edit event"
                              aria-label={`Edit ${eventName(event)}`}
                            >
                              ✎
                            </button>

                            <button
                              type="button"
                              className="schedule-delete-btn"
                              onClick={() => handleDelete(event)}
                              disabled={!id || deletingId === id}
                              title="Delete event"
                              aria-label={`Delete ${eventName(event)}`}
                            >
                              {deletingId === id ? "…" : "×"}
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredEvents.length > 0 && (
          <div className="schedule-table-footer">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, filteredEvents.length)} of{" "}
              {filteredEvents.length} events
            </span>

            <div className="schedule-pagination">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              <span>{page} / {totalPages}</span>
              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </section>

      <footer className="schedule-page-footer">
        <span>© {new Date().getFullYear()} EventSphere</span>
        <span>Plan better. Schedule smarter. Bring people together.</span>
      </footer>
    </main>
  );
}