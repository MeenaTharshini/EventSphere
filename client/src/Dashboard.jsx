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
  Bell,
  BellRing,
  Building2,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DoorOpen,
  Handshake,
  IndianRupee,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";

import {
  apiRequest,
  getEvents,
  getVenues,
  getSponsorships,
  logoutUser,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "./api";

import Sidebar from "./Sidebar";
import Events from "./Events";
import Venues from "./Venues";
import Resources from "./Resources";
import Scheduling from "./Scheduling";
import Attendance from "./Attendance";
import OrganizerVendors from "./OrganizerVendors";
import Budget from "./Budget";
import Sponsorships from "./Sponsorships";
import Approvals from "./Approvals";
import Notifications from "./Notifications";

import "./Dashboard.css";

/* =========================================================
   HELPERS
========================================================= */

const EMPTY_ARRAY = [];
const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "16:00";
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const EMPTY_SUMMARY = {
  totalEvents: 0,
  registeredAttendees: 0,
  totalBudget: 0,
  actualExpenses: 0,
  remainingBudget: 0,
  sponsorshipRevenue: 0,
  pendingExpenses: 0,
  pendingExpenseAmount: 0,
  approvedExpenses: 0,
  approvedExpenseAmount: 0,
  budgetRecordsLoaded: 0,
  budgetRecordsFailed: 0,
};

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

function getId(item) {
  return String(item?.id ?? item?._id ?? item?.event_id ?? "");
}

function getUserId(user) {
  return String(
    user?._id ??
      user?.id ??
      user?.user_id ??
      user?.user?._id ??
      user?.user?.id ??
      ""
  );
}

function getUserName(user) {
  return (
    user?.name ??
    user?.full_name ??
    user?.username ??
    user?.user?.name ??
    user?.email ??
    "Organizer"
  );
}

function getUserRole(user) {
  return String(
    user?.activeRole ??
      user?.role ??
      user?.user_role ??
      user?.user?.role ??
      ""
  )
    .trim()
    .toLowerCase();
}

function isAdmin(user) {
  return ["admin", "administrator"].includes(getUserRole(user));
}

function isOrganizer(user) {
  return getUserRole(user) === "organizer";
}

function getEventOwnerId(event) {
  const owner =
    event?.organizer_id ??
    event?.organizerId ??
    event?.created_by ??
    event?.createdBy;

  if (owner && typeof owner === "object") {
    return String(owner._id ?? owner.id ?? "");
  }

  return String(owner ?? "");
}

function getEventName(event) {
  return (
    event?.name ??
    event?.title ??
    event?.event_name ??
    event?.eventName ??
    "Untitled event"
  );
}

/* Parses "YYYY-MM-DD" (or an ISO string starting with it) as a LOCAL date,
   so the day never shifts because of the time zone. */
function parseDateOnly(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getEventDate(event) {
  return parseDateOnly(
    event?.event_date ??
      event?.date ??
      event?.start_date ??
      event?.startDate
  );
}

function getEventEndDate(event) {
  return (
    parseDateOnly(
      event?.end_date ??
        event?.event_end_date ??
        event?.endDate
    ) ?? getEventDate(event)
  );
}

function applyTime(date, timeValue, fallback) {
  if (!date) return null;

  const match = String(timeValue ?? fallback).match(
    /^(\d{1,2}):(\d{2})/
  );

  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes
  );
}

function getEventStartDateTime(event) {
  return applyTime(
    getEventDate(event),
    event?.start_time ?? event?.time,
    DEFAULT_START_TIME
  );
}

function getEventEndDateTime(event) {
  return applyTime(
    getEventEndDate(event),
    event?.end_time,
    DEFAULT_END_TIME
  );
}

/* Same logic as the Events page, so both pages show the same status. */
function getEventStatus(event) {
  const stored = String(event?.status ?? "")
    .trim()
    .toLowerCase();

  if (stored.includes("cancel")) return "Cancelled";
  if (stored.includes("complete")) return "Completed";

  const start = getEventStartDateTime(event);
  const end = getEventEndDateTime(event);

  if (!start || !end) {
    if (stored.includes("confirm")) return "Confirmed";
    if (stored.includes("pending")) return "Pending";
    if (stored.includes("draft")) return "Draft";
    return "Scheduled";
  }

  const now = new Date();

  if (now < start) return "Upcoming";
  if (now < end) return "Ongoing";

  return "Completed";
}

function formatDate(value) {
  const date = parseDateOnly(value);

  if (!date) return "Date not available";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateRange(event) {
  const start = getEventDate(event);
  const end = getEventEndDate(event);

  if (!start) return "Date not available";

  if (end && end.getTime() !== start.getTime()) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }

  return formatDate(start);
}

function formatTime(value) {
  if (!value) return "Time not set";

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return String(value);

  const date = new Date(
    2000,
    0,
    1,
    Number(match[1]),
    Number(match[2])
  );

  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

function getVenueName(event, venues) {
  if (event?.venue_name) return event.venue_name;
  if (event?.venue?.name) return event.venue.name;
  if (typeof event?.venue === "string" && event.venue) {
    return event.venue;
  }

  const venueId =
    event?.venue_id ?? event?.venueId ?? event?.venue?.id;

  if (!venueId) return "Venue not assigned";

  const venue = venues.find((item) => {
    const id = item?.id ?? item?._id ?? item?.venue_id;
    return String(id) === String(venueId);
  });

  return venue?.name ?? venue?.venue_name ?? "Venue not assigned";
}

function getSponsorshipEventId(sponsorship) {
  const value =
    sponsorship?.event_id ??
    sponsorship?.eventId ??
    sponsorship?.event?._id ??
    sponsorship?.event?.id ??
    (typeof sponsorship?.event === "string"
      ? sponsorship.event
      : "");

  return value ? String(value) : "";
}

function getNotificationId(notification) {
  return String(notification?.id ?? notification?._id ?? "");
}

function formatNotificationDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/* =========================================================
   NOTIFICATION CENTER
   "View all" stays inside the bell dropdown.
========================================================= */

function NotificationCenter({ onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef(null);
  const mountedRef = useRef(false);
  const requestInProgress = useRef(false);

  const loadNotifications = useCallback(async (showLoading = false) => {
    if (requestInProgress.current) return;

    requestInProgress.current = true;

    if (showLoading && mountedRef.current) {
      setLoading(true);
    }

    try {
      const [listResponse, countResponse] = await Promise.all([
        getNotifications({ limit: 8, skip: 0 }),
        getUnreadNotificationCount(),
      ]);

      if (!mountedRef.current) return;

      setNotifications(
        toArray(listResponse, ["notifications", "items"])
      );

      setUnreadCount(
        Math.max(
          0,
          safeNumber(
            countResponse?.unread_count ??
              countResponse?.count ??
              listResponse?.unread_count
          )
        )
      );

      setError("");
    } catch (err) {
      if (mountedRef.current) {
        setError(err?.message || "Unable to load notifications.");
      }
    } finally {
      requestInProgress.current = false;

      if (mountedRef.current && showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    loadNotifications(true);

    const interval = window.setInterval(() => {
      if (!document.hidden) loadNotifications();
    }, 30000);

    const handleFocus = () => loadNotifications();

    const handleVisibility = () => {
      if (!document.hidden) loadNotifications();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadNotifications]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleMarkRead = async (notification) => {
    const id = getNotificationId(notification);

    if (!id || notification.is_read || busyId) return;

    setBusyId(id);
    setError("");

    try {
      await markNotificationRead(id);

      if (!mountedRef.current) return;

      setNotifications((previous) =>
        previous.map((item) =>
          getNotificationId(item) === id
            ? { ...item, is_read: true }
            : item
        )
      );

      setUnreadCount((previous) => Math.max(0, previous - 1));
    } catch (err) {
      setError(err?.message || "Unable to mark notification as read.");
    } finally {
      if (mountedRef.current) setBusyId("");
    }
  };

  const handleMarkAllRead = async () => {
    if (!unreadCount || markingAll) return;

    setMarkingAll(true);
    setError("");

    try {
      await markAllNotificationsRead();

      if (!mountedRef.current) return;

      setNotifications((previous) =>
        previous.map((item) => ({ ...item, is_read: true }))
      );

      setUnreadCount(0);
    } catch (err) {
      setError(err?.message || "Unable to mark all as read.");
    } finally {
      if (mountedRef.current) setMarkingAll(false);
    }
  };

  const handleDelete = async (notification) => {
    const id = getNotificationId(notification);

    if (!id || busyId) return;

    setBusyId(id);
    setError("");

    try {
      await deleteNotification(id);

      if (!mountedRef.current) return;

      setNotifications((previous) =>
        previous.filter((item) => getNotificationId(item) !== id)
      );

      if (!notification.is_read) {
        setUnreadCount((previous) => Math.max(0, previous - 1));
      }
    } catch (err) {
      setError(err?.message || "Unable to delete notification.");
    } finally {
      if (mountedRef.current) setBusyId("");
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    onNavigate("Notifications");
  };

  return (
    <div
      className="dashboard-notification-container"
      ref={containerRef}
    >
      <button
        type="button"
        className="dashboard-notification-trigger"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) loadNotifications(true);
        }}
        aria-label={
          unreadCount
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
        aria-expanded={open}
        title="Notifications"
      >
        {unreadCount > 0 ? (
          <BellRing size={18} />
        ) : (
          <Bell size={18} />
        )}

        {unreadCount > 0 && (
          <span className="dashboard-notification-count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="dashboard-notification-dropdown"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="dashboard-notification-header">
            <div>
              <h3>Notifications</h3>
              <p>
                {unreadCount
                  ? `${unreadCount} unread notification${
                      unreadCount === 1 ? "" : "s"
                    }`
                  : "You're all caught up"}
              </p>
            </div>

            <div className="dashboard-notification-header-actions">
              {unreadCount > 0 && (
                <button
                  type="button"
                  title="Mark all as read"
                  aria-label="Mark all as read"
                  disabled={markingAll}
                  onClick={handleMarkAllRead}
                >
                  {markingAll ? (
                    <LoaderCircle
                      size={16}
                      className="dashboard-spinning"
                    />
                  ) : (
                    <CheckCheck size={16} />
                  )}
                </button>
              )}

              <button
                type="button"
                title="Close notifications"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {error && (
            <div className="dashboard-notification-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="dashboard-notification-empty">
              <LoaderCircle
                size={22}
                className="dashboard-spinning"
              />
              <p>Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="dashboard-notification-empty">
              <Bell size={26} />
              <h4>No notifications</h4>
              <p>Event and registration updates will appear here.</p>
            </div>
          ) : (
            <div className="dashboard-notification-list">
              {notifications.map((notification, index) => {
                const id =
                  getNotificationId(notification) ||
                  `notification-${index}`;

                const busy = busyId === id;

                return (
                  <article
                    key={id}
                    className={[
                      "dashboard-notification-item",
                      notification.is_read ? "is-read" : "is-unread",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      className="dashboard-notification-content"
                      onClick={() => handleMarkRead(notification)}
                      disabled={notification.is_read || busy}
                    >
                      <span className="dashboard-notification-indicator">
                        {notification.is_read ? (
                          <Check size={13} />
                        ) : (
                          <span />
                        )}
                      </span>

                      <span className="dashboard-notification-text">
                        <strong>
                          {notification.title || "Notification"}
                        </strong>
                        <span>
                          {notification.message || "You have a new update."}
                        </span>
                        <small>
                          {formatNotificationDate(notification.created_at)}
                        </small>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="dashboard-notification-delete"
                      title="Delete notification"
                      aria-label="Delete notification"
                      disabled={busy}
                      onClick={() => handleDelete(notification)}
                    >
                      {busy ? (
                        <LoaderCircle
                          size={14}
                          className="dashboard-spinning"
                        />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          <div className="dashboard-notification-footer">
            <button
              type="button"
              onClick={() => loadNotifications(true)}
              disabled={loading}
            >
              <RefreshCw
                size={13}
                className={loading ? "dashboard-spinning" : ""}
              />
              Refresh
            </button>

            <button
              type="button"
              className="dashboard-view-all-notifications"
              onClick={handleViewAll}
            >
              View all
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   REUSABLE DASHBOARD COMPONENTS
========================================================= */

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  onClick,
  tone = "green",
}) {
  return (
    <button
      type="button"
      className={`dashboard-stat-card tone-${tone}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="dashboard-stat-icon">
        <Icon size={18} />
      </span>

      <span className="dashboard-stat-body">
        <span className="dashboard-stat-label">{label}</span>
        <strong className="dashboard-stat-value">{value}</strong>
        <span className="dashboard-stat-helper" title={helper}>
          {helper}
        </span>
      </span>
    </button>
  );
}

function StatusBadge({ status }) {
  const className = String(status || "Scheduled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return (
    <span className={`dashboard-status-badge ${className}`}>
      {status || "Scheduled"}
    </span>
  );
}

function MetricPanel({ title, subtitle, children, action, className = "" }) {
  return (
    <section className={`dashboard-panel ${className}`.trim()}>
      <div className="dashboard-panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelLoading({ text }) {
  return (
    <div className="dashboard-empty-state">
      <LoaderCircle size={22} className="dashboard-spinning" />
      <p>{text}</p>
    </div>
  );
}

/* =========================================================
   ORGANIZER DASHBOARD DATA
========================================================= */

function useOrganizerDashboardData(user) {
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [eventFinancials, setEventFinancials] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [partialErrors, setPartialErrors] = useState([]);

  /* Depend on primitive values so a new user object with the
     same identity does not trigger another full reload. */
  const currentUserId = getUserId(user);
  const organizerOnly = isOrganizer(user);

  const latestRequest = useRef(0);

  const loadDashboard = useCallback(
    async (isRefresh = false) => {
      const requestId = ++latestRequest.current;
      const isStale = () => requestId !== latestRequest.current;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");
      setPartialErrors([]);

      try {
        const [eventsResult, venuesResult, sponsorshipResult] =
          await Promise.allSettled([
            getEvents(),
            getVenues(),
            getSponsorships(),
          ]);

        if (eventsResult.status === "rejected") {
          throw new Error(
            eventsResult.reason?.message ||
              "Unable to retrieve events."
          );
        }

        const allEvents = toArray(eventsResult.value, [
          "events",
          "items",
        ]);

        /* Organizers only see their own events (backend: organizer_id). */
        let visibleEvents = allEvents;

        if (organizerOnly) {
          if (!currentUserId) {
            throw new Error(
              "Unable to identify the logged-in organizer. Please log in again."
            );
          }

          visibleEvents = allEvents.filter(
            (event) => getEventOwnerId(event) === currentUserId
          );
        }

        const venueList =
          venuesResult.status === "fulfilled"
            ? toArray(venuesResult.value, ["venues", "items"])
            : [];

        /* Budget + attendee records for each visible event. */
        const perEventResults = await Promise.all(
          visibleEvents.map(async (event) => {
            const eventId = getId(event);

            if (!eventId) {
              return {
                event,
                budget: null,
                expenses: [],
                attendeeCount: safeNumber(event.attendee_count),
                budgetError: "Missing event ID.",
                attendeeError: "",
              };
            }

            const [budgetResult, attendeeResult] =
              await Promise.allSettled([
                apiRequest(
                  `/budgets/event/${encodeURIComponent(eventId)}`
                ),
                apiRequest(
                  `/attendees/event/${encodeURIComponent(eventId)}`
                ),
              ]);

            let budget = null;
            let expenses = [];
            let budgetError = "";

            if (budgetResult.status === "fulfilled") {
              const response = budgetResult.value;

              budget =
                response?.budget ?? response?.data?.budget ?? null;

              expenses = toArray(response, ["expenses"]);

              if (!budget) {
                budgetError = "Budget data was not returned.";
              }
            } else {
              budgetError =
                budgetResult.reason?.message ||
                "Unable to load event budget.";
            }

            let attendeeCount = safeNumber(event.attendee_count);
            let attendeeError = "";

            if (attendeeResult.status === "fulfilled") {
              const response = attendeeResult.value;

              if (
                response?.count !== undefined &&
                response?.count !== null &&
                Number.isFinite(Number(response.count))
              ) {
                attendeeCount = Number(response.count);
              } else {
                attendeeCount = toArray(response, [
                  "attendees",
                  "registrations",
                  "items",
                ]).length;
              }
            } else {
              attendeeError =
                attendeeResult.reason?.message ||
                "Unable to load attendee registrations.";
            }

            return {
              event,
              budget,
              expenses,
              attendeeCount,
              budgetError,
              attendeeError,
            };
          })
        );

        /* Financial rules:
           - approved expenses = actual expenses
           - pending expenses stay separate
           - rejected expenses are excluded
           - remaining = total budget - approved expenses */
        let totalBudget = 0;
        let actualExpenses = 0;
        let pendingExpenseAmount = 0;
        let approvedExpenseAmount = 0;
        let pendingExpenses = 0;
        let approvedExpenses = 0;
        let budgetRecordsLoaded = 0;
        let budgetRecordsFailed = 0;
        let registeredAttendees = 0;

        const errors = [];

        perEventResults.forEach((item) => {
          registeredAttendees += safeNumber(item.attendeeCount);

          if (item.attendeeError) {
            errors.push(
              `${getEventName(item.event)}: ${item.attendeeError} Using the stored attendee count instead.`
            );
          }

          if (item.budgetError) {
            budgetRecordsFailed += 1;
            errors.push(
              `${getEventName(item.event)}: ${item.budgetError}`
            );
            return;
          }

          budgetRecordsLoaded += 1;

          totalBudget += safeNumber(
            item.budget?.total_budget ?? item.event?.budget
          );

          item.expenses.forEach((expense) => {
            const status = String(expense?.status ?? "Pending")
              .trim()
              .toLowerCase();

            const amount = safeNumber(expense?.amount);

            if (status === "pending") {
              pendingExpenses += 1;
              pendingExpenseAmount += amount;
            } else if (status === "approved") {
              approvedExpenses += 1;
              approvedExpenseAmount += amount;
              actualExpenses += amount;
            }
          });
        });

        if (venuesResult.status === "rejected") {
          errors.push("Venue records could not be loaded.");
        }

        /* Sponsorship revenue = money received (not pledged).
           For organizers, only count sponsorships linked to their own
           events when the record says which event it belongs to. */
        let sponsorshipList = [];

        if (sponsorshipResult.status === "fulfilled") {
          sponsorshipList = toArray(sponsorshipResult.value, [
            "sponsorships",
            "items",
          ]);
        } else {
          errors.push(
            sponsorshipResult.reason?.message ||
              "Unable to load sponsorship records."
          );
        }

        const visibleEventIds = new Set(
          visibleEvents.map((event) => getId(event))
        );

        const sponsorshipRevenue = sponsorshipList.reduce(
          (total, sponsorship) => {
            const status = String(sponsorship?.status ?? "")
              .trim()
              .toLowerCase();

            if (status === "cancelled" || status === "canceled") {
              return total;
            }

            if (organizerOnly) {
              const linkedEventId = getSponsorshipEventId(sponsorship);

              if (linkedEventId && !visibleEventIds.has(linkedEventId)) {
                return total;
              }
            }

            return total + safeNumber(sponsorship?.amount_received);
          },
          0
        );

        if (isStale()) return;

        setEvents(visibleEvents);
        setVenues(venueList);
        setEventFinancials(perEventResults);

        setSummary({
          totalEvents: visibleEvents.length,
          registeredAttendees,
          totalBudget,
          actualExpenses,
          remainingBudget: totalBudget - actualExpenses,
          sponsorshipRevenue,
          pendingExpenses,
          pendingExpenseAmount,
          approvedExpenses,
          approvedExpenseAmount,
          budgetRecordsLoaded,
          budgetRecordsFailed,
        });

        setPartialErrors(errors);
      } catch (err) {
        if (isStale()) return;

        setError(
          err?.message || "Unable to load organizer dashboard."
        );

        setEvents([]);
        setEventFinancials([]);
        setSummary(EMPTY_SUMMARY);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [currentUserId, organizerOnly]
  );

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const refresh = useCallback(
    () => loadDashboard(true),
    [loadDashboard]
  );

  return {
    events,
    venues,
    summary,
    eventFinancials,
    loading,
    refreshing,
    error,
    partialErrors,
    refresh,
  };
}

/* =========================================================
   MINI EVENT CALENDAR
========================================================= */

function MiniCalendar({ events, onSelectDate }) {
  const [monthDate, setMonthDate] = useState(() => new Date());

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  /* Marks every day of multi-day events too. */
  const eventDays = useMemo(() => {
    const days = new Set();

    events.forEach((event) => {
      if (getEventStatus(event) === "Cancelled") return;

      const start = getEventDate(event);

      if (!start) return;

      const end = getEventEndDate(event) ?? start;
      const cursor = new Date(start);

      for (let step = 0; cursor <= end && step < 366; step += 1) {
        if (
          cursor.getFullYear() === year &&
          cursor.getMonth() === month
        ) {
          days.add(cursor.getDate());
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    });

    return days;
  }, [events, year, month]);

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  const today = new Date();

  return (
    <MetricPanel
      title="Event calendar"
      subtitle="Days with scheduled events."
      action={<CalendarDays size={18} />}
      className="dashboard-calendar-panel"
    >
      <div className="dashboard-calendar-header">
        <p className="dashboard-calendar-month">
          {new Intl.DateTimeFormat("en-IN", {
            month: "long",
            year: "numeric",
          }).format(monthDate)}
        </p>

        <div className="dashboard-calendar-controls">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonthDate(new Date(year, month - 1, 1))}
          >
            <ChevronLeft size={16} />
          </button>

          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonthDate(new Date(year, month + 1, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="dashboard-calendar-grid">
        {WEEKDAYS.map((label) => (
          <span className="dashboard-calendar-weekday" key={label}>
            {label}
          </span>
        ))}

        {cells.map((day, index) => {
          const isToday =
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

          const hasEvent = Boolean(day) && eventDays.has(day);

          return (
            <button
              type="button"
              key={`${year}-${month}-${index}`}
              disabled={!day}
              aria-label={
                day
                  ? `${formatDate(new Date(year, month, day))}${
                      hasEvent ? ", has events" : ""
                    }`
                  : undefined
              }
              className={[
                "dashboard-calendar-day",
                isToday ? "today" : "",
                hasEvent ? "has-event" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                if (day) {
                  onSelectDate?.(new Date(year, month, day));
                }
              }}
            >
              {day || ""}
              {hasEvent && <span className="dashboard-calendar-dot" />}
            </button>
          );
        })}
      </div>
    </MetricPanel>
  );
}

/* =========================================================
   ORGANIZER DASHBOARD OVERVIEW
========================================================= */

function DashboardOverview({
  user,
  events,
  venues,
  summary,
  eventFinancials,
  loading,
  refreshing,
  error,
  partialErrors,
  onRefresh,
  onNavigate,
}) {
  const attendeeByEvent = useMemo(() => {
    const map = new Map();

    eventFinancials.forEach((item) => {
      map.set(getId(item.event), item.attendeeCount);
    });

    return map;
  }, [eventFinancials]);

  const upcomingEvents = useMemo(() => {
    return events
      .filter((event) => {
        const status = getEventStatus(event);
        return status !== "Cancelled" && status !== "Completed";
      })
      .sort((a, b) => {
        const first = getEventStartDateTime(a)?.getTime() ?? 0;
        const second = getEventStartDateTime(b)?.getTime() ?? 0;
        return first - second;
      });
  }, [events]);

  const nextEvent = upcomingEvents[0];

  const financialRows = useMemo(
    () =>
      eventFinancials.map((item) => {
        const sumBy = (status) =>
          item.expenses
            .filter(
              (expense) =>
                String(expense?.status ?? "Pending")
                  .trim()
                  .toLowerCase() === status
            )
            .reduce(
              (total, expense) => total + safeNumber(expense?.amount),
              0
            );

        const approved = sumBy("approved");
        const pending = sumBy("pending");

        const budget = safeNumber(
          item.budget?.total_budget ?? item.event?.budget
        );

        return {
          event: item.event,
          available: Boolean(item.budget),
          budget,
          approved,
          pending,
          remaining: budget - approved,
          attendeeCount: item.attendeeCount,
        };
      }),
    [eventFinancials]
  );

  const modules = [
    { label: "Events", icon: CalendarDays },
    { label: "Attendance", icon: Users },
    { label: "Budget", icon: Wallet },
    { label: "Sponsorships", icon: Handshake },
    { label: "Vendors", icon: Building2 },
    { label: "Venues", icon: DoorOpen },
    { label: "Resources", icon: Package },
    { label: "Scheduling", icon: CalendarPlus },
    ...(isAdmin(user)
      ? [{ label: "Approvals", icon: CheckCheck }]
      : []),
  ];

  const hasBudgetRecords = summary.budgetRecordsLoaded > 0;
  const budgetCoverageIncomplete = summary.budgetRecordsFailed > 0;

  const utilizationRaw =
    summary.totalBudget > 0
      ? (summary.actualExpenses / summary.totalBudget) * 100
      : 0;

  const utilization = clampPercent(utilizationRaw);

  const utilizationLevel =
    utilizationRaw > 100
      ? "danger"
      : utilizationRaw >= 80
        ? "warning"
        : "ok";

  const money = (value) =>
    loading ? "…" : hasBudgetRecords ? formatMoney(value) : "—";

  return (
    <>
      {/* WELCOME */}

      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">EVENT MANAGEMENT WORKSPACE</p>

          <h2>
            {getGreeting()}, {getUserName(user)}!
          </h2>

          <p>
            Track events, registrations, budgets, expenses and
            sponsorship revenue in one place.
          </p>
        </div>

        <div className="dashboard-welcome-actions">
          <button
            type="button"
            className="dashboard-secondary-button"
            onClick={onRefresh}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={14}
              className={
                loading || refreshing ? "dashboard-spinning" : ""
              }
            />
            Refresh
          </button>

          <button
            type="button"
            className="dashboard-primary-button"
            onClick={() => onNavigate("Events")}
          >
            <Plus size={15} />
            Manage events
          </button>
        </div>
      </section>

      {/* MAIN API ERROR */}

      {error && (
        <div className="dashboard-alert" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>

          <button type="button" onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}

      {/* PARTIAL API ERRORS */}

      {!error && partialErrors.length > 0 && (
        <div className="dashboard-alert is-warning" role="status">
          <AlertCircle size={16} />

          <div className="dashboard-alert-body">
            <strong>Some dashboard data could not be loaded.</strong>

            <ul>
              {partialErrors.slice(0, 3).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>

            {partialErrors.length > 3 && (
              <small>+ {partialErrors.length - 3} more. Some totals may be incomplete.</small>
            )}
          </div>

          <button type="button" onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}

      {/* PRIMARY METRICS */}

      <section className="dashboard-stat-grid">
        <StatCard
          tone="green"
          icon={CalendarDays}
          label="Total events"
          value={loading ? "…" : summary.totalEvents}
          helper="Assigned to your account"
          onClick={() => onNavigate("Events")}
        />

        <StatCard
          tone="amber"
          icon={Users}
          label="Registered attendees"
          value={
            loading
              ? "…"
              : summary.registeredAttendees.toLocaleString("en-IN")
          }
          helper="Active registrations"
          onClick={() => onNavigate("Attendance")}
        />

        <StatCard
          tone="blue"
          icon={Wallet}
          label="Total event budget"
          value={money(summary.totalBudget)}
          helper="Combined budget"
          onClick={() => onNavigate("Budget")}
        />

        <StatCard
          tone="purple"
          icon={IndianRupee}
          label="Actual expenses"
          value={money(summary.actualExpenses)}
          helper="Approved expenses"
          onClick={() => onNavigate("Budget")}
        />

        <StatCard
          tone={
            hasBudgetRecords && summary.remainingBudget < 0
              ? "red"
              : "green"
          }
          icon={Wallet}
          label="Remaining budget"
          value={money(summary.remainingBudget)}
          helper="Budget minus approved"
          onClick={() => onNavigate("Budget")}
        />

        <StatCard
          tone="blue"
          icon={Handshake}
          label="Sponsorship revenue"
          value={loading ? "…" : formatMoney(summary.sponsorshipRevenue)}
          helper="Money received, not pledged"
          onClick={() => onNavigate("Sponsorships")}
        />

        <StatCard
          tone="amber"
          icon={Clock3}
          label="Pending expenses"
          value={loading ? "…" : summary.pendingExpenses}
          helper={
            loading
              ? "Loading…"
              : `${formatMoney(summary.pendingExpenseAmount)} awaiting review`
          }
          onClick={() => onNavigate("Budget")}
        />

        <StatCard
          tone="green"
          icon={CheckCheck}
          label="Approved expenses"
          value={loading ? "…" : summary.approvedExpenses}
          helper={
            loading
              ? "Loading…"
              : `${formatMoney(summary.approvedExpenseAmount)} approved`
          }
          onClick={() => onNavigate("Budget")}
        />
      </section>

      {/* EVENTS + CALENDAR */}

      <div className="dashboard-main-grid">
        <MetricPanel
          title="Upcoming events"
          subtitle="Your nearest scheduled events."
          action={
            <button
              type="button"
              className="dashboard-text-button"
              onClick={() => onNavigate("Events")}
            >
              View all <ChevronRight size={14} />
            </button>
          }
        >
          {loading ? (
            <PanelLoading text="Loading events..." />
          ) : upcomingEvents.length === 0 ? (
            <div className="dashboard-empty-state">
              <CalendarDays size={26} />
              <h3>No upcoming events</h3>
              <p>
                Create an event or update an existing one to see it here.
              </p>
            </div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date &amp; time</th>
                    <th>Venue</th>
                    <th className="is-number">Attendees</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {upcomingEvents.slice(0, 5).map((event, index) => {
                    const eventId = getId(event);

                    const attendees = attendeeByEvent.has(eventId)
                      ? attendeeByEvent.get(eventId)
                      : safeNumber(event.attendee_count);

                    return (
                      <tr key={eventId || `upcoming-${index}`}>
                        <td>
                          <strong>{getEventName(event)}</strong>
                          <span className="dashboard-subtext">
                            {event?.event_type ?? event?.category ?? "Event"}
                          </span>
                        </td>

                        <td>
                          {formatDateRange(event)}
                          <span className="dashboard-subtext">
                            {formatTime(
                              event?.start_time ?? event?.time
                            )}
                          </span>
                        </td>

                        <td>{getVenueName(event, venues)}</td>

                        <td className="is-number">{attendees}</td>

                        <td>
                          <StatusBadge status={getEventStatus(event)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </MetricPanel>

        <MiniCalendar
          events={events}
          onSelectDate={() => onNavigate("Scheduling")}
        />
      </div>

      {/* BUDGET + EXPENSES + NEXT EVENT */}

      <div className="dashboard-triple-grid">
        <MetricPanel
          title="Budget tracking"
          subtitle="Approved expenses vs total budget."
          action={<Wallet size={18} />}
        >
          {loading ? (
            <PanelLoading text="Calculating budget..." />
          ) : !hasBudgetRecords ? (
            <div className="dashboard-empty-state">
              <Wallet size={26} />
              <h3>Budget data unavailable</h3>
              <p>Budget information could not be retrieved.</p>
            </div>
          ) : (
            <div className="dashboard-budget-summary">
              <div className="dashboard-budget-total">
                <span>Allocated budget</span>
                <strong>{formatMoney(summary.totalBudget)}</strong>
              </div>

              <div className="dashboard-budget-total">
                <span>Approved expenses</span>
                <strong>{formatMoney(summary.actualExpenses)}</strong>
              </div>

              <div
                className={`dashboard-budget-total ${
                  summary.remainingBudget < 0 ? "is-negative" : ""
                }`}
              >
                <span>Remaining budget</span>
                <strong>{formatMoney(summary.remainingBudget)}</strong>
              </div>

              <div className="dashboard-budget-progress">
                <div className="dashboard-budget-progress-head">
                  <span>Utilization</span>
                  <strong>
                    {summary.totalBudget > 0
                      ? `${utilizationRaw.toFixed(1)}%`
                      : "0%"}
                  </strong>
                </div>

                <div
                  className="dashboard-progress-track"
                  role="progressbar"
                  aria-label="Budget utilization"
                  aria-valuenow={Math.round(utilization)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`dashboard-progress-fill is-${utilizationLevel}`}
                    style={{ width: `${utilization}%` }}
                  />
                </div>

                <p className="dashboard-subtext">
                  {utilizationRaw > 100
                    ? "Approved expenses exceed the allocated budget."
                    : "Based on approved expenses only."}
                </p>
              </div>

              {budgetCoverageIncomplete && (
                <p className="dashboard-subtext is-warning">
                  Partial totals: {summary.budgetRecordsLoaded} of{" "}
                  {summary.budgetRecordsLoaded +
                    summary.budgetRecordsFailed}{" "}
                  event budgets loaded.
                </p>
              )}

              <button
                type="button"
                className="dashboard-text-button"
                onClick={() => onNavigate("Budget")}
              >
                Open budget management
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </MetricPanel>

        <MetricPanel
          title="Expense overview"
          subtitle="Requests grouped by status."
          action={<Activity size={18} />}
        >
          {loading ? (
            <PanelLoading text="Loading expenses..." />
          ) : !hasBudgetRecords ? (
            <div className="dashboard-empty-state">
              <Package size={26} />
              <p>Expense information is unavailable.</p>
            </div>
          ) : (
            <div className="dashboard-expense-summary">
              <div className="dashboard-expense-row">
                <span className="dashboard-expense-indicator pending" />
                <div className="dashboard-expense-label">
                  <strong>Pending</strong>
                  <small>Awaiting approval</small>
                </div>
                <div className="dashboard-expense-value">
                  <strong>{summary.pendingExpenses}</strong>
                  <small>{formatMoney(summary.pendingExpenseAmount)}</small>
                </div>
              </div>

              <div className="dashboard-expense-row">
                <span className="dashboard-expense-indicator approved" />
                <div className="dashboard-expense-label">
                  <strong>Approved</strong>
                  <small>Recorded expenses</small>
                </div>
                <div className="dashboard-expense-value">
                  <strong>{summary.approvedExpenses}</strong>
                  <small>{formatMoney(summary.approvedExpenseAmount)}</small>
                </div>
              </div>

              <div className="dashboard-expense-total">
                <span>Total approved actual expenses</span>
                <strong>{formatMoney(summary.actualExpenses)}</strong>
              </div>

              <button
                type="button"
                className="dashboard-text-button"
                onClick={() => onNavigate("Budget")}
              >
                View expense records
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </MetricPanel>

        <MetricPanel
          title="Next event"
          subtitle="Your nearest upcoming event."
          action={<Clock3 size={18} />}
        >
          {loading ? (
            <PanelLoading text="Loading..." />
          ) : nextEvent ? (
            <div className="dashboard-next-event">
              <strong>{getEventName(nextEvent)}</strong>

              <p>
                <CalendarDays size={14} />
                {formatDateRange(nextEvent)}
              </p>

              <p>
                <Clock3 size={14} />
                {formatTime(nextEvent?.start_time ?? nextEvent?.time)}
              </p>

              <p>
                <MapPin size={14} />
                {getVenueName(nextEvent, venues)}
              </p>

              <StatusBadge status={getEventStatus(nextEvent)} />
            </div>
          ) : (
            <div className="dashboard-empty-state">
              <CalendarDays size={26} />
              <p>No upcoming event is available.</p>
            </div>
          )}
        </MetricPanel>
      </div>

      {/* EVENT-WISE FINANCIAL BREAKDOWN */}

      <MetricPanel
        title="Event-wise budget breakdown"
        subtitle="Budget, approved expenses, pending requests and remaining amount per event."
        action={<Wallet size={18} />}
        className="dashboard-breakdown-panel"
      >
        {loading ? (
          <PanelLoading text="Loading event budgets..." />
        ) : financialRows.length === 0 ? (
          <div className="dashboard-empty-state">
            <Wallet size={26} />
            <h3>No event financial records</h3>
            <p>Your event budget information will appear here.</p>
          </div>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="is-number">Total budget</th>
                  <th className="is-number">Approved</th>
                  <th className="is-number">Pending</th>
                  <th className="is-number">Remaining</th>
                </tr>
              </thead>

              <tbody>
                {financialRows.map((row, index) => (
                  <tr key={getId(row.event) || `financial-${index}`}>
                    <td>
                      <strong>{getEventName(row.event)}</strong>
                      <span className="dashboard-subtext">
                        {formatDateRange(row.event)}
                      </span>
                    </td>

                    <td className="is-number">
                      {row.available ? formatMoney(row.budget) : "Unavailable"}
                    </td>

                    <td className="is-number">
                      {row.available ? formatMoney(row.approved) : "Unavailable"}
                    </td>

                    <td className="is-number">
                      {row.available ? formatMoney(row.pending) : "Unavailable"}
                    </td>

                    <td
                      className={`is-number ${
                        row.available && row.remaining < 0
                          ? "is-negative"
                          : ""
                      }`}
                    >
                      {row.available
                        ? formatMoney(row.remaining)
                        : "Unavailable"}
                    </td>
                  </tr>
                ))}
              </tbody>

              {hasBudgetRecords && (
                <tfoot>
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td className="is-number">
                      {formatMoney(summary.totalBudget)}
                    </td>
                    <td className="is-number">
                      {formatMoney(summary.actualExpenses)}
                    </td>
                    <td className="is-number">
                      {formatMoney(summary.pendingExpenseAmount)}
                    </td>
                    <td
                      className={`is-number ${
                        summary.remainingBudget < 0 ? "is-negative" : ""
                      }`}
                    >
                      {formatMoney(summary.remainingBudget)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </MetricPanel>

      {/* QUICK ACCESS */}

      <MetricPanel
        title="Workspace modules"
        subtitle="Quick access to event management tools."
        action={<Activity size={18} />}
        className="dashboard-modules-panel"
      >
        <div className="dashboard-module-list">
          {modules.map(({ label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              onClick={() => onNavigate(label)}
            >
              <Icon size={16} />
              <strong>{label}</strong>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </MetricPanel>

      <footer className="dashboard-footer">
        <span>{new Date().getFullYear()} EventSphere</span>
        <span>Dashboard metrics are calculated from your API records.</span>
      </footer>
    </>
  );
}

/* =========================================================
   MAIN DASHBOARD
========================================================= */

export default function Dashboard({ user: userProp, onLogout }) {
  const [user, setUser] = useState(() => {
    if (userProp) return userProp;

    try {
      return (
        JSON.parse(localStorage.getItem("user") || "null") ||
        JSON.parse(sessionStorage.getItem("user") || "null")
      );
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState("Dashboard");

  useEffect(() => {
    if (userProp !== undefined) {
      setUser(userProp);
    }
  }, [userProp]);

  const {
    events,
    venues,
    summary,
    eventFinancials,
    loading,
    refreshing,
    error,
    partialErrors,
    refresh,
  } = useOrganizerDashboardData(user);

  const handleNavigate = useCallback((page) => {
    setActivePage(page);
  }, []);

  const handleLogout = useCallback(async () => {
    if (typeof onLogout === "function") {
      await onLogout();
      return;
    }

    try {
      await logoutUser();
    } catch {
      // Clear local credentials even if the logout API fails.
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

    case "Budget":
      pageContent = <Budget user={user} />;
      break;

    case "Vendors":
      pageContent = <OrganizerVendors user={user} />;
      break;

    case "Sponsorships":
      pageContent = <Sponsorships user={user} />;
      break;

    case "Approvals":
      pageContent = isAdmin(user) ? (
        <Approvals user={user} />
      ) : (
        <section className="dashboard-panel">
          <div className="dashboard-empty-state">
            <AlertCircle size={26} />
            <h3>Access restricted</h3>
            <p>
              Expense approval actions are currently restricted to
              administrators by the backend.
            </p>
          </div>
        </section>
      );
      break;

    case "Notifications":
      pageContent = <Notifications />;
      break;

    default:
      pageContent = (
        <DashboardOverview
          user={user}
          events={events}
          venues={venues}
          summary={summary}
          eventFinancials={eventFinancials}
          loading={loading}
          refreshing={refreshing}
          error={error}
          partialErrors={partialErrors}
          onRefresh={refresh}
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
            <NotificationCenter onNavigate={handleNavigate} />

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
              {(getUserName(user).trim().charAt(0) || "U").toUpperCase()}
            </button>
          </div>
        </header>

        <div className="dashboard-content">{pageContent}</div>
      </main>
    </div>
  );
}