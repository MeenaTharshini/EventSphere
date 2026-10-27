
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Users,
  UserRound,
  Mail,
  Phone,
  MapPin,
  Tag,
  Check,
  UserPlus,
  Info,
  LoaderCircle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Ticket,
  ArrowUpRight,
  QrCode,
  X,
  Download,
  Copy,
  ShieldCheck,
} from "lucide-react";

import {
  getEvents,
  registerAttendee,
  getMyRegistrations,
  getTicket,
} from "./api";

import "./AttendeeRegistration.css";

const CATEGORIES = [
  { value: "General", color: "#267565" },
  { value: "VIP", color: "#b18b43" },
  { value: "Speaker", color: "#7560a8" },
  { value: "Volunteer", color: "#ad7144" },
];

const INITIAL_FORM = {
  name: "",
  email: "",
  phone: "",
  event_id: "",
  category: "General",
};

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
    : result?.events ?? result?.items ?? [];

  if (!Array.isArray(items)) return [];

  return items
    .filter((event) => event && typeof event === "object")
    .map((event) => {
      const venue =
        typeof event.venue === "object" && event.venue
          ? event.venue.name ??
            event.venue.venue_name ??
            event.venue.address ??
            event.venue.city ??
            ""
          : event.venue_name ??
            event.venue ??
            event.location ??
            event.city ??
            "";

      return {
        id: String(
          event._id ?? event.id ?? event.event_id ?? ""
        ).trim(),

        name: String(
          event.name ??
            event.title ??
            event.event_name ??
            ""
        ).trim(),

        date:
          event.event_date ??
          event.date ??
          event.start_date ??
          event.start_datetime ??
          event.start_time ??
          "",

        venue: String(venue ?? "").trim(),

        type:
          event.event_type ??
          event.type ??
          event.category ??
          "Event",

        status: String(event.status ?? "")
          .trim()
          .toLowerCase(),
      };
    })
    .filter(
      (event) =>
        event.id &&
        event.name &&
        !["cancelled", "canceled"].includes(event.status)
    );
}

function normalizeRegistrations(response, availableEvents = []) {
  const result = unwrapResponse(response);

  const items = Array.isArray(result)
    ? result
    : result?.registrations ?? result?.items ?? [];

  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (registration) =>
        registration && typeof registration === "object"
    )
    .map((registration, index) => {
      const embeddedEvent =
        registration.event &&
        typeof registration.event === "object"
          ? registration.event
          : registration.event_details &&
              typeof registration.event_details === "object"
            ? registration.event_details
            : null;

      const eventId = String(
        registration.event_id ??
          registration.eventId ??
          embeddedEvent?._id ??
          embeddedEvent?.id ??
          ""
      ).trim();

      const matchingEvent = availableEvents.find(
        (event) => event.id === eventId
      );

      const embeddedVenue =
        typeof embeddedEvent?.venue === "object" &&
        embeddedEvent.venue
          ? embeddedEvent.venue.name ??
            embeddedEvent.venue.venue_name ??
            embeddedEvent.venue.address ??
            embeddedEvent.venue.city ??
            ""
          : embeddedEvent?.venue;

      const rawTicket =
        registration.ticket &&
        typeof registration.ticket === "object"
          ? registration.ticket
          : null;

      return {
        id: String(
          registration._id ??
            registration.id ??
            registration.registration_id ??
            `${eventId}-${registration.registered_at ?? index}`
        ),

        eventId,

        name:
          embeddedEvent?.name ??
          embeddedEvent?.title ??
          embeddedEvent?.event_name ??
          matchingEvent?.name ??
          registration.event_name ??
          registration.eventName ??
          registration.name_of_event ??
          "Event details unavailable",

        date:
          embeddedEvent?.event_date ??
          embeddedEvent?.date ??
          embeddedEvent?.start_date ??
          matchingEvent?.date ??
          registration.event_date ??
          registration.date ??
          "",

        venue:
          embeddedVenue ??
          embeddedEvent?.venue_name ??
          matchingEvent?.venue ??
          registration.venue ??
          registration.location ??
          "",

        category:
          registration.category ??
          registration.attendee_category ??
          "General",

        status: String(
          registration.status ?? "Registered"
        )
          .trim()
          .toLowerCase(),

        registeredAt:
          registration.registered_at ??
          registration.created_at ??
          "",

        ticket: rawTicket
          ? {
              ticket_id:
                rawTicket.ticket_id ??
                rawTicket.ticketId ??
                "",

              status: rawTicket.status ?? "Valid",

              qr_code:
                rawTicket.qr_code ??
                rawTicket.qrCode ??
                "",

              created_at:
                rawTicket.created_at ??
                rawTicket.createdAt ??
                "",

              checked_in_at:
                rawTicket.checked_in_at ??
                rawTicket.checkedInAt ??
                "",
            }
          : null,
      };
    })
    .filter(
      (registration) =>
        !["cancelled", "canceled"].includes(registration.status)
    );
}

function normalizeTicketResponse(response) {
  const result = unwrapResponse(response);

  if (!result || typeof result !== "object") return null;

  const ticket =
    result.ticket && typeof result.ticket === "object"
      ? result.ticket
      : result;

  const ticketId =
    ticket.ticket_id ?? ticket.ticketId ?? "";

  if (!ticketId) return null;

  return {
    ticket_id: ticketId,

    registration_id:
      ticket.registration_id ??
      ticket.registrationId ??
      "",

    attendee_name:
      ticket.attendee_name ??
      ticket.attendeeName ??
      "",

    event_id:
      ticket.event_id ??
      ticket.eventId ??
      "",

    event_name:
      ticket.event_name ??
      ticket.eventName ??
      "",

    event_date:
      ticket.event_date ??
      ticket.eventDate ??
      "",

    venue: ticket.venue ?? "",

    category: ticket.category ?? "General",

    status: ticket.status ?? "Valid",

    qr_code:
      ticket.qr_code ??
      ticket.qrCode ??
      "",

    created_at:
      ticket.created_at ??
      ticket.createdAt ??
      "",

    checked_in_at:
      ticket.checked_in_at ??
      ticket.checkedInAt ??
      "",
  };
}

function formatDate(value) {
  if (!value) return "Date to be announced";

  let date;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  ) {
    const [year, month, day] = value
      .trim()
      .split("-")
      .map(Number);

    date = new Date(year, month - 1, day);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date to be announced";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getErrorMessage(error) {
  const detail =
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    error?.detail ??
    error?.message ??
    "Something went wrong. Please try again.";

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = item?.loc?.at(-1) ?? "field";

        return `${field}: ${item?.msg ?? "Invalid value"}`;
      })
      .join(". ");
  }

  const message = String(detail);

  if (/already registered|duplicate key/i.test(message)) {
    return "You are already registered for this event.";
  }

  if (/registration email must match/i.test(message)) {
    return "Your registration email must match your signed-in account email.";
  }

  if (/valid attendee category|select general/i.test(message)) {
    return "Please select a valid attendee category.";
  }

  if (/valid event|objectid/i.test(message)) {
    return "The event ID was rejected. Refresh the event list and try again.";
  }

  if (/event does not exist/i.test(message)) {
    return "This event no longer exists. Please choose another event.";
  }

  if (/registration is unavailable|cancelled/i.test(message)) {
    return "Registration is unavailable for this event.";
  }

  if (/only attendees/i.test(message)) {
    return "Please sign in with an attendee account to register.";
  }

  if (
    /failed to fetch|network error|connection refused|unable to connect/i.test(
      message
    )
  ) {
    return "Unable to connect to the server. Check that the backend is running.";
  }

  return message;
}

function getStatusLabel(status) {
  if (!status) return "Registered";

  return String(status)
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isValidImageData(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value)
  );
}

export default function AttendeeRegistration({ user, onLogout }) {
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    name: user?.name ?? "",
    email: user?.email ?? "",
  }));

  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState("");

  const [registeredEvents, setRegisteredEvents] = useState([]);
  const [loadingRegistrations, setLoadingRegistrations] =
    useState(true);
  const [registrationsError, setRegistrationsError] = useState("");

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessage, setTicketMessage] = useState("");
  const [copiedTicketId, setCopiedTicketId] = useState(false);
  const [loadingTicket, setLoadingTicket] = useState(false);

  const selectedEvent = useMemo(
    () =>
      events.find((event) => event.id === String(form.event_id)) ??
      null,
    [events, form.event_id]
  );

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError("");

    try {
      const response = await getEvents();
      const available = normalizeEvents(response);

      setEvents(available);

      if (available.length === 0) {
        setEventsError("No events are currently available.");
      }

      return available;
    } catch (error) {
      setEvents([]);
      setEventsError(getErrorMessage(error));
      return [];
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadMyRegistrations = useCallback(async (availableEvents = []) => {
    setLoadingRegistrations(true);
    setRegistrationsError("");

    try {
      const response = await getMyRegistrations();

      setRegisteredEvents(
        normalizeRegistrations(response, availableEvents)
      );
    } catch (error) {
      setRegistrationsError(getErrorMessage(error));
    } finally {
      setLoadingRegistrations(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoadingEvents(true);
      setLoadingRegistrations(true);
      setEventsError("");
      setRegistrationsError("");

      try {
        const eventsResponse = await getEvents();

        if (!active) return;

        const available = normalizeEvents(eventsResponse);

        setEvents(available);
        setEventsError(
          available.length === 0
            ? "No events are currently available."
            : ""
        );

        try {
          const registrationsResponse = await getMyRegistrations();

          if (!active) return;

          setRegisteredEvents(
            normalizeRegistrations(registrationsResponse, available)
          );
        } catch (error) {
          if (active) {
            setRegistrationsError(getErrorMessage(error));
          }
        } finally {
          if (active) setLoadingRegistrations(false);
        }
      } catch (error) {
        if (active) {
          setEvents([]);
          setEventsError(getErrorMessage(error));
          setRegistrationsError(getErrorMessage(error));
          setRegisteredEvents([]);
          setLoadingRegistrations(false);
        }
      } finally {
        if (active) setLoadingEvents(false);
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      name: user?.name ?? current.name,
      email: user?.email ?? current.email,
    }));
  }, [user?.name, user?.email]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSelectedTicket(null);
        setCopiedTicketId(false);
        setTicketMessage("");
      }
    }

    if (selectedTicket) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedTicket]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setErrors((current) => ({
      ...current,
      [name]: "",
      form: "",
    }));

    setSuccess("");
    setTicketMessage("");
  }

  function validateForm() {
    const next = {};

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const digits = phone.replace(/\D/g, "").length;

    if (!name) {
      next.name = "Please enter your full name.";
    } else if (
      name.length < 2 ||
      name.length > 150 ||
      !/[a-zA-Z\u00C0-\u024F]/.test(name)
    ) {
      next.name = "Please enter a valid full name.";
    }

    if (!email) {
      next.email = "Please enter your email address.";
    } else if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      next.email = "Please enter a valid email address.";
    }

    if (!phone) {
      next.phone = "Please enter your phone number.";
    } else if (
      phone.length < 7 ||
      phone.length > 20 ||
      !/^[0-9+\-()\s]+$/.test(phone) ||
      digits < 7 ||
      digits > 15
    ) {
      next.phone = "Please enter a valid phone number.";
    }

    if (!form.event_id) {
      next.event_id = "Please select an event.";
    } else if (!events.some((event) => event.id === form.event_id)) {
      next.event_id = "Please select an available event.";
    }

    if (!CATEGORIES.some((category) => category.value === form.category)) {
      next.category = "Please select an attendee category.";
    }

    setErrors(next);

    return Object.keys(next).length === 0;
  }

  async function openTicketWithDetails(ticket, registration = null) {
    if (!ticket?.ticket_id) {
      setTicketMessage(
        "A digital ticket is not available for this registration yet. Refresh your registrations and try again."
      );
      return;
    }

    setTicketMessage("");
    setCopiedTicketId(false);
    setLoadingTicket(true);

    const fallbackTicket = {
      ...ticket,
      attendee_name:
        ticket.attendee_name || user?.name || "",
      event_name:
        ticket.event_name || registration?.name || "Event",
      event_date:
        ticket.event_date || registration?.date || "",
      venue:
        ticket.venue || registration?.venue || "",
      category:
        ticket.category || registration?.category || "General",
    };

    // Open immediately so the attendee can see the ticket details
    // while the full ticket is being retrieved.
    setSelectedTicket(fallbackTicket);

    try {
      const response = await getTicket(ticket.ticket_id);
      const completeTicket = normalizeTicketResponse(response);

      if (completeTicket) {
        setSelectedTicket({
          ...fallbackTicket,
          ...completeTicket,
          attendee_name:
            completeTicket.attendee_name ||
            fallbackTicket.attendee_name,
          event_name:
            completeTicket.event_name ||
            fallbackTicket.event_name,
          event_date:
            completeTicket.event_date ||
            fallbackTicket.event_date,
          venue:
            completeTicket.venue ||
            fallbackTicket.venue,
          category:
            completeTicket.category ||
            fallbackTicket.category,
          qr_code:
            completeTicket.qr_code ||
            fallbackTicket.qr_code ||
            "",
        });

        if (
          !completeTicket.qr_code &&
          !fallbackTicket.qr_code
        ) {
          setTicketMessage(
            "The ticket exists, but the server did not return its QR image."
          );
        }
      }
    } catch (error) {
      // The registration may already contain the QR image.
      if (!isValidImageData(fallbackTicket.qr_code)) {
        setTicketMessage(
          `Unable to retrieve the full ticket: ${getErrorMessage(error)}`
        );
      }
    } finally {
      setLoadingTicket(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setSuccess("");
    setErrors({});
    setTicketMessage("");
    setSelectedTicket(null);
    setCopiedTicketId(false);

    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const response = await registerAttendee({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        event_id: form.event_id,
        category: form.category,
      });

      if (response?.success === false) {
        throw new Error(
          response.message || "Registration could not be completed."
        );
      }

      const generatedTicket = normalizeTicketResponse(response);

      setSuccess(
        response?.message || "Registration completed successfully!"
      );

      if (response?.ticket_created === false) {
        setTicketMessage(
          response?.ticket_error ||
            "Your registration was saved, but the ticket could not be generated. Refresh your registrations or contact the event organizer."
        );
      } else if (generatedTicket) {
        await openTicketWithDetails({
          ...generatedTicket,
          attendee_name:
            generatedTicket.attendee_name || form.name.trim(),
          event_name:
            generatedTicket.event_name ||
            selectedEvent?.name ||
            "Event",
          event_date:
            generatedTicket.event_date ||
            selectedEvent?.date ||
            "",
          venue:
            generatedTicket.venue ||
            selectedEvent?.venue ||
            "",
          category:
            generatedTicket.category || form.category,
        });
      } else {
        setTicketMessage(
          "Your registration was successful. Refresh your registrations to check whether the digital ticket is available."
        );
      }

      const latestEvents = await loadEvents();

      try {
        const latestRegistrations = await getMyRegistrations();

        setRegisteredEvents(
          normalizeRegistrations(latestRegistrations, latestEvents)
        );

        setRegistrationsError("");
      } catch (refreshError) {
        setRegistrationsError(getErrorMessage(refreshError));
      }

      setForm((current) => ({
        ...INITIAL_FORM,
        name: user?.name || current.name,
        email: user?.email || current.email,
      }));
    } catch (error) {
      setErrors({
        form: getErrorMessage(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefresh() {
    setRegistrationsError("");

    const latestEvents = await loadEvents();

    await loadMyRegistrations(latestEvents);
  }

  async function openRegistrationTicket(registration) {
    if (!registration.ticket?.ticket_id) {
      setTicketMessage(
        "A digital ticket is not available for this registration yet. Refresh your registrations and try again."
      );
      return;
    }

    await openTicketWithDetails(
      {
        ticket_id: registration.ticket.ticket_id,
        registration_id: registration.id,
        attendee_name: user?.name ?? "",
        event_name: registration.name,
        event_date: registration.date,
        venue: registration.venue,
        category: registration.category,
        status: registration.ticket.status ?? "Valid",
        qr_code: registration.ticket.qr_code ?? "",
        created_at: registration.ticket.created_at ?? "",
        checked_in_at: registration.ticket.checked_in_at ?? "",
      },
      registration
    );
  }

  async function copyTicketId() {
    if (!selectedTicket?.ticket_id) return;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(selectedTicket.ticket_id);
      setCopiedTicketId(true);

      window.setTimeout(() => setCopiedTicketId(false), 1800);
    } catch {
      setTicketMessage(
        "Could not copy the ticket ID. Please select and copy it manually."
      );
    }
  }

  function downloadTicketQr() {
    if (!isValidImageData(selectedTicket?.qr_code)) {
      setTicketMessage(
        "A downloadable QR code is not available for this ticket."
      );
      return;
    }

    const link = document.createElement("a");

    link.href = selectedTicket.qr_code;
    link.download = `${selectedTicket.ticket_id || "EventSphere-ticket"}-QR.png`;

    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function closeTicket() {
    setSelectedTicket(null);
    setCopiedTicketId(false);
    setTicketMessage("");
  }

  return (
    <div className="es-registration">
      <header className="es-header">
        <a
          className="es-brand"
          href="/"
          aria-label="EventSphere home"
        >
          <CalendarDays className="es-brand-icon" size={29} />
          <span>EventSphere</span>
        </a>

        <nav className="es-header-nav" aria-label="Main navigation">
          <span>Plan</span>
          <i>•</i>
          <span>Manage</span>
          <i>•</i>
          <span>Create Better Events</span>
        </nav>

        <div className="es-user-actions">
          {user?.name && (
            <span className="es-user-name">Hi, {user.name}</span>
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

      <main className="es-layout">
        <section className="es-form-card">
          <div className="es-form-heading">
            <Users className="es-heading-icon" size={40} />

            <div>
              <span className="es-eyebrow">YOUR NEXT EXPERIENCE</span>
              <h1>Event Registration</h1>
              <p>
                A great experience starts here. Fill in your details
                to reserve your place.
              </p>
            </div>
          </div>

          {errors.form && (
            <div className="es-alert es-alert-error" role="alert">
              <AlertCircle size={20} />
              <span>{errors.form}</span>
            </div>
          )}

          {success && (
            <div className="es-alert es-alert-success" role="status">
              <CheckCircle2 size={21} />

              <div>
                <strong>Registration successful!</strong>
                <p>{success}</p>

                {selectedTicket?.ticket_id && (
                  <button
                    type="button"
                    className="es-inline-ticket-button"
                    onClick={() => setSelectedTicket(selectedTicket)}
                  >
                    <Ticket size={15} />
                    View your digital ticket
                    <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            </div>
          )}

          {ticketMessage && !selectedTicket && (
            <div className="es-alert es-alert-error" role="status">
              <Info size={19} />
              <span>{ticketMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="es-field">
              <label htmlFor="attendee-name">
                Full Name <b>*</b>
              </label>

              <div
                className={`es-input-box ${
                  errors.name ? "is-invalid" : ""
                }`}
              >
                <UserRound size={20} />

                <input
                  id="attendee-name"
                  name="name"
                  type="text"
                  placeholder="Enter your full name"
                  autoComplete="name"
                  value={form.name}
                  onChange={handleChange}
                  maxLength={150}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={
                    errors.name ? "attendee-name-error" : undefined
                  }
                  required
                />

                {form.name.trim().length >= 2 && !errors.name && (
                  <Check className="es-valid-icon" size={19} />
                )}
              </div>

              {errors.name && (
                <small id="attendee-name-error" className="es-error-text">
                  {errors.name}
                </small>
              )}
            </div>

            <div className="es-field">
              <label htmlFor="attendee-email">
                Email Address <b>*</b>
              </label>

              <div
                className={`es-input-box ${
                  errors.email ? "is-invalid" : ""
                }`}
              >
                <Mail size={20} />

                <input
                  id="attendee-email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={form.email}
                  onChange={handleChange}
                  maxLength={254}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={
                    errors.email ? "attendee-email-error" : undefined
                  }
                  required
                />

                {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                  form.email.trim()
                ) &&
                  !errors.email && (
                    <Check className="es-valid-icon" size={19} />
                  )}
              </div>

              {errors.email && (
                <small id="attendee-email-error" className="es-error-text">
                  {errors.email}
                </small>
              )}
            </div>

            <div className="es-field">
              <label htmlFor="attendee-phone">
                Phone Number <b>*</b>
              </label>

              <div
                className={`es-input-box ${
                  errors.phone ? "is-invalid" : ""
                }`}
              >
                <Phone size={20} />

                <input
                  id="attendee-phone"
                  name="phone"
                  type="tel"
                  placeholder="9876543210"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={handleChange}
                  maxLength={20}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={
                    errors.phone ? "attendee-phone-error" : undefined
                  }
                  required
                />

                {form.phone.replace(/\D/g, "").length >= 7 &&
                  !errors.phone && (
                    <Check className="es-valid-icon" size={19} />
                  )}
              </div>

              {errors.phone && (
                <small id="attendee-phone-error" className="es-error-text">
                  {errors.phone}
                </small>
              )}
            </div>

            <div className="es-field">
              <label htmlFor="attendee-event">
                Choose Your Event <b>*</b>
              </label>

              <div
                className={`es-input-box es-select-box ${
                  errors.event_id ? "is-invalid" : ""
                }`}
              >
                <CalendarDays size={20} />

                <select
                  id="attendee-event"
                  name="event_id"
                  value={form.event_id}
                  onChange={handleChange}
                  disabled={loadingEvents || events.length === 0}
                  aria-invalid={Boolean(errors.event_id)}
                  aria-describedby={
                    errors.event_id ? "attendee-event-error" : undefined
                  }
                  required
                >
                  <option value="">
                    {loadingEvents ? "Loading events..." : "Choose an event"}
                  </option>

                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </div>

              {errors.event_id && (
                <small id="attendee-event-error" className="es-error-text">
                  {errors.event_id}
                </small>
              )}

              {eventsError && (
                <div className="es-event-load-message">
                  <span>{eventsError}</span>

                  <button
                    type="button"
                    onClick={loadEvents}
                    disabled={loadingEvents}
                  >
                    {loadingEvents ? "Loading..." : "Retry"}
                  </button>
                </div>
              )}

              {selectedEvent && (
                <div className="es-selected-event-preview">
                  <span>
                    <CalendarDays size={15} />
                    {formatDate(selectedEvent.date)}
                  </span>

                  <span>
                    <MapPin size={15} />
                    {selectedEvent.venue || "Venue to be announced"}
                  </span>
                </div>
              )}
            </div>

            <fieldset className="es-category-field">
              <legend>
                Attendee Category <b>*</b>
              </legend>

              <div className="es-category-options">
                {CATEGORIES.map((category) => (
                  <label className="es-category-option" key={category.value}>
                    <input
                      type="radio"
                      name="category"
                      value={category.value}
                      checked={form.category === category.value}
                      onChange={handleChange}
                    />

                    <span
                      className="es-radio-custom"
                      style={{ "--category-color": category.color }}
                    />

                    <span>{category.value}</span>
                  </label>
                ))}
              </div>

              {errors.category && (
                <small className="es-error-text">{errors.category}</small>
              )}
            </fieldset>

            <button
              className="es-register-button"
              type="submit"
              disabled={
                submitting || loadingEvents || events.length === 0
              }
            >
              {submitting ? (
                <>
                  <LoaderCircle className="es-spin" size={20} />
                  Registering...
                </>
              ) : (
                <>
                  <UserPlus size={20} />
                  Complete Registration
                  <ArrowUpRight size={17} className="es-button-arrow" />
                </>
              )}
            </button>

            <div className="es-form-notice">
              <Info size={18} />
              <span>
                Please check your details before submitting your
                registration.
              </span>
            </div>
          </form>
        </section>

        <aside className="es-event-card">
          <div className="es-sidebar-heading">
            <div>
              <span className="es-eyebrow">YOUR EVENT SPACE</span>
              <h2>Your Registered Events</h2>
              <p>All your event bookings, in one place.</p>
            </div>

            <button
              type="button"
              className="es-refresh-button"
              onClick={handleRefresh}
              disabled={loadingRegistrations || loadingEvents}
              aria-label="Refresh registered events"
              title="Refresh registered events"
            >
              <RefreshCw
                size={17}
                className={
                  loadingRegistrations || loadingEvents ? "es-spin" : ""
                }
              />
            </button>
          </div>

          <div className="es-registration-summary">
            <div className="es-summary-icon">
              <Ticket size={20} />
            </div>

            <div>
              <strong>{registeredEvents.length}</strong>
              <span>
                {registeredEvents.length === 1
                  ? "event registered"
                  : "events registered"}
              </span>
            </div>

            <span className="es-summary-caption">YOUR BOOKINGS</span>
          </div>

          {loadingRegistrations ? (
            <div className="es-registration-state">
              <LoaderCircle size={22} className="es-spin" />
              <span>Loading registrations...</span>
            </div>
          ) : registrationsError ? (
            <div className="es-registration-state es-registration-error">
              <AlertCircle size={22} />
              <p>{registrationsError}</p>

              <button type="button" onClick={handleRefresh}>
                Try again
              </button>
            </div>
          ) : registeredEvents.length === 0 ? (
            <div className="es-registration-state es-empty-registrations">
              <Ticket size={28} />
              <strong>No bookings yet</strong>
              <p>Register for an event and it will appear here.</p>
            </div>
          ) : (
            <div className="es-registered-events">
              {registeredEvents.map((registration) => (
                <article
                  className="es-registered-event"
                  key={registration.id}
                >
                  <div className="es-registered-event-top">
                    <span className="es-registered-event-icon">
                      <CalendarDays size={17} />
                    </span>

                    <span
                      className={`es-registration-status ${
                        ["registered", "confirmed"].includes(
                          registration.status
                        )
                          ? "is-confirmed"
                          : ""
                      }`}
                    >
                      <CheckCircle2 size={13} />
                      {getStatusLabel(registration.status)}
                    </span>
                  </div>

                  <h3>{registration.name}</h3>

                  <div className="es-compact-detail">
                    <CalendarDays size={15} />
                    <span>{formatDate(registration.date)}</span>
                  </div>

                  <div className="es-compact-detail">
                    <MapPin size={15} />
                    <span>
                      {registration.venue || "Venue to be announced"}
                    </span>
                  </div>

                  <div className="es-registered-event-bottom">
                    <span className="es-category-pill">
                      <Tag size={13} />
                      {registration.category}
                    </span>
                  </div>

                  {registration.ticket?.ticket_id ? (
                    <div className="es-ticket-preview">
                      <div className="es-ticket-preview-info">
                        <Ticket size={16} />

                        <div>
                          <strong>Digital ticket ready</strong>
                          <span>{registration.ticket.ticket_id}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="es-view-ticket-button"
                        onClick={() =>
                          openRegistrationTicket(registration)
                        }
                      >
                        <QrCode size={16} />
                        View ticket
                      </button>
                    </div>
                  ) : (
                    <div className="es-ticket-pending">
                      <Info size={15} />
                      <span>Digital ticket not available yet</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          <p className="es-event-footer">
            We look forward to seeing you at the event!
          </p>
        </aside>
      </main>

      <footer className="es-footer">
        EventSphere <span>·</span> Every event starts with a connection.
      </footer>

      {selectedTicket && (
        <div
          className="es-ticket-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeTicket();
            }
          }}
        >
          <section
            className="es-ticket-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="es-ticket-title"
          >
            <div className="es-ticket-modal-header">
              <div>
                <span className="es-eyebrow">
                  EVENTSPHERE DIGITAL PASS
                </span>

                <h2 id="es-ticket-title">Your Event Ticket</h2>
              </div>

              <button
                type="button"
                className="es-ticket-close"
                onClick={closeTicket}
                aria-label="Close ticket"
              >
                <X size={21} />
              </button>
            </div>

            <div className="es-ticket-brand">
              <CalendarDays size={25} />
              <span>EventSphere</span>

              <span
                className={`es-ticket-status ${
                  String(selectedTicket.status).toLowerCase() === "valid"
                    ? "is-valid"
                    : "is-not-valid"
                }`}
              >
                <ShieldCheck size={14} />
                {getStatusLabel(selectedTicket.status)}
              </span>
            </div>

            <div className="es-ticket-event-details">
              <span className="es-eyebrow">YOU ARE REGISTERED FOR</span>
              <h3>{selectedTicket.event_name}</h3>

              <div className="es-ticket-detail-row">
                <CalendarDays size={17} />
                <span>{formatDate(selectedTicket.event_date)}</span>
              </div>

              <div className="es-ticket-detail-row">
                <MapPin size={17} />
                <span>
                  {selectedTicket.venue || "Venue to be announced"}
                </span>
              </div>

              <div className="es-ticket-detail-row">
                <UserRound size={17} />
                <span>
                  {selectedTicket.attendee_name || user?.name || "Attendee"}
                </span>
              </div>

              <div className="es-ticket-detail-row">
                <Tag size={17} />
                <span>{selectedTicket.category || "General"} category</span>
              </div>
            </div>

            <div className="es-ticket-qr-section">
              {loadingTicket && !selectedTicket.qr_code ? (
                <div className="es-ticket-qr-missing">
                  <LoaderCircle size={38} className="es-spin" />
                  <strong>Loading ticket QR code...</strong>
                  <p>Please wait while we retrieve your ticket.</p>
                </div>
              ) : isValidImageData(selectedTicket.qr_code) ? (
                <img
                  className="es-ticket-qr"
                  src={selectedTicket.qr_code}
                  alt={`QR code for ticket ${selectedTicket.ticket_id}`}
                />
              ) : (
                <div className="es-ticket-qr-missing">
                  <QrCode size={38} />
                  <strong>QR code unavailable</strong>
                  <p>
                    The server did not return a QR image for this ticket.
                    Refresh your registrations or contact the event organizer.
                  </p>
                </div>
              )}

              <p>
                Present this QR code to the event organizer for verification.
              </p>
            </div>

            <div className="es-ticket-id-box">
              <div>
                <span>TICKET ID</span>
                <strong>{selectedTicket.ticket_id}</strong>
              </div>

              <button
                type="button"
                onClick={copyTicketId}
                aria-label="Copy ticket ID"
                title="Copy ticket ID"
              >
                {copiedTicketId ? (
                  <Check size={17} />
                ) : (
                  <Copy size={17} />
                )}
              </button>
            </div>

            {copiedTicketId && (
              <p className="es-ticket-copy-message">
                Ticket ID copied.
              </p>
            )}

            {selectedTicket.checked_in_at && (
              <p className="es-ticket-checkin-note">
                This ticket has been checked in.
              </p>
            )}

            {ticketMessage && (
              <div className="es-alert es-alert-error" role="status">
                <Info size={18} />
                <span>{ticketMessage}</span>
              </div>
            )}

            <div className="es-ticket-actions">
              <button
                type="button"
                className="es-ticket-download-button"
                onClick={downloadTicketQr}
                disabled={!isValidImageData(selectedTicket.qr_code)}
              >
                <Download size={17} />
                Download QR code
              </button>

              <button
                type="button"
                className="es-ticket-done-button"
                onClick={closeTicket}
              >
                Done
              </button>
            </div>

            <p className="es-ticket-disclaimer">
              Keep your ticket ID and QR code safe. Ticket validity is
              determined by the EventSphere server.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}