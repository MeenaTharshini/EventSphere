
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getVenues,
  getResources,
  getApprovedVendors,
} from "./api";

import "./Events.css";

/* -------------------- Constants -------------------- */

const STATUSES = ["Scheduled", "Confirmed", "Pending", "Cancelled"];

const FILTER_STATUSES = [
  "Upcoming",
  "Ongoing",
  "Completed",
  "Scheduled",
  "Confirmed",
  "Pending",
  "Cancelled",
];

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

const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "16:00";

const EMPTY_FORM = {
  name: "",
  type: "",
  customType: "",
  event_date: "",
  end_date: "",
  start_time: DEFAULT_START_TIME,
  end_time: DEFAULT_END_TIME,
  venue_id: "",
  attendee_count: "0",
  budget: "",
  status: "Scheduled",
  resource_ids: [],
  vendor_ids: [],
};

/* -------------------- General Helpers -------------------- */

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
    item?.venue_id ??
    item?.resource_id ??
    item?.vendor_id;

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

  if (["confirmed", "active"].includes(value)) {
    return "Confirmed";
  }

  if (value === "pending") {
    return "Pending";
  }

  if (["cancelled", "canceled"].includes(value)) {
    return "Cancelled";
  }

  if (value === "completed") {
    return "Completed";
  }

  if (value === "ongoing") {
    return "Ongoing";
  }

  return "Scheduled";
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .filter((value) => value != null)
        .map((value) => String(value).trim())
        .filter(Boolean)
    ),
  ];
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

function formatTime(value) {
  if (!value) return "—";

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return String(value);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return String(value);

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/* -------------------- Date and Time Helpers -------------------- */

function getMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return NaN;

  return hours * 60 + minutes;
}

function isValidTimeRange(startTime, endTime) {
  const start = getMinutes(startTime);
  const end = getMinutes(endTime);

  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start < end
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);

  return (
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day
  );
}

function getDateTime(dateValue, timeValue) {
  if (!isValidDate(dateValue)) return null;

  const time = String(timeValue || "");

  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  const minutes = getMinutes(time);

  if (!Number.isFinite(minutes)) return null;

  const parsed = new Date(`${dateValue}T${time}:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventStartDate(event) {
  return toDateInput(
    event?.event_date ??
      event?.date ??
      event?.start_date
  );
}

function getEventEndDate(event) {
  return toDateInput(
    event?.end_date ??
      event?.event_end_date ??
      event?.event_date ??
      event?.date ??
      event?.start_date
  );
}

function getEventStartTime(event) {
  return String(
    event?.start_time ?? DEFAULT_START_TIME
  ).slice(0, 5);
}

function getEventEndTime(event) {
  return String(
    event?.end_time ?? DEFAULT_END_TIME
  ).slice(0, 5);
}

function getEventStartDateTime(event) {
  return getDateTime(
    getEventStartDate(event),
    getEventStartTime(event)
  );
}

function getEventEndDateTime(event) {
  return getDateTime(
    getEventEndDate(event),
    getEventEndTime(event)
  );
}

function isValidDateTimeRange(
  startDate,
  startTime,
  endDate,
  endTime
) {
  const start = getDateTime(startDate, startTime);
  const end = getDateTime(endDate, endTime);

  return Boolean(start && end && start < end);
}

function eventsOverlap(
  startA,
  endA,
  startB,
  endB
) {
  if (!startA || !endA || !startB || !endB) {
    return false;
  }

  // Adjacent events are allowed:
  // 10:00–12:00 and 12:00–13:00 do not overlap.
  return startA < endB && startB < endA;
}

function isCancelled(event) {
  const status = String(event?.status ?? "")
    .trim()
    .toLowerCase();

  return ["cancelled", "canceled"].includes(status);
}

function getEventTimeStatus(event) {
  const storedStatus = String(event?.status ?? "")
    .trim()
    .toLowerCase();

  if (["cancelled", "canceled"].includes(storedStatus)) {
    return "Cancelled";
  }

  if (storedStatus === "completed") {
    return "Completed";
  }

  const startDateTime = getEventStartDateTime(event);
  const endDateTime = getEventEndDateTime(event);

  if (!startDateTime || !endDateTime) {
    return normalizeStatus(event?.status);
  }

  const now = new Date();

  if (now < startDateTime) {
    return "Upcoming";
  }

  if (now >= startDateTime && now < endDateTime) {
    return "Ongoing";
  }

  return "Completed";
}

/* -------------------- User Helpers -------------------- */

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

/* -------------------- Event Helpers -------------------- */

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
  return (
    event?.event_date ??
    event?.date ??
    event?.start_date
  );
}

function getEventVenueName(event) {
  const name =
    event?.venue_name ??
    event?.venue?.name ??
    (typeof event?.venue === "string" ? event.venue : "");

  return name || "Venue not set";
}

/* -------------------- Resource and Vendor Helpers -------------------- */

function getResourceName(resource) {
  return (
    resource?.name ??
    resource?.resource_name ??
    resource?.title ??
    "Unnamed resource"
  );
}

function getVendorName(vendor) {
  return (
    vendor?.business_name ??
    vendor?.company_name ??
    vendor?.name ??
    vendor?.vendor_name ??
    vendor?.title ??
    "Unnamed vendor"
  );
}

function getResourceDescription(resource) {
  return (
    resource?.description ??
    resource?.category ??
    resource?.type ??
    ""
  );
}

function getVendorDescription(vendor) {
  return (
    vendor?.category ??
    vendor?.service_type ??
    vendor?.description ??
    ""
  );
}

function toggleSelectedId(selectedIds, id) {
  const normalizedId = String(id);

  if (selectedIds.includes(normalizedId)) {
    return selectedIds.filter(
      (selectedId) => selectedId !== normalizedId
    );
  }

  return [...selectedIds, normalizedId];
}

/* -------------------- Events Component -------------------- */

export default function Events({ user }) {
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [resources, setResources] = useState([]);
  const [vendors, setVendors] = useState([]);

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

  /* -------------------- Load Data -------------------- */

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [
        eventsResult,
        venuesResult,
        resourcesResult,
        vendorsResult,
      ] = await Promise.all([
        getEvents(),
        getVenues(),
        getResources(),
        getApprovedVendors(),
      ]);

      setEvents(getArray(eventsResult, ["events", "items"]));
      setVenues(getArray(venuesResult, ["venues", "items"]));
      setResources(getArray(resourcesResult, ["resources", "items"]));

      setVendors(
        getArray(vendorsResult, [
          "vendors",
          "items",
          "approved_vendors",
        ])
      );
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
      const name = String(getEventName(event)).toLowerCase();
      const venueName = String(getEventVenueName(event)).toLowerCase();
      const type = String(getEventType(event)).toLowerCase();

      const matchesSearch =
        !query ||
        name.includes(query) ||
        venueName.includes(query) ||
        type.includes(query);

      const calculatedStatus = getEventTimeStatus(event);

      const matchesStatus =
        statusFilter === "All" ||
        calculatedStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [events, search, statusFilter]);

  /* -------------------- Selected Venue and Availability -------------------- */

  const selectedVenue = useMemo(
    () =>
      venues.find(
        (venue) => getId(venue) === String(form.venue_id)
      ),
    [venues, form.venue_id]
  );

  const venueCapacity = Number(selectedVenue?.capacity) || 0;
  const attendeeCount = Number(form.attendee_count);

  const validDateTimeRange = isValidDateTimeRange(
    form.event_date,
    form.start_time,
    form.end_date,
    form.end_time
  );

  const capacityExceeded =
    Boolean(selectedVenue) &&
    Number.isFinite(attendeeCount) &&
    attendeeCount > venueCapacity;

  const venueConflict = useMemo(() => {
    if (
      !form.event_date ||
      !form.end_date ||
      !form.venue_id ||
      !validDateTimeRange
    ) {
      return false;
    }

    const newStart = getDateTime(
      form.event_date,
      form.start_time
    );

    const newEnd = getDateTime(
      form.end_date,
      form.end_time
    );

    if (!newStart || !newEnd) return false;

    return events.some((event) => {
      if (isCancelled(event)) return false;

      // Do not compare an edited event with itself.
      if (
        editingEvent &&
        getId(event) === getId(editingEvent)
      ) {
        return false;
      }

      if (
        getEventVenueId(event) !== String(form.venue_id)
      ) {
        return false;
      }

      const existingStart = getEventStartDateTime(event);
      const existingEnd = getEventEndDateTime(event);

      return eventsOverlap(
        newStart,
        newEnd,
        existingStart,
        existingEnd
      );
    });
  }, [
    events,
    form.event_date,
    form.end_date,
    form.venue_id,
    form.start_time,
    form.end_time,
    validDateTimeRange,
    editingEvent,
  ]);

  const availabilityState = useMemo(() => {
    if (
      !form.event_date ||
      !form.end_date ||
      !form.venue_id
    ) {
      return {
        type: "neutral",
        title: "Check Venue Availability",
        message:
          "Select a start date, end date, venue, and time to check availability.",
      };
    }

    if (!validDateTimeRange) {
      return {
        type: "error",
        title: "Invalid Date or Time Range",
        message:
          "The end date and time must be later than the start date and time.",
      };
    }

    if (venueConflict) {
      return {
        type: "error",
        title: "Venue Conflict",
        message:
          "Another active event is already scheduled at this venue during the selected date and time.",
      };
    }

    if (capacityExceeded) {
      return {
        type: "error",
        title: "Capacity Exceeded",
        message: `This venue can accommodate ${venueCapacity} guests.`,
      };
    }

    return {
      type: "success",
      title: "Venue Available",
      message: `No time conflict found. Venue capacity: ${venueCapacity} guests.`,
    };
  }, [
    form.event_date,
    form.end_date,
    form.venue_id,
    validDateTimeRange,
    venueConflict,
    capacityExceeded,
    venueCapacity,
  ]);

  const formIsValid =
    Boolean(form.name.trim()) &&
    Boolean(form.event_date) &&
    Boolean(form.end_date) &&
    Boolean(form.venue_id) &&
    Boolean(selectedVenue) &&
    validDateTimeRange &&
    Number.isInteger(attendeeCount) &&
    attendeeCount >= 0 &&
    Number.isFinite(Number(form.budget)) &&
    Number(form.budget) >= 0 &&
    !venueConflict &&
    !capacityExceeded;

  /* -------------------- Form Helpers -------------------- */

  function updateFormField(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setError("");
    setSuccess("");
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
    if (!canManageEvent(event, user)) {
      setError("You do not have permission to edit this event.");
      return;
    }

    const eventType = event?.event_type ?? event?.type ?? "";
    const isStandardType = EVENT_TYPES.includes(eventType);

    const storedStatus = normalizeStatus(event?.status);

    setEditingEvent(event);

    setForm({
      name: event?.name ?? event?.title ?? event?.event_name ?? "",
      type: isStandardType ? eventType : "Other",
      customType: isStandardType ? "" : eventType,
      event_date: getEventStartDate(event),
      end_date: getEventEndDate(event),
      start_time: getEventStartTime(event),
      end_time: getEventEndTime(event),
      venue_id: getEventVenueId(event),
      attendee_count: String(event?.attendee_count ?? 0),
      budget: String(event?.budget ?? ""),
      status: STATUSES.includes(storedStatus)
        ? storedStatus
        : "Scheduled",
      resource_ids: normalizeIdList(event?.resource_ids),
      vendor_ids: normalizeIdList(event?.vendor_ids),
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

    if (!isValidDate(form.event_date)) {
      return "Please select a valid start date.";
    }

    if (!isValidDate(form.end_date)) {
      return "Please select a valid end date.";
    }

    if (!form.venue_id || !selectedVenue) {
      return "Please select a registered venue.";
    }

    if (!validDateTimeRange) {
      return "The end date and time must be later than the start date and time.";
    }

    if (
      !Number.isInteger(attendeeCount) ||
      attendeeCount < 0
    ) {
      return "Attendee count must be a non-negative whole number.";
    }

    if (capacityExceeded) {
      return `This venue can accommodate ${venueCapacity} guests.`;
    }

    if (venueConflict) {
      return "This venue is already booked during the selected date and time.";
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

    if (saving) return;

    const eventType =
      form.type === "Other"
        ? form.customType.trim()
        : form.type.trim();

    const payload = {
      name: form.name.trim(),
      event_type: eventType,
      event_date: form.event_date,
      end_date: form.end_date,
      start_time: form.start_time,
      end_time: form.end_time,
      venue_id: String(form.venue_id),
      venue:
        selectedVenue?.name ??
        selectedVenue?.venue_name ??
        "",
      attendee_count: attendeeCount,
      budget: Number(form.budget),
      status: form.status,
      resource_ids: normalizeIdList(form.resource_ids),
      vendor_ids: normalizeIdList(form.vendor_ids),
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
      setError(
        "Cannot delete this event because its ID is missing."
      );
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
      setError(
        getErrorMessage(err, "Unable to delete this event.")
      );
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
          <p>
            Plan, organize, schedule, and track all your events in one place.
          </p>
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
        <div
          className="events-alert events-alert-success"
          role="status"
        >
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

      {/* -------------------- Toolbar -------------------- */}

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

          {FILTER_STATUSES.map((status) => (
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

      {/* -------------------- Events List -------------------- */}

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
            const status = getEventTimeStatus(event);

            const startDate = getEventStartDate(event);
            const endDate = getEventEndDate(event);

            const isMultiDay =
              Boolean(startDate) &&
              Boolean(endDate) &&
              startDate !== endDate;

            return (
              <article className="events-card" key={eventId}>
                <div className="events-card-top">
                  <span
                    className={`events-status status-${status
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {status}
                  </span>

                  <span className="events-card-date">
                    {formatDate(startDate)}
                    {isMultiDay && ` – ${formatDate(endDate)}`}
                  </span>
                </div>

                <h3>{getEventName(event)}</h3>

                <p className="events-card-type">
                  {getEventType(event)}
                </p>

                <div className="events-card-details">
                  <p>
                    <span>Venue</span>
                    <strong>{getEventVenueName(event)}</strong>
                  </p>

                  <p>
                    <span>Date &amp; Time</span>
                    <strong>
                      {formatTime(getEventStartTime(event))} –{" "}
                      {formatTime(getEventEndTime(event))}
                      {isMultiDay && " (multi-day)"}
                    </strong>
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

                  <p>
                    <span>Resources</span>
                    <strong>
                      {normalizeIdList(event?.resource_ids).length}
                    </strong>
                  </p>

                  <p>
                    <span>Vendors</span>
                    <strong>
                      {normalizeIdList(event?.vendor_ids).length}
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
              {/* Event Name */}

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

              {/* Event Type */}

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
                        value === "Other"
                          ? previous.customType
                          : "",
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
                      updateFormField(
                        "customType",
                        event.target.value
                      )
                    }
                    placeholder="Enter event type"
                    maxLength={100}
                    required
                  />
                </label>
              )}

              {/* Start Date */}

              <label>
                Start date
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(event) =>
                    updateFormField(
                      "event_date",
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              {/* Start Time */}

              <label>
                Start time
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(event) =>
                    updateFormField(
                      "start_time",
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              {/* End Date */}

              <label>
                End date
                <input
                  type="date"
                  value={form.end_date}
                  min={form.event_date || undefined}
                  onChange={(event) =>
                    updateFormField(
                      "end_date",
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              {/* End Time */}

              <label>
                End time
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(event) =>
                    updateFormField(
                      "end_time",
                      event.target.value
                    )
                  }
                  required
                />
              </label>

              {!validDateTimeRange && (
                <p className="events-inline-error">
                  End date and time must be later than start date and time.
                </p>
              )}

              {/* Attendees */}

              <label>
                Attendee count
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.attendee_count}
                  onChange={(event) =>
                    updateFormField(
                      "attendee_count",
                      event.target.value
                    )
                  }
                  required
                />

                {selectedVenue && (
                  <small>
                    Venue capacity: {venueCapacity} guests
                  </small>
                )}
              </label>

              {/* Venue */}

              <label>
                Registered venue
                <select
                  value={form.venue_id}
                  onChange={(event) =>
                    updateFormField(
                      "venue_id",
                      event.target.value
                    )
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
                        {venue?.capacity != null
                          ? ` (Capacity: ${Number(venue.capacity) || 0})`
                          : ""}
                      </option>
                    );
                  })}
                </select>

                {venues.length === 0 && (
                  <small>
                    Add a venue from the Venues page first.
                  </small>
                )}
              </label>

              {/* Budget */}

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

              {/* Status */}

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

              {/* Availability Check */}

              <section
                className={`events-availability-check availability-${availabilityState.type}`}
                aria-live="polite"
              >
                <div className="events-availability-heading">
                  <strong>{availabilityState.title}</strong>
                  <span>
                    {availabilityState.type === "success"
                      ? "✓"
                      : availabilityState.type === "error"
                        ? "!"
                        : "i"}
                  </span>
                </div>

                <p>{availabilityState.message}</p>

                {venueConflict && (
                  <small>
                    Try a different time or choose another venue.
                  </small>
                )}
              </section>

              {/* Resources */}

              <section className="events-selection-section">
                <div className="events-selection-heading">
                  <div>
                    <h3>Resources</h3>
                    <p>
                      Select the resources needed for this event.
                    </p>
                  </div>

                  <span className="events-selection-count">
                    {form.resource_ids.length} selected
                  </span>
                </div>

                {resources.length === 0 ? (
                  <p className="events-selection-empty">
                    No resources are available.
                  </p>
                ) : (
                  <div className="events-selection-list">
                    {resources.map((resource, index) => {
                      const resourceId = getId(resource);

                      if (!resourceId) return null;

                      const checked =
                        form.resource_ids.includes(resourceId);

                      const description =
                        getResourceDescription(resource);

                      return (
                        <label
                          className={`events-selection-item ${
                            checked ? "selected" : ""
                          }`}
                          key={resourceId || `resource-${index}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              updateFormField(
                                "resource_ids",
                                toggleSelectedId(
                                  form.resource_ids,
                                  resourceId
                                )
                              )
                            }
                          />

                          <span className="events-selection-item-content">
                            <strong>
                              {getResourceName(resource)}
                            </strong>

                            {description && (
                              <small>{String(description)}</small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Vendors */}

              <section className="events-selection-section">
                <div className="events-selection-heading">
                  <div>
                    <h3>Vendors</h3>
                    <p>
                      Select the vendors involved in this event.
                    </p>
                  </div>

                  <span className="events-selection-count">
                    {form.vendor_ids.length} selected
                  </span>
                </div>

                {vendors.length === 0 ? (
                  <p className="events-selection-empty">
                    No approved vendors are available.
                  </p>
                ) : (
                  <div className="events-selection-list">
                    {vendors.map((vendor, index) => {
                      const vendorId = getId(vendor);

                      if (!vendorId) return null;

                      const checked =
                        form.vendor_ids.includes(vendorId);

                      const description =
                        getVendorDescription(vendor);

                      return (
                        <label
                          className={`events-selection-item ${
                            checked ? "selected" : ""
                          }`}
                          key={vendorId || `vendor-${index}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              updateFormField(
                                "vendor_ids",
                                toggleSelectedId(
                                  form.vendor_ids,
                                  vendorId
                                )
                              )
                            }
                          />

                          <span className="events-selection-item-content">
                            <strong>
                              {getVendorName(vendor)}
                            </strong>

                            {description && (
                              <small>{String(description)}</small>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Form Note */}

              <p className="events-form-note">
                Venue availability is checked against the events currently
                loaded on this page, including multi-day events. The backend
                should also validate date and time conflicts before saving.
              </p>

              {/* Form Actions */}

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
                  disabled={
                    saving ||
                    loading ||
                    venues.length === 0 ||
                    !formIsValid
                  }
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
