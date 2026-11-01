// src/pages/Attendance.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Activity,
  AlertCircle,
  Ban,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from "lucide-react";

import { Html5Qrcode } from "html5-qrcode";
import "./Attendance.css";

const API_BASE = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api"
).replace(/\/+$/, "");

const PAGE_SIZE = 10;
const SCANNER_ID = "eventsphere-qr-reader";

const STATUS = {
  VALID: "Valid",
  USED: "Used",
  CANCELLED: "Cancelled",
  UNKNOWN: "Unknown",
};

const ATTENDANCE_FILTER = {
  ALL: "All",
  PRESENT: "Present",
  ABSENT: "Absent",
  PENDING: "Pending",
  CANCELLED: "Cancelled",
  UNKNOWN: "Unknown",
};

function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    sessionStorage.getItem("token") ||
    sessionStorage.getItem("access_token") ||
    ""
  );
}

function getUser() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const value = storage.getItem("user");

      if (value) return JSON.parse(value);
    } catch {
      // Ignore invalid stored user data.
    }
  }

  return null;
}

function normalizeRole(user) {
  return String(user?.role || "").trim().toLowerCase();
}

async function apiRequest(path, options = {}) {
  const token = getToken();

  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Cannot connect to EventSphere. Check that the backend is running."
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => null);
  } else {
    const message = await response.text().catch(() => "");
    data = message ? { detail: message } : null;
  }

  if (!response.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      data?.error ||
      `Request failed with status ${response.status}.`;

    if (response.status === 401) {
      throw new Error("Your session has expired. Please log in again.");
    }

    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }

  return data;
}

function ticketId(ticket) {
  return String(
    ticket?.ticket_id ||
      ticket?.ticketId ||
      ticket?.id ||
      ticket?._id ||
      ""
  );
}

function attendeeName(ticket) {
  return (
    ticket?.attendee_name ||
    ticket?.attendeeName ||
    ticket?.full_name ||
    ticket?.name ||
    ticket?.attendee?.name ||
    ticket?.attendee?.full_name ||
    ticket?.attendee_email ||
    ticket?.email ||
    "Unknown attendee"
  );
}

function attendeeEmail(ticket) {
  return (
    ticket?.attendee_email ||
    ticket?.attendeeEmail ||
    ticket?.email ||
    ticket?.user_email ||
    ticket?.userEmail ||
    ticket?.attendee?.email ||
    ticket?.user?.email ||
    ticket?.registration?.email ||
    ticket?.registration?.attendee_email ||
    "—"
  );
}

function eventId(ticket) {
  return String(
    ticket?.event_id ||
      ticket?.eventId ||
      ticket?.event?._id ||
      ticket?.event?.id ||
      ""
  );
}

function eventName(ticket) {
  return (
    ticket?.event_name ||
    ticket?.eventName ||
    ticket?.event_title ||
    ticket?.title ||
    ticket?.event?.name ||
    ticket?.event?.title ||
    "Unnamed event"
  );
}

function getRawEventDate(ticket) {
  return (
    ticket?.event_date ||
    ticket?.eventDate ||
    ticket?.date ||
    ticket?.event?.event_date ||
    ticket?.event?.date ||
    ""
  );
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : {}),
  });
}

function eventDate(ticket) {
  return formatDate(getRawEventDate(ticket));
}

function issuedDate(ticket) {
  return formatDate(
    ticket?.created_at ||
      ticket?.createdAt ||
      ticket?.issued_at ||
      ticket?.issuedAt,
    true
  );
}

function checkInDate(ticket) {
  return formatDate(
    ticket?.checked_in_at ||
      ticket?.check_in_time ||
      ticket?.checkin_time ||
      ticket?.attended_at,
    true
  );
}

/**
 * Determines whether an event has already passed.
 *
 * If the backend supplies only a date, the event is considered past
 * after that calendar day ends.
 *
 * If the backend supplies a timestamp, that timestamp is used.
 */
function hasEventPassed(ticket) {
  const rawDate = getRawEventDate(ticket);

  if (!rawDate) return false;

  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) return false;

  const dateOnly =
    typeof rawDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate);

  if (dateOnly) {
    const endOfEventDay = new Date(parsedDate);
    endOfEventDay.setHours(23, 59, 59, 999);

    return endOfEventDay.getTime() < Date.now();
  }

  return parsedDate.getTime() < Date.now();
}

function normalizeStatus(ticket) {
  const raw = String(ticket?.status ?? ticket?.ticket_status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    ticket?.is_cancelled === true ||
    raw === "cancelled" ||
    raw === "canceled" ||
    raw === "refunded"
  ) {
    return STATUS.CANCELLED;
  }

  if (
    ticket?.checked_in === true ||
    ticket?.is_checked_in === true ||
    raw === "used" ||
    raw === "checked_in" ||
    raw === "attended"
  ) {
    return STATUS.USED;
  }

  if (raw === "valid" || raw === "active") {
    return STATUS.VALID;
  }

  return STATUS.UNKNOWN;
}

/**
 * Attendance mapping:
 * Used      -> Present
 * Valid     -> Absent if event passed, otherwise Pending
 * Cancelled -> Cancelled
 */
function getAttendanceStatus(ticket) {
  const status = normalizeStatus(ticket);

  if (status === STATUS.USED) {
    return ATTENDANCE_FILTER.PRESENT;
  }

  if (status === STATUS.VALID) {
    return hasEventPassed(ticket)
      ? ATTENDANCE_FILTER.ABSENT
      : ATTENDANCE_FILTER.PENDING;
  }

  if (status === STATUS.CANCELLED) {
    return ATTENDANCE_FILTER.CANCELLED;
  }

  return ATTENDANCE_FILTER.UNKNOWN;
}

function extractTickets(data) {
  if (Array.isArray(data)) return data;

  const candidates = [
    data?.tickets,
    data?.items,
    data?.registrations,
    data?.results,
    data?.data?.tickets,
    data?.data?.items,
    data?.data,
  ];

  return candidates.find(Array.isArray) || [];
}

function unwrapTicket(data) {
  if (!data || typeof data !== "object") return null;

  if (data.ticket && typeof data.ticket === "object") {
    return data.ticket;
  }

  if (data.data?.ticket && typeof data.data.ticket === "object") {
    return data.data.ticket;
  }

  if (
    data.data &&
    typeof data.data === "object" &&
    !Array.isArray(data.data)
  ) {
    return data.data;
  }

  return data;
}

function qrTicketCode(value) {
  const code = String(value || "").trim();

  if (!code) return "";

  try {
    const url = new URL(code);

    return (
      url.searchParams.get("ticketId") ||
      url.searchParams.get("ticket_id") ||
      url.searchParams.get("ticket") ||
      url.pathname.split("/").filter(Boolean).pop() ||
      code
    );
  } catch {
    return code;
  }
}

function downloadCSV(tickets, selectedEventName = "All events") {
  const headings = [
    "Event",
    "Ticket ID",
    "Attendee",
    "Email",
    "Event Date",
    "Attendance",
    "Ticket Status",
    "Issued At",
    "Checked In At",
  ];

  const rows = tickets.map((ticket) => [
    eventName(ticket),
    ticketId(ticket),
    attendeeName(ticket),
    attendeeEmail(ticket),
    eventDate(ticket),
    getAttendanceStatus(ticket),
    normalizeStatus(ticket),
    issuedDate(ticket),
    checkInDate(ticket),
  ]);

  const escape = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csv = [headings, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");

  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `eventsphere-attendance-${selectedEventName
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()}.csv`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Pie chart built with CSS conic-gradient.
 * Present and absent use green shades.
 * Cancelled tickets and future pending tickets are excluded.
 */
function AttendancePieChart({ present, absent }) {
  const total = present + absent;

  const presentPercentage =
    total > 0 ? (present / total) * 100 : 0;

  const absentPercentage =
    total > 0 ? (absent / total) * 100 : 0;

  const chartStyle = {
    background:
      total === 0
        ? "conic-gradient(#e5e7eb 0deg 360deg)"
        : `conic-gradient(
            #15803d 0% ${presentPercentage}%,
            #86efac ${presentPercentage}% 100%
          )`,
  };

  return (
    <section className="attendance-panel attendance-chart-panel">
      <div className="attendance-panel-heading">
        <div>
          <span className="attendance-section-kicker">
            ATTENDANCE OVERVIEW
          </span>

          <h2>
            <Activity size={20} />
            Present vs Absent
          </h2>

          <p>
            Attendance for registered attendees, excluding cancelled tickets
            and future event registrations.
          </p>
        </div>
      </div>

      <div className="attendance-chart-content">
        <div
          className="attendance-pie-chart"
          style={chartStyle}
          role="img"
          aria-label={`${present} present and ${absent} absent`}
        >
          <div className="attendance-pie-center">
            <strong>{total}</strong>
            <span>Attendees</span>
          </div>
        </div>

        <div className="attendance-chart-legend">
          <div className="attendance-chart-legend-item">
            <span className="attendance-chart-dot attendance-chart-dot--present" />

            <div>
              <strong>Present</strong>
              <small>
                {present} attendee{present === 1 ? "" : "s"}
              </small>
            </div>

            <span className="attendance-chart-percentage">
              {presentPercentage.toFixed(1)}%
            </span>
          </div>

          <div className="attendance-chart-legend-item">
            <span className="attendance-chart-dot attendance-chart-dot--absent" />

            <div>
              <strong>Absent</strong>
              <small>
                {absent} attendee{absent === 1 ? "" : "s"}
              </small>
            </div>

            <span className="attendance-chart-percentage">
              {absentPercentage.toFixed(1)}%
            </span>
          </div>

          {total === 0 && (
            <p className="attendance-chart-empty">
              No completed-event attendance data available yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ ticket }) {
  const status = normalizeStatus(ticket);

  const icon =
    status === STATUS.VALID ? (
      <CheckCircle2 size={14} />
    ) : status === STATUS.USED ? (
      <ClipboardCheck size={14} />
    ) : status === STATUS.CANCELLED ? (
      <Ban size={14} />
    ) : (
      <AlertCircle size={14} />
    );

  return (
    <span
      className={`attendance-status attendance-status--${status
        .toLowerCase()
        .replace(/\s+/g, "-")}`}
    >
      {icon}
      {status}
    </span>
  );
}

function AttendanceBadge({ ticket }) {
  const attendance = getAttendanceStatus(ticket);

  const icon =
    attendance === ATTENDANCE_FILTER.PRESENT ? (
      <CheckCircle2 size={14} />
    ) : attendance === ATTENDANCE_FILTER.ABSENT ? (
      <AlertCircle size={14} />
    ) : attendance === ATTENDANCE_FILTER.PENDING ? (
      <CalendarDays size={14} />
    ) : attendance === ATTENDANCE_FILTER.CANCELLED ? (
      <Ban size={14} />
    ) : (
      <AlertCircle size={14} />
    );

  return (
    <span
      className={`attendance-status attendance-status--${attendance
        .toLowerCase()
        .replace(/\s+/g, "-")}`}
    >
      {icon}
      {attendance}
    </span>
  );
}

function StatCard({ icon, label, value, description, variant }) {
  return (
    <article className="attendance-stat-card">
      <div className="attendance-stat-top">
        <span>{label}</span>

        <span
          className={`attendance-stat-icon attendance-stat-icon--${variant}`}
        >
          {icon}
        </span>
      </div>

      <strong className="attendance-stat-value">{value}</strong>
      <small>{description}</small>
    </article>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="attendance-detail-row">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <LoaderCircle
      size={size}
      className="attendance-spin"
      aria-hidden="true"
    />
  );
}

export default function Attendance() {
  const user = getUser();
  const role = normalizeRole(user);

  const isOrganizer = role === "organizer" || role === "admin";
  const isAttendee = role === "attendee";
  const authenticated = Boolean(getToken());

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selectedEventId, setSelectedEventId] = useState("all");
  const [search, setSearch] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState(
    ATTENDANCE_FILTER.ALL
  );
  const [page, setPage] = useState(1);

  const [activeTicket, setActiveTicket] = useState(null);
  const [verification, setVerification] = useState(null);
  const [actionLoading, setActionLoading] = useState("");

  const [ticketCode, setTicketCode] = useState("");
  const [scannedTicket, setScannedTicket] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  const scannerRef = useRef(null);
  const scanHandledRef = useRef(false);

  const loadTickets = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const data = await apiRequest("/tickets");
      setTickets(extractTickets(data));
    } catch (err) {
      setError(err.message || "Unable to load tickets.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      loadTickets();
    } else {
      setLoading(false);
    }
  }, [authenticated, loadTickets]);

  // Unique events derived from the ticket records.
  const events = useMemo(() => {
    const eventMap = new Map();

    tickets.forEach((ticket) => {
      const id = eventId(ticket);

      if (!id) return;

      if (!eventMap.has(id)) {
        eventMap.set(id, {
          id,
          name: eventName(ticket),
          date: eventDate(ticket),
        });
      }
    });

    return Array.from(eventMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [tickets]);

  // Tickets belonging to the selected event.
  const eventTickets = useMemo(() => {
    if (selectedEventId === "all") {
      return tickets;
    }

    return tickets.filter(
      (ticket) => eventId(ticket) === selectedEventId
    );
  }, [tickets, selectedEventId]);

  // Attendance statistics for the selected event or all events.
  const statistics = useMemo(() => {
    const result = {
      total: 0,
      present: 0,
      absent: 0,
      pending: 0,
      cancelled: 0,
      unknown: 0,
    };

    eventTickets.forEach((ticket) => {
      const attendance = getAttendanceStatus(ticket);

      if (attendance === ATTENDANCE_FILTER.CANCELLED) {
        result.cancelled += 1;
        return;
      }

      if (attendance === ATTENDANCE_FILTER.PRESENT) {
        result.present += 1;
        result.total += 1;
        return;
      }

      if (attendance === ATTENDANCE_FILTER.ABSENT) {
        result.absent += 1;
        result.total += 1;
        return;
      }

      if (attendance === ATTENDANCE_FILTER.PENDING) {
        result.pending += 1;
        return;
      }

      result.unknown += 1;
    });

    return result;
  }, [eventTickets]);

  const attendancePercentage =
    statistics.total > 0
      ? Math.round((statistics.present / statistics.total) * 100)
      : 0;

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return eventTickets.filter((ticket) => {
      const attendance = getAttendanceStatus(ticket);

      const matchesAttendance =
        attendanceFilter === ATTENDANCE_FILTER.ALL ||
        attendance === attendanceFilter;

      const searchable = [
        ticketId(ticket),
        attendeeName(ticket),
        attendeeEmail(ticket),
        eventName(ticket),
      ]
        .join(" ")
        .toLowerCase();

      return matchesAttendance && (!query || searchable.includes(query));
    });
  }, [eventTickets, search, attendanceFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTickets.length / PAGE_SIZE)
  );

  const currentPage = Math.min(page, totalPages);

  const visibleTickets = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;

    return filteredTickets.slice(start, start + PAGE_SIZE);
  }, [filteredTickets, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [search, attendanceFilter, selectedEventId]);

  const selectedEvent = events.find(
    (event) => event.id === selectedEventId
  );

  const selectedEventName =
    selectedEvent?.name ||
    (selectedEventId === "all" ? "All events" : "Selected event");

  const updateTicketLocally = (id, patch) => {
    const targetId = String(id);

    setTickets((previous) =>
      previous.map((ticket) =>
        ticketId(ticket) === targetId
          ? { ...ticket, ...patch }
          : ticket
      )
    );

    setActiveTicket((previous) =>
      previous && ticketId(previous) === targetId
        ? { ...previous, ...patch }
        : previous
    );

    setScannedTicket((previous) =>
      previous && ticketId(previous) === targetId
        ? { ...previous, ...patch }
        : previous
    );
  };

  const openTicket = (ticket) => {
    setActiveTicket(ticket);
    setVerification(null);
    setError("");
    setNotice("");
  };

  const closeTicket = () => {
    if (actionLoading) return;

    setActiveTicket(null);
    setVerification(null);
  };

  const verifyTicket = async (ticket) => {
    if (!isOrganizer) {
      setError("Only organizers and administrators can verify tickets.");
      return;
    }

    const id = ticketId(ticket);

    if (!id) {
      setError("This ticket does not have a ticket ID.");
      return;
    }

    setActionLoading(`verify:${id}`);
    setError("");
    setNotice("");
    setVerification(null);

    try {
      const result = await apiRequest(
        `/tickets/verify/${encodeURIComponent(id)}`
      );

      setVerification(result);

      const returnedTicket = unwrapTicket(result);

      if (returnedTicket && ticketId(returnedTicket)) {
        updateTicketLocally(id, returnedTicket);
      }

      setNotice(
        result?.message ||
          result?.ticket?.message ||
          "Ticket verification completed."
      );
    } catch (err) {
      setError(err.message || "Unable to verify ticket.");
    } finally {
      setActionLoading("");
    }
  };

  const checkInTicket = async (ticket) => {
    if (!isOrganizer) {
      setError("Only organizers and administrators can record attendance.");
      return false;
    }

    const id = ticketId(ticket);

    if (!id) {
      setError("This ticket does not have a ticket ID.");
      return false;
    }

    if (normalizeStatus(ticket) !== STATUS.VALID) {
      setError("Only valid tickets can be checked in.");
      return false;
    }

    const confirmed = window.confirm(
      `Mark attendance for ${attendeeName(ticket)}?\n\n` +
        `Event: ${eventName(ticket)}\nTicket: ${id}`
    );

    if (!confirmed) return false;

    setActionLoading(`checkin:${id}`);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest(
        `/tickets/${encodeURIComponent(id)}/check-in`,
        { method: "POST" }
      );

      const returned = unwrapTicket(result);

      updateTicketLocally(id, {
        ...(returned && ticketId(returned) ? returned : {}),
        status: returned?.status || STATUS.USED,
        checked_in: true,
        checked_in_at:
          returned?.checked_in_at ||
          returned?.check_in_time ||
          new Date().toISOString(),
      });

      setNotice(
        result?.message ||
          `${attendeeName(ticket)} checked in successfully.`
      );

      setScannerMessage("Attendance recorded successfully.");

      return true;
    } catch (err) {
      setError(err.message || "Unable to check in this ticket.");
      return false;
    } finally {
      setActionLoading("");
    }
  };

  const cancelTicket = async (ticket) => {
    if (!isOrganizer) {
      setError("Only organizers and administrators can cancel tickets.");
      return;
    }

    const id = ticketId(ticket);

    if (!id) {
      setError("This ticket does not have a ticket ID.");
      return;
    }

    if (normalizeStatus(ticket) !== STATUS.VALID) {
      setError("Only valid tickets can be cancelled.");
      return;
    }

    if (
      !window.confirm(
        `Cancel ticket ${id}? This action may not be reversible.`
      )
    ) {
      return;
    }

    setActionLoading(`cancel:${id}`);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest(
        `/tickets/${encodeURIComponent(id)}/cancel`,
        { method: "PATCH" }
      );

      const returned = unwrapTicket(result);

      updateTicketLocally(id, {
        ...(returned && ticketId(returned) ? returned : {}),
        status: returned?.status || STATUS.CANCELLED,
        is_cancelled: true,
      });

      setVerification(null);

      setNotice(result?.message || "Ticket cancelled successfully.");
    } catch (err) {
      setError(err.message || "Unable to cancel ticket.");
    } finally {
      setActionLoading("");
    }
  };

  const findTicketInList = useCallback(
    (value) => {
      const code = qrTicketCode(value).trim().toLowerCase();

      return (
        tickets.find(
          (ticket) => ticketId(ticket).trim().toLowerCase() === code
        ) || null
      );
    },
    [tickets]
  );

  const searchTicketCode = async (value = ticketCode) => {
    if (!isOrganizer) {
      setError("Only organizers and administrators can scan tickets.");
      return;
    }

    const code = qrTicketCode(value).trim();

    if (!code) {
      setError("Enter a ticket ID or scan a QR code.");
      return;
    }

    setLookupLoading(true);
    setError("");
    setNotice("");
    setScannerMessage("");
    setScannedTicket(null);

    try {
      let ticket = findTicketInList(code);

      if (!ticket) {
        const result = await apiRequest(
          `/tickets/verify/${encodeURIComponent(code)}`
        );

        ticket = unwrapTicket(result);

        if (!ticket || !ticketId(ticket)) {
          throw new Error("No ticket was found for this code.");
        }
      }

      setScannedTicket(ticket);
      setTicketCode(ticketId(ticket));

      const attendance = getAttendanceStatus(ticket);

      if (attendance === ATTENDANCE_FILTER.PRESENT) {
        setScannerMessage("This attendee has already checked in.");
      } else if (attendance === ATTENDANCE_FILTER.CANCELLED) {
        setScannerMessage("This ticket has been cancelled.");
      } else if (attendance === ATTENDANCE_FILTER.ABSENT) {
        setScannerMessage(
          "Ticket found. Review the details before marking attendance."
        );
      } else if (attendance === ATTENDANCE_FILTER.PENDING) {
        setScannerMessage(
          "Ticket found. The event has not passed yet."
        );
      } else {
        setScannerMessage("The ticket status could not be confirmed.");
      }
    } catch (err) {
      setError(err.message || "Unable to find this ticket.");
    } finally {
      setLookupLoading(false);
    }
  };

  const stopQrScanner = useCallback(async () => {
    const scanner = scannerRef.current;

    scannerRef.current = null;

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // Scanner may already have stopped.
      }

      try {
        await scanner.clear();
      } catch {
        // Scanner may already have been cleared.
      }
    }

    setScannerOpen(false);
    setScannerStarting(false);
  }, []);

  const startQrScanner = () => {
    if (!isOrganizer) {
      setError("Only organizers and administrators can scan tickets.");
      return;
    }

    setError("");
    setNotice("");
    setScannerMessage("");
    scanHandledRef.current = false;
    setScannerStarting(true);
    setScannerOpen(true);
  };

  useEffect(() => {
    if (!scannerOpen || !isOrganizer) return undefined;

    let cancelled = false;
    let scanner;

    async function initializeScanner() {
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 120));

        if (cancelled) return;

        scanner = new Html5Qrcode(SCANNER_ID);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 230, height: 230 },
            aspectRatio: 1,
          },
          async (decodedText) => {
            if (cancelled || scanHandledRef.current) return;

            scanHandledRef.current = true;

            try {
              if (scanner.isScanning) {
                await scanner.stop();
              }
            } catch {
              // Continue with the decoded value.
            }

            if (cancelled) return;

            setScannerOpen(false);
            setScannerStarting(false);

            const decodedCode = qrTicketCode(decodedText);

            setTicketCode(decodedCode);

            await searchTicketCode(decodedCode);
          },
          () => {
            // Ignore normal scan-frame misses.
          }
        );

        if (!cancelled) {
          setScannerStarting(false);
        }
      } catch {
        if (!cancelled) {
          setError(
            "Could not open the camera. Allow camera access or enter the ticket ID manually."
          );

          setScannerOpen(false);
          setScannerStarting(false);
        }

        if (scanner) {
          try {
            if (scanner.isScanning) {
              await scanner.stop();
            }
          } catch {
            // Ignore cleanup errors.
          }

          try {
            await scanner.clear();
          } catch {
            // Ignore cleanup errors.
          }
        }

        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
      }
    }

    initializeScanner();

    return () => {
      cancelled = true;

      if (scanner) {
        const cleanup = async () => {
          try {
            if (scanner.isScanning) {
              await scanner.stop();
            }
          } catch {
            // Ignore cleanup errors.
          }

          try {
            await scanner.clear();
          } catch {
            // Ignore cleanup errors.
          }

          if (scannerRef.current === scanner) {
            scannerRef.current = null;
          }
        };

        cleanup();
      }
    };
  }, [scannerOpen, isOrganizer]);

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current;

      if (!scanner) return;

      const cleanup = async () => {
        try {
          if (scanner.isScanning) {
            await scanner.stop();
          }
        } catch {
          // Ignore cleanup errors.
        }

        try {
          await scanner.clear();
        } catch {
          // Ignore cleanup errors.
        }
      };

      cleanup();
      scannerRef.current = null;
    };
  }, []);

  const handleExport = () => {
    if (!filteredTickets.length) {
      setError("There are no attendance records to export.");
      return;
    }

    downloadCSV(filteredTickets, selectedEventName);
    setError("");
    setNotice("Attendance CSV downloaded successfully.");
  };

  if (!authenticated) {
    return (
      <main className="attendance-page">
        

        <section className="attendance-panel attendance-login-message">
          <ShieldCheck size={30} />

          <div>
            <h2>Login required</h2>
            <p>
              Please log in to view attendance and ticket information.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="attendance-page">
      

      <header className="attendance-header">
        <div className="attendance-heading-copy">
          <div className="attendance-eyebrow">
            
            EVENTSPHERE MANAGEMENT
          </div>

          <h1>Attendance &amp; Tickets</h1>

          <p>
            {isOrganizer
              ? "View event registrations, track attendance, and check attendees in."
              : isAttendee
              ? "View your tickets and their current attendance status."
              : "View the ticket information available to your account."}
          </p>
        </div>

        <div className="attendance-header-actions">
          <button
            className="attendance-button attendance-button--secondary"
            type="button"
            onClick={() => loadTickets({ silent: true })}
            disabled={loading || refreshing}
          >
            {refreshing ? <Spinner /> : <RefreshCw size={16} />}
            Refresh
          </button>

          {isOrganizer && (
            <button
              className="attendance-button attendance-button--primary"
              type="button"
              onClick={handleExport}
              disabled={!filteredTickets.length}
            >
              <Download size={16} />
              Export CSV
            </button>
          )}
        </div>
      </header>

      {error && (
        <div
          className="attendance-alert attendance-alert--error"
          role="alert"
        >
          <AlertCircle size={18} />
          <span>{error}</span>

          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {notice && (
        <div
          className="attendance-alert attendance-alert--success"
          role="status"
        >
          <CheckCircle2 size={18} />
          <span>{notice}</span>

          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Event selector */}
      {isOrganizer && (
        <section className="attendance-panel attendance-event-selector">
          <div className="attendance-panel-heading">
            <div>
              <span className="attendance-section-kicker">
                EVENT ATTENDANCE
              </span>

              <h2>
                <CalendarDays size={20} />
                Select an event
              </h2>

              <p>
                Choose an event to see its registered attendees and
                attendance.
              </p>
            </div>
          </div>

          <label
            className="attendance-filter attendance-event-select"
            htmlFor="attendance-event-select"
          >
            <span>Event</span>

            <select
              id="attendance-event-select"
              value={selectedEventId}
              onChange={(event) =>
                setSelectedEventId(event.target.value)
              }
            >
              <option value="all">All events</option>

              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                  {event.date && event.date !== "—"
                    ? ` · ${event.date}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {/* Attendance statistics */}
      <section className="attendance-stat-grid">
        <StatCard
          icon={<Users size={20} />}
          label="Registered"
          value={statistics.total + statistics.pending}
          description="Active registrations"
          variant="blue"
        />

        <StatCard
          icon={<CheckCircle2 size={20} />}
          label="Present"
          value={statistics.present}
          description="Checked in"
          variant="green"
        />

        <StatCard
          icon={<AlertCircle size={20} />}
          label="Absent"
          value={statistics.absent}
          description="Event has passed"
          variant="purple"
        />

        <StatCard
          icon={<Ban size={20} />}
          label="Cancelled"
          value={statistics.cancelled}
          description="Cancelled tickets"
          variant="orange"
        />
      </section>

      {/* Green-shaded attendance pie chart */}
      {isOrganizer && (
        <AttendancePieChart
          present={statistics.present}
          absent={statistics.absent}
        />
      )}

      {isOrganizer && (
        <section className="attendance-panel attendance-checkin-panel">
          <div className="attendance-panel-heading">
            <div>
              <span className="attendance-section-kicker">
                CHECK-IN DESK
              </span>

              <h2>
                <ScanLine size={20} />
                Event check-in
              </h2>

              <p>
                Scan an attendee's QR code or search by ticket ID.
              </p>
            </div>

            <span className="attendance-enabled-badge">
              <span />
              Check-in enabled
            </span>
          </div>

          <div className="attendance-scanner-layout">
            <div className="attendance-scanner-box">
              {scannerOpen ? (
                <div className="attendance-camera-active">
                  {scannerStarting && (
                    <div className="attendance-camera-loading">
                      <Spinner size={20} />
                      Starting camera…
                    </div>
                  )}

                  <div id={SCANNER_ID} />

                  <button
                    type="button"
                    className="attendance-button attendance-button--secondary"
                    onClick={stopQrScanner}
                  >
                    <X size={16} />
                    Stop scanner
                  </button>
                </div>
              ) : (
                <div className="attendance-scanner-placeholder">
                  <div className="attendance-scanner-icon">
                    <Camera size={30} />
                  </div>

                  <h3>Scan attendee ticket</h3>

                  <p>
                    Position the attendee's QR code inside the camera
                    frame.
                  </p>

                  <button
                    type="button"
                    className="attendance-button attendance-button--primary"
                    onClick={startQrScanner}
                  >
                    <ScanLine size={16} />
                    Open QR scanner
                  </button>
                </div>
              )}
            </div>

            <div className="attendance-code-search">
              <div className="attendance-search-heading">
                <span className="attendance-search-heading-icon">
                  <Search size={20} />
                </span>

                <div>
                  <h3>Find a ticket</h3>
                  <p>Use the code printed on the ticket.</p>
                </div>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  searchTicketCode();
                }}
              >
                <label htmlFor="attendance-ticket-code">
                  Ticket ID
                </label>

                <div className="attendance-code-input">
                  <input
                    id="attendance-ticket-code"
                    type="text"
                    placeholder="EVT-19B5E50C"
                    value={ticketCode}
                    onChange={(event) =>
                      setTicketCode(event.target.value)
                    }
                  />

                  <button
                    type="submit"
                    className="attendance-button attendance-button--primary"
                    disabled={lookupLoading || !ticketCode.trim()}
                  >
                    {lookupLoading ? <Spinner /> : <Search size={16} />}
                    Verify
                  </button>
                </div>
              </form>

              {scannerMessage && (
                <div
                  className="attendance-scanner-message"
                  role="status"
                >
                  <CheckCircle2 size={16} />
                  {scannerMessage}
                </div>
              )}

              {scannedTicket && (
                <div className="attendance-scanned-ticket">
                  <div className="attendance-scanned-heading">
                    <span className="attendance-scanned-icon">
                      <CheckCircle2 size={20} />
                    </span>

                    <div>
                      <h3>Attendee details</h3>
                      <p>{ticketId(scannedTicket)}</p>
                    </div>

                    <AttendanceBadge ticket={scannedTicket} />
                  </div>

                  <DetailRow
                    label="Name"
                    value={attendeeName(scannedTicket)}
                  />

                  <DetailRow
                    label="Email"
                    value={attendeeEmail(scannedTicket)}
                  />

                  <DetailRow
                    label="Event"
                    value={eventName(scannedTicket)}
                  />

                  <DetailRow
                    label="Event date"
                    value={eventDate(scannedTicket)}
                  />

                  {getAttendanceStatus(scannedTicket) ===
                    ATTENDANCE_FILTER.PRESENT && (
                    <DetailRow
                      label="Checked in at"
                      value={checkInDate(scannedTicket)}
                    />
                  )}

                  {normalizeStatus(scannedTicket) === STATUS.VALID && (
                    <button
                      type="button"
                      className="attendance-button attendance-button--primary attendance-checkin-button"
                      disabled={Boolean(actionLoading)}
                      onClick={() => checkInTicket(scannedTicket)}
                    >
                      {actionLoading ===
                      `checkin:${ticketId(scannedTicket)}` ? (
                        <Spinner />
                      ) : (
                        <ClipboardCheck size={17} />
                      )}
                      Mark attendance
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Attendee records */}
      <section className="attendance-panel attendance-records-panel">
        <div className="attendance-panel-heading">
          <div>
            <span className="attendance-section-kicker">
              REGISTRATION RECORDS
            </span>

            <h2>
              <Users size={20} />
              {selectedEventId === "all"
                ? "Attendee records"
                : "Event attendees"}
            </h2>

            <p>
              {filteredTickets.length}{" "}
              {filteredTickets.length === 1 ? "attendee" : "attendees"} found
              {isOrganizer ? ` · ${attendancePercentage}% present` : ""}
            </p>
          </div>
        </div>

        <div className="attendance-toolbar">
          <label className="attendance-search">
            <Search size={17} />

            <input
              type="search"
              placeholder="Search attendee, email, ticket..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={15} />
              </button>
            )}
          </label>

          <label className="attendance-filter">
            <span>Attendance</span>

            <select
              value={attendanceFilter}
              onChange={(event) =>
                setAttendanceFilter(event.target.value)
              }
            >
              <option value={ATTENDANCE_FILTER.ALL}>
                All attendees
              </option>

              <option value={ATTENDANCE_FILTER.PRESENT}>
                Present
              </option>

              <option value={ATTENDANCE_FILTER.ABSENT}>
                Absent
              </option>

              <option value={ATTENDANCE_FILTER.PENDING}>
                Pending
              </option>

              <option value={ATTENDANCE_FILTER.CANCELLED}>
                Cancelled
              </option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="attendance-empty">
            <Spinner size={30} />
            <h3>Loading attendees</h3>
            <p>
              Please wait while we retrieve registration records.
            </p>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="attendance-empty">
            <span className="attendance-empty-icon">
              <Ticket size={28} />
            </span>

            <h3>No attendees found</h3>

            <p>
              {tickets.length
                ? "Try changing your event, search, or attendance filter."
                : "Registered attendees will appear here when tickets are available."}
            </p>

            {(search ||
              attendanceFilter !== ATTENDANCE_FILTER.ALL ||
              selectedEventId !== "all") && (
              <button
                type="button"
                className="attendance-button attendance-button--secondary"
                onClick={() => {
                  setSearch("");
                  setAttendanceFilter(ATTENDANCE_FILTER.ALL);
                  setSelectedEventId("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="attendance-table-wrap">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Attendee</th>
                    {selectedEventId === "all" && <th>Event</th>}
                    <th>Event date</th>
                    <th>Attendance</th>
                    <th>Ticket status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleTickets.map((ticket, index) => {
                    const id = ticketId(ticket);
                    const status = normalizeStatus(ticket);

                    return (
                      <tr
                        key={
                          id ||
                          `${index}-${attendeeEmail(ticket)}`
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="attendance-ticket-id"
                            onClick={() => openTicket(ticket)}
                          >
                            {id || "No ID"}
                          </button>
                        </td>

                        <td>
                          <div className="attendance-attendee">
                            <span className="attendance-avatar">
                              {attendeeName(ticket)
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>

                            <div className="attendance-attendee-copy">
                              <strong>{attendeeName(ticket)}</strong>
                              <small>{attendeeEmail(ticket)}</small>
                            </div>
                          </div>
                        </td>

                        {selectedEventId === "all" && (
                          <td>
                            <span className="attendance-event-name">
                              {eventName(ticket)}
                            </span>
                          </td>
                        )}

                        <td>
                          <span className="attendance-date">
                            <CalendarDays size={14} />
                            {eventDate(ticket)}
                          </span>
                        </td>

                        <td>
                          <AttendanceBadge ticket={ticket} />
                        </td>

                        <td>
                          <StatusBadge ticket={ticket} />
                        </td>

                        <td>
                          <div className="attendance-row-actions">
                            <button
                              type="button"
                              className="attendance-icon-button"
                              title="View ticket"
                              aria-label="View ticket"
                              onClick={() => openTicket(ticket)}
                            >
                              <Eye size={16} />
                            </button>

                            {isOrganizer && (
                              <>
                                <button
                                  type="button"
                                  className="attendance-icon-button attendance-icon-button--success"
                                  title="Verify ticket"
                                  aria-label="Verify ticket"
                                  disabled={
                                    !id || Boolean(actionLoading)
                                  }
                                  onClick={() => verifyTicket(ticket)}
                                >
                                  {actionLoading === `verify:${id}` ? (
                                    <Spinner />
                                  ) : (
                                    <ShieldCheck size={16} />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  className="attendance-icon-button attendance-icon-button--success"
                                  title="Check in attendee"
                                  aria-label="Check in attendee"
                                  disabled={
                                    status !== STATUS.VALID ||
                                    Boolean(actionLoading)
                                  }
                                  onClick={() => checkInTicket(ticket)}
                                >
                                  {actionLoading === `checkin:${id}` ? (
                                    <Spinner />
                                  ) : (
                                    <ClipboardCheck size={16} />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  className="attendance-icon-button attendance-icon-button--danger"
                                  title="Cancel ticket"
                                  aria-label="Cancel ticket"
                                  disabled={
                                    status !== STATUS.VALID ||
                                    Boolean(actionLoading)
                                  }
                                  onClick={() => cancelTicket(ticket)}
                                >
                                  {actionLoading === `cancel:${id}` ? (
                                    <Spinner />
                                  ) : (
                                    <Ban size={16} />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <footer className="attendance-pagination">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(
                  currentPage * PAGE_SIZE,
                  filteredTickets.length
                )}{" "}
                of {filteredTickets.length}
              </span>

              <div className="attendance-pagination-controls">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() =>
                    setPage((previous) =>
                      Math.max(1, previous - 1)
                    )
                  }
                >
                  <ChevronLeft size={17} />
                </button>

                <span>
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  type="button"
                  aria-label="Next page"
                  disabled={currentPage >= totalPages}
                  onClick={() =>
                    setPage((previous) =>
                      Math.min(totalPages, previous + 1)
                    )
                  }
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {/* Ticket details modal */}
      {activeTicket && (
        <div
          className="attendance-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeTicket();
            }
          }}
        >
          <section
            className="attendance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-modal-title"
          >
            <header className="attendance-modal-header">
              <div>
                <span className="attendance-section-kicker">
                  TICKET DETAILS
                </span>

                <h2 id="attendance-modal-title">
                  Ticket information
                </h2>
              </div>

              <button
                type="button"
                className="attendance-icon-button"
                aria-label="Close ticket details"
                onClick={closeTicket}
                disabled={Boolean(actionLoading)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="attendance-modal-body">
              <div className="attendance-modal-ticket">
                <span className="attendance-modal-ticket-icon">
                  <Ticket size={24} />
                </span>

                <div className="attendance-modal-ticket-copy">
                  <small>Ticket ID</small>
                  <strong>{ticketId(activeTicket) || "No ID"}</strong>
                </div>

                <AttendanceBadge ticket={activeTicket} />
              </div>

              <DetailRow
                label="Attendee"
                value={attendeeName(activeTicket)}
              />

              <DetailRow
                label="Email"
                value={attendeeEmail(activeTicket)}
              />

              <DetailRow
                label="Event"
                value={eventName(activeTicket)}
              />

              <DetailRow
                label="Event date"
                value={eventDate(activeTicket)}
              />

              <DetailRow
                label="Ticket issued"
                value={issuedDate(activeTicket)}
              />

              <DetailRow
                label="Attendance"
                value={getAttendanceStatus(activeTicket)}
              />

              <DetailRow
                label="Checked in at"
                value={checkInDate(activeTicket)}
              />

              {activeTicket.qr_code && (
                <div className="attendance-qr">
                  <h3>Ticket QR code</h3>

                  <img
                    src={
                      String(activeTicket.qr_code).startsWith("data:") ||
                      String(activeTicket.qr_code).startsWith("http")
                        ? activeTicket.qr_code
                        : `data:image/png;base64,${activeTicket.qr_code}`
                    }
                    alt="Ticket QR code"
                  />
                </div>
              )}

              {verification && (
                <div className="attendance-verification">
                  <h3>Verification result</h3>
                  <pre>
                    {JSON.stringify(verification, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <footer className="attendance-modal-footer">
              {isOrganizer && (
                <>
                  <button
                    type="button"
                    className="attendance-button attendance-button--secondary"
                    disabled={Boolean(actionLoading)}
                    onClick={() => verifyTicket(activeTicket)}
                  >
                    {actionLoading ===
                    `verify:${ticketId(activeTicket)}` ? (
                      <Spinner />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    Verify
                  </button>

                  <button
                    type="button"
                    className="attendance-button attendance-button--primary"
                    disabled={
                      normalizeStatus(activeTicket) !== STATUS.VALID ||
                      Boolean(actionLoading)
                    }
                    onClick={() => checkInTicket(activeTicket)}
                  >
                    {actionLoading ===
                    `checkin:${ticketId(activeTicket)}` ? (
                      <Spinner />
                    ) : (
                      <ClipboardCheck size={16} />
                    )}
                    Mark attendance
                  </button>

                  <button
                    type="button"
                    className="attendance-button attendance-button--danger"
                    disabled={
                      normalizeStatus(activeTicket) !== STATUS.VALID ||
                      Boolean(actionLoading)
                    }
                    onClick={() => cancelTicket(activeTicket)}
                  >
                    {actionLoading ===
                    `cancel:${ticketId(activeTicket)}` ? (
                      <Spinner />
                    ) : (
                      <Ban size={16} />
                    )}
                    Cancel
                  </button>
                </>
              )}

              <button
                type="button"
                className="attendance-button attendance-button--secondary"
                onClick={closeTicket}
                disabled={Boolean(actionLoading)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}