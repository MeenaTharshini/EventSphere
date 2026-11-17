
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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Eye,
  LoaderCircle,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  ShieldCheck,
  Tag,
  Ticket,
  User,
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

const ATTENDEE_CATEGORIES = [
  "General",
  "VIP",
  "Speaker",
  "Volunteer",
  "Guest",
  "Sponsor",
];

/* -------------------- Auth / API helpers -------------------- */

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

/* -------------------- Ticket field helpers -------------------- */

function ticketId(ticket) {
  return String(
    ticket?.ticket_id ||
      ticket?.ticketId ||
      ticket?.id ||
      ticket?._id ||
      ""
  );
}

function registrationId(ticket) {
  return String(
    ticket?.registration_id ||
      ticket?.registrationId ||
      ticket?.attendee_id ||
      ticket?.attendeeId ||
      ticket?.registration?.id ||
      ticket?.registration?._id ||
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

function attendeePhoneFromTicket(ticket) {
  return (
    ticket?.attendee_phone ||
    ticket?.attendeePhone ||
    ticket?.phone ||
    ticket?.attendee?.phone ||
    ticket?.registration?.phone ||
    ""
  );
}

function attendeeCategoryFromTicket(ticket) {
  return (
    ticket?.category ||
    ticket?.attendee_category ||
    ticket?.attendee?.category ||
    ticket?.registration?.category ||
    ""
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

function getAttendanceStatus(ticket) {
  const status = normalizeStatus(ticket);

  if (status === STATUS.USED) return ATTENDANCE_FILTER.PRESENT;

  if (status === STATUS.VALID) {
    return hasEventPassed(ticket)
      ? ATTENDANCE_FILTER.ABSENT
      : ATTENDANCE_FILTER.PENDING;
  }

  if (status === STATUS.CANCELLED) return ATTENDANCE_FILTER.CANCELLED;

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

function qrImageSource(qr) {
  const value = String(qr || "");

  if (value.startsWith("data:") || value.startsWith("http")) {
    return value;
  }

  return `data:image/png;base64,${value}`;
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

/* -------------------- Small components -------------------- */

function AttendancePieChart({ present, absent }) {
  const total = present + absent;

  const presentPercentage = total > 0 ? (present / total) * 100 : 0;
  const absentPercentage = total > 0 ? (absent / total) * 100 : 0;

  const chartStyle = {
    background:
      total === 0
        ? "conic-gradient(#e5ebe6 0deg 360deg)"
        : `conic-gradient(
            #258773 0% ${presentPercentage}%,
            #a9d8c9 ${presentPercentage}% 100%
          )`,
  };

  return (
    <section className="attendance-panel attendance-chart-panel">
      <div className="attendance-panel-heading">
        <div>
          <span className="attendance-section-kicker">OVERVIEW</span>
          <h2>
            <Activity size={16} />
            Present vs Absent
          </h2>
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

          <p className="attendance-chart-note">
            {total === 0
              ? "No completed-event attendance yet."
              : "Excludes cancelled and upcoming registrations."}
          </p>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ ticket }) {
  const status = normalizeStatus(ticket);

  const icon =
    status === STATUS.VALID ? (
      <CheckCircle2 size={12} />
    ) : status === STATUS.USED ? (
      <ClipboardCheck size={12} />
    ) : status === STATUS.CANCELLED ? (
      <Ban size={12} />
    ) : (
      <AlertCircle size={12} />
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
      <CheckCircle2 size={12} />
    ) : attendance === ATTENDANCE_FILTER.ABSENT ? (
      <AlertCircle size={12} />
    ) : attendance === ATTENDANCE_FILTER.PENDING ? (
      <CalendarDays size={12} />
    ) : attendance === ATTENDANCE_FILTER.CANCELLED ? (
      <Ban size={12} />
    ) : (
      <AlertCircle size={12} />
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
      <span
        className={`attendance-stat-icon attendance-stat-icon--${variant}`}
      >
        {icon}
      </span>

      <div className="attendance-stat-copy">
        <span className="attendance-stat-label">{label}</span>
        <strong className="attendance-stat-value">{value}</strong>
        <small>{description}</small>
      </div>
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

function ProfileSection({ icon, title, children }) {
  return (
    <section className="attendance-profile-section">
      <h3>
        {icon}
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function Spinner({ size = 14 }) {
  return (
    <LoaderCircle
      size={size}
      className="attendance-spin"
      aria-hidden="true"
    />
  );
}

/* -------------------- Page -------------------- */

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

  // Attendee profile.
  const [profileTicket, setProfileTicket] = useState(null);
  const [profileDetails, setProfileDetails] = useState(null);
  const [profileEvent, setProfileEvent] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Attendee editing.
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    category: "General",
  });

  const [ticketCode, setTicketCode] = useState("");
  const [scannedTicket, setScannedTicket] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scannerMessage, setScannerMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  const scannerRef = useRef(null);
  const scanHandledRef = useRef(false);
  const searchTicketRef = useRef(null);
  const profileRequestRef = useRef(0);
  const eventAttendeesCache = useRef(new Map());

  /* -------------------- Load tickets -------------------- */

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
      eventAttendeesCache.current.clear();
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

  /* -------------------- Derived event data -------------------- */

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

  const eventTickets = useMemo(() => {
    if (selectedEventId === "all") return tickets;

    return tickets.filter(
      (ticket) => eventId(ticket) === selectedEventId
    );
  }, [tickets, selectedEventId]);

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

  const hasActiveFilters =
    Boolean(search) ||
    attendanceFilter !== ATTENDANCE_FILTER.ALL ||
    selectedEventId !== "all";

  /* -------------------- Local ticket updates -------------------- */

  const updateTicketLocally = (id, patch) => {
    const targetId = String(id);

    setTickets((previous) =>
      previous.map((ticket) =>
        ticketId(ticket) === targetId
          ? { ...ticket, ...patch }
          : ticket
      )
    );

    const patchIfMatch = (previous) =>
      previous && ticketId(previous) === targetId
        ? { ...previous, ...patch }
        : previous;

    setActiveTicket(patchIfMatch);
    setScannedTicket(patchIfMatch);
    setProfileTicket(patchIfMatch);
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

  /* -------------------- Attendee profile -------------------- */

  const openProfile = async (ticket) => {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;

    setProfileTicket(ticket);
    setProfileDetails(null);
    setProfileEvent(null);
    setProfileError("");
    setEditingProfile(false);
    setSavingProfile(false);
    setError("");
    setNotice("");

    if (!isOrganizer) return;

    const evId = eventId(ticket);

    if (!evId) return;

    setProfileLoading(true);

    try {
      let payload = eventAttendeesCache.current.get(evId);

      if (!payload) {
        payload = await apiRequest(
          `/attendees/event/${encodeURIComponent(evId)}`
        );

        eventAttendeesCache.current.set(evId, payload);
      }

      if (profileRequestRef.current !== requestId) return;

      const list = Array.isArray(payload?.attendees)
        ? payload.attendees
        : [];

      const regId = registrationId(ticket);
      const email = String(attendeeEmail(ticket)).trim().toLowerCase();
      const tId = ticketId(ticket);

      const match =
        list.find(
          (item) => regId && String(item.attendee_id) === regId
        ) ||
        list.find(
          (item) => tId && item.ticket?.ticket_id === tId
        ) ||
        list.find(
          (item) =>
            email &&
            String(item.email || "").trim().toLowerCase() === email
        ) ||
        null;

      setProfileDetails(match);
      setProfileEvent(payload?.event || null);

      if (!match) {
        setProfileError(
          "Registration details were not found for this attendee."
        );
      }
    } catch (err) {
      if (profileRequestRef.current === requestId) {
        setProfileError(
          err.message || "Unable to load registration details."
        );
      }
    } finally {
      if (profileRequestRef.current === requestId) {
        setProfileLoading(false);
      }
    }
  };

  const closeProfile = () => {
    if (actionLoading || savingProfile) return;

    profileRequestRef.current += 1;

    setProfileTicket(null);
    setProfileDetails(null);
    setProfileEvent(null);
    setProfileError("");
    setProfileLoading(false);
    setEditingProfile(false);
    setEditForm({
      name: "",
      email: "",
      phone: "",
      category: "General",
    });
  };

  /* -------------------- Edit attendee -------------------- */

  const startEditingProfile = () => {
    if (!isOrganizer || !profileDetails) {
      setProfileError(
        "Attendee registration details are not available for editing."
      );
      return;
    }

    const id = String(
      profileDetails.attendee_id || registrationId(profileTicket) || ""
    );

    if (!id) {
      setProfileError("Registration ID is missing. Cannot edit this attendee.");
      return;
    }

    setEditForm({
      name: profileDetails.name || "",
      email: profileDetails.email || "",
      phone: profileDetails.phone || "",
      category: profileDetails.category || "General",
    });

    setProfileError("");
    setEditingProfile(true);
  };

  const cancelEditingProfile = () => {
    if (savingProfile) return;

    setEditingProfile(false);
    setProfileError("");
    setEditForm({
      name: "",
      email: "",
      phone: "",
      category: "General",
    });
  };

  const handleEditFormChange = (event) => {
    const { name, value } = event.target;

    setEditForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const saveAttendeeChanges = async (event) => {
    event.preventDefault();

    if (!isOrganizer || !profileDetails || !profileTicket) return;

    const id = String(
      profileDetails.attendee_id || registrationId(profileTicket) || ""
    );

    if (!id) {
      setProfileError("Registration ID is missing. Cannot update attendee.");
      return;
    }

    const name = editForm.name.trim();
    const email = editForm.email.trim().toLowerCase();
    const phone = editForm.phone.trim();
    const category = editForm.category.trim();

    if (!name) {
      setProfileError("Please enter the attendee's name.");
      return;
    }

    if (!email) {
      setProfileError("Please enter the attendee's email address.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      setProfileError("Please enter a valid email address.");
      return;
    }

    if (phone.length > 20) {
      setProfileError("Phone number cannot exceed 20 characters.");
      return;
    }

    if (!category) {
      setProfileError("Please select an attendee category.");
      return;
    }

    setSavingProfile(true);
    setProfileError("");
    setError("");
    setNotice("");

    try {
      const result = await apiRequest(
        `/attendees/registrations/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name,
            email,
            phone,
            category,
          }),
        }
      );

      if (!result?.success) {
        throw new Error(
          result?.message || "The attendee could not be updated."
        );
      }

      const updatedAttendee = result.attendee || {
        ...profileDetails,
        name,
        email,
        phone,
        category,
      };

      setProfileDetails((previous) => ({
        ...previous,
        ...updatedAttendee,
        name: updatedAttendee.name || name,
        email: updatedAttendee.email || email,
        phone: updatedAttendee.phone ?? phone,
        category: updatedAttendee.category || category,
      }));

      // Update the visible ticket data immediately.
      updateTicketLocally(ticketId(profileTicket), {
        attendee_name: name,
        attendee_email: email,
        attendee_phone: phone,
        category,
      });

      // The attendee listing cache is now stale.
      const evId = eventId(profileTicket);

      if (evId) {
        eventAttendeesCache.current.delete(evId);
      }

      setEditingProfile(false);

      // Reload ticket data so the table reflects the backend response.
      await loadTickets({ silent: true });

      setNotice(
        result.message || "Attendee details updated successfully."
      );
    } catch (err) {
      setProfileError(err.message || "Unable to update attendee details.");
    } finally {
      setSavingProfile(false);
    }
  };

  /* -------------------- Escape key handling -------------------- */

  useEffect(() => {
    if (!profileTicket && !activeTicket) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== "Escape" || actionLoading || savingProfile) return;

      if (activeTicket) {
        setActiveTicket(null);
        setVerification(null);
      } else if (editingProfile) {
        cancelEditingProfile();
      } else {
        profileRequestRef.current += 1;
        setProfileTicket(null);
        setProfileDetails(null);
        setProfileEvent(null);
        setProfileError("");
        setProfileLoading(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    profileTicket,
    activeTicket,
    actionLoading,
    savingProfile,
    editingProfile,
  ]);

  /* -------------------- Other attendee registrations -------------------- */

  const otherRegistrations = useMemo(() => {
    if (!profileTicket) return [];

    const email = String(attendeeEmail(profileTicket))
      .trim()
      .toLowerCase();

    if (!email || email === "—") return [];

    const currentId = ticketId(profileTicket);

    return tickets.filter(
      (ticket) =>
        ticketId(ticket) !== currentId &&
        String(attendeeEmail(ticket)).trim().toLowerCase() === email
    );
  }, [tickets, profileTicket]);

  const profileSummary = useMemo(() => {
    if (!profileTicket) return null;

    const email = String(attendeeEmail(profileTicket))
      .trim()
      .toLowerCase();

    const all = tickets.filter(
      (ticket) =>
        email &&
        email !== "—" &&
        String(attendeeEmail(ticket)).trim().toLowerCase() === email
    );

    const list = all.length ? all : [profileTicket];

    return {
      registrations: list.length,
      present: list.filter(
        (ticket) =>
          getAttendanceStatus(ticket) === ATTENDANCE_FILTER.PRESENT
      ).length,
      absent: list.filter(
        (ticket) =>
          getAttendanceStatus(ticket) === ATTENDANCE_FILTER.ABSENT
      ).length,
      cancelled: list.filter(
        (ticket) =>
          getAttendanceStatus(ticket) === ATTENDANCE_FILTER.CANCELLED
      ).length,
    };
  }, [tickets, profileTicket]);

  /* -------------------- Ticket actions -------------------- */

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

  /* -------------------- Ticket lookup -------------------- */

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
        setScannerMessage("Ticket found. The event has not passed yet.");
      } else {
        setScannerMessage("The ticket status could not be confirmed.");
      }
    } catch (err) {
      setError(err.message || "Unable to find this ticket.");
    } finally {
      setLookupLoading(false);
    }
  };

  searchTicketRef.current = searchTicketCode;

  /* -------------------- QR scanner -------------------- */

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
            qrbox: { width: 220, height: 220 },
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
              // Continue with decoded value.
            }

            if (cancelled) return;

            setScannerOpen(false);
            setScannerStarting(false);

            const decodedCode = qrTicketCode(decodedText);
            setTicketCode(decodedCode);

            await searchTicketRef.current?.(decodedCode);
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

  /* -------------------- Export and filters -------------------- */

  const handleExport = () => {
    if (!filteredTickets.length) {
      setError("There are no attendance records to export.");
      return;
    }

    downloadCSV(filteredTickets, selectedEventName);
    setError("");
    setNotice("Attendance CSV downloaded successfully.");
  };

  const clearFilters = () => {
    setSearch("");
    setAttendanceFilter(ATTENDANCE_FILTER.ALL);
    setSelectedEventId("all");
  };

  /* -------------------- Login gate -------------------- */

  if (!authenticated) {
    return (
      <main className="attendance-page">
        <section className="attendance-panel attendance-login-message">
          <ShieldCheck size={26} />
          <div>
            <h2>Login required</h2>
            <p>Please log in to view attendance and ticket information.</p>
          </div>
        </section>
      </main>
    );
  }

  /* -------------------- Profile values -------------------- */

  const profile = profileTicket
    ? {
        name: profileDetails?.name || attendeeName(profileTicket),
        email: profileDetails?.email || attendeeEmail(profileTicket),
        phone:
          profileDetails?.phone || attendeePhoneFromTicket(profileTicket),
        category:
          profileDetails?.category ||
          attendeeCategoryFromTicket(profileTicket),
        registrationStatus:
          profileDetails?.registration_status ||
          profileTicket?.registration_status ||
          "",
        registeredAt: formatDate(
          profileDetails?.registered_at ||
            profileTicket?.registered_at ||
            profileTicket?.registeredAt,
          true
        ),
        registrationId:
          profileDetails?.attendee_id || registrationId(profileTicket),
        venue:
          profileEvent?.venue ||
          profileTicket?.venue ||
          profileTicket?.event?.venue ||
          profileTicket?.location ||
          "",
        eventDate:
          profileEvent?.date && profileEvent.date !== ""
            ? formatDate(profileEvent.date)
            : eventDate(profileTicket),
        qr:
          profileTicket?.qr_code ||
          profileDetails?.ticket?.qr_code ||
          "",
      }
    : null;

  /* -------------------- Render -------------------- */

  return (
    <main className="attendance-page">
      <header className="attendance-header">
        <div className="attendance-heading-copy">
          <p className="attendance-eyebrow">EVENTSPHERE MANAGEMENT</p>
          <h1>Attendance &amp; Tickets</h1>
          <p className="attendance-subtitle">
            {isOrganizer
              ? "View registrations, track attendance, and check attendees in."
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
            {refreshing ? <Spinner /> : <RefreshCw size={14} />}
            Refresh
          </button>

          {isOrganizer && (
            <button
              className="attendance-button attendance-button--primary"
              type="button"
              onClick={handleExport}
              disabled={!filteredTickets.length}
            >
              <Download size={14} />
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
          <AlertCircle size={16} />
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div
          className="attendance-alert attendance-alert--success"
          role="status"
        >
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Statistics */}
      <section className="attendance-stat-grid">
        <StatCard
          icon={<Users size={17} />}
          label="Registered"
          value={statistics.total + statistics.pending}
          description="Active registrations"
          variant="blue"
        />

        <StatCard
          icon={<CheckCircle2 size={17} />}
          label="Present"
          value={statistics.present}
          description="Checked in"
          variant="green"
        />

        <StatCard
          icon={<AlertCircle size={17} />}
          label="Absent"
          value={statistics.absent}
          description="Event has passed"
          variant="amber"
        />

        <StatCard
          icon={<Ban size={17} />}
          label="Cancelled"
          value={statistics.cancelled}
          description="Cancelled tickets"
          variant="red"
        />
      </section>

      {/* Chart and check-in desk */}
      {isOrganizer && (
        <section className="attendance-top-grid">
          <AttendancePieChart
            present={statistics.present}
            absent={statistics.absent}
          />

          <section className="attendance-panel attendance-checkin-panel">
            <div className="attendance-panel-heading">
              <div>
                <span className="attendance-section-kicker">
                  CHECK-IN DESK
                </span>
                <h2>
                  <ScanLine size={16} />
                  Event check-in
                </h2>
              </div>

              <span className="attendance-enabled-badge">
                <span />
                Check-in enabled
              </span>
            </div>

            <form
              className="attendance-lookup"
              onSubmit={(event) => {
                event.preventDefault();
                searchTicketCode();
              }}
            >
              <label htmlFor="attendance-ticket-code">Ticket ID</label>

              <div className="attendance-code-input">
                <input
                  id="attendance-ticket-code"
                  type="text"
                  placeholder="EVT-19B5E50C"
                  value={ticketCode}
                  onChange={(event) => setTicketCode(event.target.value)}
                />

                <button
                  type="submit"
                  className="attendance-button attendance-button--primary"
                  disabled={lookupLoading || !ticketCode.trim()}
                >
                  {lookupLoading ? <Spinner /> : <Search size={14} />}
                  Verify
                </button>

                {scannerOpen ? (
                  <button
                    type="button"
                    className="attendance-button attendance-button--secondary"
                    onClick={stopQrScanner}
                  >
                    <X size={14} />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="attendance-button attendance-button--secondary"
                    onClick={startQrScanner}
                  >
                    <ScanLine size={14} />
                    Scan QR
                  </button>
                )}
              </div>
            </form>

            {scannerOpen && (
              <div className="attendance-camera">
                {scannerStarting && (
                  <div className="attendance-camera-loading">
                    <Spinner size={16} />
                    Starting camera…
                  </div>
                )}
                <div id={SCANNER_ID} />
              </div>
            )}

            {scannerMessage && (
              <div className="attendance-scanner-message" role="status">
                <CheckCircle2 size={14} />
                {scannerMessage}
              </div>
            )}

            {scannedTicket && (
              <div className="attendance-scanned-ticket">
                <div className="attendance-scanned-heading">
                  <div>
                    <h3>
                      <button
                        type="button"
                        className="attendance-name-link"
                        title="View attendee details"
                        onClick={() => openProfile(scannedTicket)}
                      >
                        {attendeeName(scannedTicket)}
                      </button>
                    </h3>
                    <p>{ticketId(scannedTicket)}</p>
                  </div>

                  <AttendanceBadge ticket={scannedTicket} />
                </div>

                <div className="attendance-scanned-details">
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
                </div>

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
                      <ClipboardCheck size={14} />
                    )}
                    Mark attendance
                  </button>
                )}
              </div>
            )}
          </section>
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
              <Users size={16} />
              {selectedEventId === "all"
                ? "Attendee records"
                : "Event attendees"}
            </h2>
          </div>

          <p className="attendance-records-count">
            {filteredTickets.length}{" "}
            {filteredTickets.length === 1 ? "attendee" : "attendees"}
            {isOrganizer ? ` · ${attendancePercentage}% present` : ""}
          </p>
        </div>

        <div
          className={`attendance-toolbar ${
            isOrganizer ? "" : "attendance-toolbar--no-event"
          }`}
        >
          <label className="attendance-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Search attendee, email, ticket..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search attendees"
            />

            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={13} />
              </button>
            )}
          </label>

          {isOrganizer && (
            <select
              className="attendance-select"
              aria-label="Filter by event"
              value={selectedEventId}
              onChange={(event) => setSelectedEventId(event.target.value)}
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
          )}

          <select
            className="attendance-select"
            aria-label="Filter by attendance"
            value={attendanceFilter}
            onChange={(event) => setAttendanceFilter(event.target.value)}
          >
            <option value={ATTENDANCE_FILTER.ALL}>All attendance</option>
            <option value={ATTENDANCE_FILTER.PRESENT}>Present</option>
            <option value={ATTENDANCE_FILTER.ABSENT}>Absent</option>
            <option value={ATTENDANCE_FILTER.PENDING}>Pending</option>
            <option value={ATTENDANCE_FILTER.CANCELLED}>Cancelled</option>
          </select>
        </div>

        {loading ? (
          <div className="attendance-empty">
            <Spinner size={26} />
            <h3>Loading attendees</h3>
            <p>Please wait while we retrieve registration records.</p>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="attendance-empty">
            <span className="attendance-empty-icon">
              <Ticket size={22} />
            </span>
            <h3>No attendees found</h3>
            <p>
              {tickets.length
                ? "Try changing your event, search, or attendance filter."
                : "Registered attendees will appear here when tickets are available."}
            </p>

            {hasActiveFilters && (
              <button
                type="button"
                className="attendance-button attendance-button--secondary"
                onClick={clearFilters}
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
                    <th>Attendee</th>
                    <th>Ticket</th>
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
                      <tr key={id || `${index}-${attendeeEmail(ticket)}`}>
                        <td>
                          <div className="attendance-attendee">
                            <span className="attendance-avatar">
                              {attendeeName(ticket)
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>

                            <div className="attendance-attendee-copy">
                              <button
                                type="button"
                                className="attendance-name-link"
                                title="View attendee details"
                                onClick={() => openProfile(ticket)}
                              >
                                {attendeeName(ticket)}
                              </button>
                              <small>{attendeeEmail(ticket)}</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="attendance-ticket-id"
                            onClick={() => openTicket(ticket)}
                          >
                            {id || "No ID"}
                          </button>
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
                            <CalendarDays size={12} />
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
                              <Eye size={14} />
                            </button>

                            {isOrganizer && (
                              <>
                                <button
                                  type="button"
                                  className="attendance-icon-button attendance-icon-button--success"
                                  title="Verify ticket"
                                  aria-label="Verify ticket"
                                  disabled={!id || Boolean(actionLoading)}
                                  onClick={() => verifyTicket(ticket)}
                                >
                                  {actionLoading === `verify:${id}` ? (
                                    <Spinner size={13} />
                                  ) : (
                                    <ShieldCheck size={14} />
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
                                    <Spinner size={13} />
                                  ) : (
                                    <ClipboardCheck size={14} />
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
                                    <Spinner size={13} />
                                  ) : (
                                    <Ban size={14} />
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
                {Math.min(currentPage * PAGE_SIZE, filteredTickets.length)}{" "}
                of {filteredTickets.length}
              </span>

              <div className="attendance-pagination-controls">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={currentPage <= 1}
                  onClick={() =>
                    setPage((previous) => Math.max(1, previous - 1))
                  }
                >
                  <ChevronLeft size={15} />
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
                  <ChevronRight size={15} />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>

      {/* Attendee profile modal */}
      {profileTicket && profile && (
        <div
          className="attendance-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeProfile();
            }
          }}
        >
          <section
            className="attendance-modal attendance-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-profile-title"
          >
            <header className="attendance-modal-header">
              <div className="attendance-profile-title">
                <span className="attendance-profile-avatar">
                  {String(profile.name).slice(0, 1).toUpperCase()}
                </span>

                <div>
                  <span className="attendance-section-kicker">
                    ATTENDEE DETAILS
                  </span>
                  <h2 id="attendance-profile-title">{profile.name}</h2>

                  <div className="attendance-profile-badges">
                    <AttendanceBadge ticket={profileTicket} />
                    <StatusBadge ticket={profileTicket} />

                    {profile.category && (
                      <span className="attendance-category-badge">
                        <Tag size={11} />
                        {profile.category}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="attendance-icon-button"
                aria-label="Close attendee details"
                onClick={closeProfile}
                disabled={Boolean(actionLoading) || savingProfile}
              >
                <X size={16} />
              </button>
            </header>

            <div className="attendance-modal-body">
              {profileLoading && (
                <div className="attendance-profile-loading" role="status">
                  <Spinner size={14} />
                  Loading registration details…
                </div>
              )}

              {profileError && !profileLoading && (
                <div className="attendance-profile-warning" role="alert">
                  <AlertCircle size={14} />
                  {profileError}
                </div>
              )}

              {profileSummary && (
                <div className="attendance-profile-summary">
                  <div>
                    <strong>{profileSummary.registrations}</strong>
                    <span>Registrations</span>
                  </div>
                  <div>
                    <strong>{profileSummary.present}</strong>
                    <span>Present</span>
                  </div>
                  <div>
                    <strong>{profileSummary.absent}</strong>
                    <span>Absent</span>
                  </div>
                  <div>
                    <strong>{profileSummary.cancelled}</strong>
                    <span>Cancelled</span>
                  </div>
                </div>
              )}

              {/* Personal details: view or edit */}
              <ProfileSection
                icon={<User size={14} />}
                title="Personal & contact"
              >
                {editingProfile ? (
                  <form
                    className="attendance-edit-form"
                    onSubmit={saveAttendeeChanges}
                  >
                    <div className="attendance-edit-grid">
                      <label className="attendance-edit-field">
                        <span>Full name *</span>
                        <input
                          type="text"
                          name="name"
                          value={editForm.name}
                          onChange={handleEditFormChange}
                          placeholder="Enter attendee name"
                          maxLength={100}
                          required
                          disabled={savingProfile}
                        />
                      </label>

                      <label className="attendance-edit-field">
                        <span>Email address *</span>
                        <input
                          type="email"
                          name="email"
                          value={editForm.email}
                          onChange={handleEditFormChange}
                          placeholder="Enter email address"
                          maxLength={254}
                          required
                          disabled={savingProfile}
                        />
                      </label>

                      <label className="attendance-edit-field">
                        <span>Phone number</span>
                        <input
                          type="tel"
                          name="phone"
                          value={editForm.phone}
                          onChange={handleEditFormChange}
                          placeholder="Enter phone number"
                          maxLength={20}
                          disabled={savingProfile}
                        />
                      </label>

                      <label className="attendance-edit-field">
                        <span>Attendee category *</span>
                        <select
                          name="category"
                          value={editForm.category}
                          onChange={handleEditFormChange}
                          required
                          disabled={savingProfile}
                        >
                          {ATTENDEE_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="attendance-edit-actions">
                      <button
                        type="button"
                        className="attendance-button attendance-button--secondary"
                        onClick={cancelEditingProfile}
                        disabled={savingProfile}
                      >
                        <X size={14} />
                        Discard
                      </button>

                      <button
                        type="submit"
                        className="attendance-button attendance-button--primary"
                        disabled={savingProfile}
                      >
                        {savingProfile ? (
                          <Spinner />
                        ) : (
                          <Save size={14} />
                        )}
                        {savingProfile ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <DetailRow label="Full name" value={profile.name} />
                    <DetailRow label="Email" value={profile.email} />
                    <DetailRow
                      label="Phone"
                      value={
                        profile.phone ||
                        (profileLoading ? "Loading…" : "Not provided")
                      }
                    />
                    <DetailRow
                      label="Category"
                      value={
                        profile.category ||
                        (profileLoading ? "Loading…" : "—")
                      }
                    />
                  </>
                )}
              </ProfileSection>

              <ProfileSection
                icon={<ClipboardCheck size={14} />}
                title="Registration"
              >
                <DetailRow
                  label="Registration ID"
                  value={profile.registrationId}
                />
                <DetailRow
                  label="Registration status"
                  value={
                    profile.registrationStatus ||
                    (profileLoading ? "Loading…" : "—")
                  }
                />
                <DetailRow
                  label="Registered on"
                  value={profile.registeredAt}
                />
              </ProfileSection>

              <ProfileSection
                icon={<CalendarDays size={14} />}
                title="Event"
              >
                <DetailRow
                  label="Event"
                  value={eventName(profileTicket)}
                />
                <DetailRow label="Event date" value={profile.eventDate} />
                <DetailRow
                  label="Venue"
                  value={
                    profile.venue ||
                    (profileLoading ? "Loading…" : "—")
                  }
                />
              </ProfileSection>

              <ProfileSection
                icon={<Ticket size={14} />}
                title="Ticket & attendance"
              >
                <DetailRow
                  label="Ticket ID"
                  value={ticketId(profileTicket) || "No ID"}
                />
                <DetailRow
                  label="Ticket status"
                  value={normalizeStatus(profileTicket)}
                />
                <DetailRow
                  label="Attendance"
                  value={getAttendanceStatus(profileTicket)}
                />
                <DetailRow
                  label="Ticket issued"
                  value={issuedDate(profileTicket)}
                />
                <DetailRow
                  label="Checked in at"
                  value={checkInDate(profileTicket)}
                />

                {profile.qr && (
                  <div className="attendance-qr">
                    <h3>Ticket QR code</h3>
                    <img
                      src={qrImageSource(profile.qr)}
                      alt="Ticket QR code"
                    />
                  </div>
                )}
              </ProfileSection>

              {otherRegistrations.length > 0 && (
                <ProfileSection
                  icon={<MapPin size={14} />}
                  title={`Other registrations (${otherRegistrations.length})`}
                >
                  <ul className="attendance-profile-history">
                    {otherRegistrations.map((ticket, index) => (
                      <li key={ticketId(ticket) || index}>
                        <div>
                          <strong>{eventName(ticket)}</strong>
                          <small>
                            {eventDate(ticket)} · {ticketId(ticket)}
                          </small>
                        </div>
                        <AttendanceBadge ticket={ticket} />
                      </li>
                    ))}
                  </ul>
                </ProfileSection>
              )}
            </div>

            <footer className="attendance-modal-footer">
              {!editingProfile && profile.email && profile.email !== "—" && (
                <a
                  className="attendance-button attendance-button--secondary"
                  href={`mailto:${profile.email}`}
                >
                  <Mail size={14} />
                  Email
                </a>
              )}

              {!editingProfile && profile.phone && (
                <a
                  className="attendance-button attendance-button--secondary"
                  href={`tel:${String(profile.phone).replace(/[^\d+]/g, "")}`}
                >
                  <Phone size={14} />
                  Call
                </a>
              )}

              {isOrganizer && !editingProfile && (
                <>
                  <button
                    type="button"
                    className="attendance-button attendance-button--secondary"
                    onClick={startEditingProfile}
                    disabled={
                      profileLoading ||
                      !profileDetails ||
                      Boolean(actionLoading)
                    }
                  >
                    <Pencil size={14} />
                    Edit attendee
                  </button>

                  <button
                    type="button"
                    className="attendance-button attendance-button--primary"
                    disabled={
                      normalizeStatus(profileTicket) !== STATUS.VALID ||
                      Boolean(actionLoading)
                    }
                    onClick={() => checkInTicket(profileTicket)}
                  >
                    {actionLoading ===
                    `checkin:${ticketId(profileTicket)}` ? (
                      <Spinner />
                    ) : (
                      <ClipboardCheck size={14} />
                    )}
                    Mark attendance
                  </button>

                  <button
                    type="button"
                    className="attendance-button attendance-button--danger"
                    disabled={
                      normalizeStatus(profileTicket) !== STATUS.VALID ||
                      Boolean(actionLoading)
                    }
                    onClick={() => cancelTicket(profileTicket)}
                  >
                    {actionLoading ===
                    `cancel:${ticketId(profileTicket)}` ? (
                      <Spinner />
                    ) : (
                      <Ban size={14} />
                    )}
                    Cancel ticket
                  </button>
                </>
              )}

              <button
                type="button"
                className="attendance-button attendance-button--secondary"
                onClick={closeProfile}
                disabled={Boolean(actionLoading) || savingProfile}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

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
                <h2 id="attendance-modal-title">Ticket information</h2>
              </div>

              <button
                type="button"
                className="attendance-icon-button"
                aria-label="Close ticket details"
                onClick={closeTicket}
                disabled={Boolean(actionLoading)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="attendance-modal-body">
              <div className="attendance-modal-ticket">
                <span className="attendance-modal-ticket-icon">
                  <Ticket size={20} />
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
                    src={qrImageSource(activeTicket.qr_code)}
                    alt="Ticket QR code"
                  />
                </div>
              )}

              {verification && (
                <div className="attendance-verification">
                  <h3>Verification result</h3>
                  <pre>{JSON.stringify(verification, null, 2)}</pre>
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
                      <ShieldCheck size={14} />
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
                      <ClipboardCheck size={14} />
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
                      <Ban size={14} />
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
