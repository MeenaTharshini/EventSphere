import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  AlertCircle,
  Bell,
  BellRing,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DoorOpen,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Users,
  Building2,
  Wallet,
  Handshake,
  ShieldCheck,
  XCircle,
  IndianRupee,
  Trash2,
  X,
} from "lucide-react";

import {
  apiRequest,
  getEvents,
  getVenues,
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

import "./Dashboard.css";

/* =======================================================
   HELPERS
======================================================= */

const EMPTY_ARRAY = [];

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
  return String(
    item?.id ??
    item?._id ??
    item?.event_id ??
    ""
  );
}

function getEventDate(event) {
  const value =
    event?.date ??
    event?.event_date ??
    event?.start_date ??
    event?.startDate;

  if (!value) return null;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "Date not available";

  const date =
    value instanceof Date
      ? value
      : getEventDate({ date: value });

  if (!date || Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "Time not available";

  if (typeof value === "string" && value.includes("T")) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }
  }

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) return String(value);

  const date = new Date(
    2000,
    0,
    1,
    Number(match[1]),
    Number(match[2])
  );

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getEventName(event) {
  return (
    event?.title ??
    event?.event_name ??
    event?.eventName ??
    event?.name ??
    "Untitled event"
  );
}

function getStatus(event) {
  const value = String(event?.status ?? "").toLowerCase();

  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("complete")) return "Completed";

  if (value.includes("progress") || value.includes("ongoing")) {
    return "In Progress";
  }

  if (value.includes("confirm")) return "Confirmed";
  if (value.includes("draft")) return "Draft";

  return event?.status || "Scheduled";
}

function getVenueName(event, venues) {
  if (event?.venue_name) return event.venue_name;
  if (event?.venue?.name) return event.venue.name;

  const venueId =
    event?.venue_id ??
    event?.venueId ??
    event?.venue?.id ??
    event?.venue;

  if (!venueId) return "Venue not assigned";

  const venue = venues.find((item) => {
    const id =
      item?.id ??
      item?.venue_id ??
      item?._id;

    return String(id) === String(venueId);
  });

  return (
    venue?.name ??
    venue?.venue_name ??
    "Venue not assigned"
  );
}

function getUserName(user) {
  return (
    user?.name ??
    user?.full_name ??
    user?.username ??
    user?.user?.name ??
    ""
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

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getTimestamp(value) {
  if (!value) return 0;

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getNotificationId(notification) {
  return String(
    notification?.id ??
    notification?._id ??
    ""
  );
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

/* =======================================================
   NOTIFICATION CENTER
======================================================= */

function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  const containerRef = useRef(null);

  const loadNotifications = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      setError("");

      const [notificationResponse, countResponse] =
        await Promise.all([
          getNotifications({ limit: 8, skip: 0 }),
          getUnreadNotificationCount(),
        ]);
        console.log(
  "Notifications API response:",
  notificationResponse
);

console.log(
  "Unread count API response:",
  countResponse
);

console.log(
  "Current logged-in user:",
  JSON.parse(localStorage.getItem("user") || "null")
);
      const items = toArray(notificationResponse, [
        "notifications",
        "items",
      ]);

      setNotifications(items);

      const count =
        countResponse?.unread_count ??
        countResponse?.count ??
        notificationResponse?.unread_count ??
        0;

      setUnreadCount(Math.max(0, Number(count) || 0));
    } catch (err) {
      setError(
        err?.message ||
        "Unable to load notifications."
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  /* Initial load and periodic refresh */

  useEffect(() => {
    loadNotifications();

    const interval = window.setInterval(() => {
      loadNotifications();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [loadNotifications]);

  /* Close dropdown when clicking outside */

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );

      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, []);

  const handleToggle = () => {
    const nextOpen = !open;

    setOpen(nextOpen);

    if (nextOpen) {
      loadNotifications(true);
    }
  };

  const handleMarkRead = async (notification) => {
    const notificationId = getNotificationId(notification);

    if (!notificationId || notification.is_read) return;

    setProcessingId(notificationId);
    setError("");

    try {
      await markNotificationRead(notificationId);

      setNotifications((previous) =>
        previous.map((item) =>
          getNotificationId(item) === notificationId
            ? { ...item, is_read: true }
            : item
        )
      );

      setUnreadCount((previous) =>
        Math.max(0, previous - 1)
      );
    } catch (err) {
      setError(
        err?.message ||
        "Unable to mark notification as read."
      );
    } finally {
      setProcessingId("");
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;

    setMarkingAll(true);
    setError("");

    try {
      await markAllNotificationsRead();

      setNotifications((previous) =>
        previous.map((item) => ({
          ...item,
          is_read: true,
        }))
      );

      setUnreadCount(0);
    } catch (err) {
      setError(
        err?.message ||
        "Unable to mark all notifications as read."
      );
    } finally {
      setMarkingAll(false);
    }
  };

  const handleDelete = async (notification) => {
    const notificationId = getNotificationId(notification);

    if (!notificationId) return;

    setProcessingId(notificationId);
    setError("");

    try {
      await deleteNotification(notificationId);

      setNotifications((previous) =>
        previous.filter(
          (item) =>
            getNotificationId(item) !== notificationId
        )
      );

      if (!notification.is_read) {
        setUnreadCount((previous) =>
          Math.max(0, previous - 1)
        );
      }
    } catch (err) {
      setError(
        err?.message ||
        "Unable to delete notification."
      );
    } finally {
      setProcessingId("");
    }
  };

  return (
    <div
      className="dashboard-notification-container"
      ref={containerRef}
    >
      <button
        type="button"
        className="dashboard-notification-trigger"
        onClick={handleToggle}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
        aria-expanded={open}
        title="Notifications"
      >
        {unreadCount > 0 ? (
          <BellRing size={21} />
        ) : (
          <Bell size={21} />
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
                {unreadCount > 0
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
                  aria-label="Mark all notifications as read"
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                >
                  {markingAll ? (
                    <LoaderCircle
                      size={17}
                      className="dashboard-spinning"
                    />
                  ) : (
                    <CheckCheck size={17} />
                  )}
                </button>
              )}

              <button
                type="button"
                title="Close notifications"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {error && (
            <div
              className="dashboard-notification-error"
              role="alert"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="dashboard-notification-empty">
              <LoaderCircle
                size={23}
                className="dashboard-spinning"
              />

              <p>Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="dashboard-notification-empty">
              <Bell size={28} />

              <h4>No notifications</h4>

              <p>
                Updates about registrations, expenses,
                and events will appear here.
              </p>
            </div>
          ) : (
            <div className="dashboard-notification-list">
              {notifications.map((notification, index) => {
                const notificationId =
                  getNotificationId(notification) ||
                  `notification-${index}`;

                const busy =
                  processingId === notificationId;

                return (
                  <article
                    key={notificationId}
                    className={[
                      "dashboard-notification-item",
                      notification.is_read
                        ? "is-read"
                        : "is-unread",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      className="dashboard-notification-content"
                      onClick={() =>
                        handleMarkRead(notification)
                      }
                      disabled={
                        notification.is_read || busy
                      }
                    >
                      <span className="dashboard-notification-indicator">
                        {notification.is_read ? (
                          <Check size={15} />
                        ) : (
                          <span />
                        )}
                      </span>

                      <span className="dashboard-notification-text">
                        <strong>
                          {notification.title ||
                            "Notification"}
                        </strong>

                        <span>
                          {notification.message ||
                            "You have a new update."}
                        </span>

                        <small>
                          {formatNotificationDate(
                            notification.created_at
                          )}
                        </small>
                      </span>
                    </button>

                    <button
                      type="button"
                      className="dashboard-notification-delete"
                      aria-label="Delete notification"
                      title="Delete notification"
                      disabled={busy}
                      onClick={() =>
                        handleDelete(notification)
                      }
                    >
                      {busy ? (
                        <LoaderCircle
                          size={15}
                          className="dashboard-spinning"
                        />
                      ) : (
                        <Trash2 size={15} />
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
    size={14}
    className={loading ? "dashboard-spinning" : ""}
  />
  Refresh notifications
</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =======================================================
   REUSABLE COMPONENTS
======================================================= */

function StatCard({
  icon: Icon,
  label,
  value,
  helper,
  onClick,
}) {
  return (
    <button
      type="button"
      className="dashboard-stat-card"
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="dashboard-stat-icon">
        <Icon size={21} />
      </span>

      <span className="dashboard-stat-label">
        {label}
      </span>

      <strong className="dashboard-stat-value">
        {value}
      </strong>

      <span className="dashboard-stat-helper">
        {helper}
      </span>
    </button>
  );
}

function StatusBadge({ status }) {
  const className = String(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  return (
    <span className={`dashboard-status-badge ${className}`}>
      {status}
    </span>
  );
}

/* =======================================================
   MINI EVENT CALENDAR
======================================================= */

function MiniCalendar({ events, onSelectDate }) {
  const [monthDate, setMonthDate] = useState(() => new Date());

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventDays = useMemo(() => {
    const days = new Set();

    events.forEach((event) => {
      const date = getEventDate(event);

      if (
        date &&
        date.getFullYear() === year &&
        date.getMonth() === month
      ) {
        days.add(date.getDate());
      }
    });

    return days;
  }, [events, year, month]);

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    ),
  ];

  const today = new Date();

  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>Event calendar</h2>
          <p>Dates containing scheduled events.</p>
        </div>

        <div className="dashboard-calendar-controls">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() =>
              setMonthDate(new Date(year, month - 1, 1))
            }
          >
            ‹
          </button>

          <button
            type="button"
            aria-label="Next month"
            onClick={() =>
              setMonthDate(new Date(year, month + 1, 1))
            }
          >
            ›
          </button>
        </div>
      </div>

      <p className="dashboard-calendar-month">
        {new Intl.DateTimeFormat(undefined, {
          month: "long",
          year: "numeric",
        }).format(monthDate)}
      </p>

      <div className="dashboard-calendar-grid">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            className="dashboard-calendar-weekday"
            key={index}
          >
            {new Intl.DateTimeFormat(undefined, {
              weekday: "short",
            }).format(new Date(2024, 0, index + 7))}
          </span>
        ))}

        {cells.map((day, index) => {
          const isToday =
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

          return (
            <button
              type="button"
              key={`${year}-${month}-${index}`}
              disabled={!day}
              aria-label={
                day
                  ? `${formatDate(
                      new Date(year, month, day)
                    )}${
                      eventDays.has(day)
                        ? ", has events"
                        : ""
                    }`
                  : undefined
              }
              className={[
                "dashboard-calendar-day",
                isToday ? "today" : "",
                day && eventDays.has(day)
                  ? "has-event"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => {
                if (day) {
                  onSelectDate?.(
                    new Date(year, month, day)
                  );
                }
              }}
            >
              {day || ""}

              {day && eventDays.has(day) && (
                <span className="dashboard-calendar-dot" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* =======================================================
   ADMIN EXPENSE APPROVALS
======================================================= */

function ExpenseApprovals({ user }) {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadApprovals = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      const eventsResponse = await getEvents();

      const eventList = toArray(eventsResponse, [
        "events",
        "items",
      ]);

      const budgetResults = await Promise.allSettled(
        eventList.map(async (event) => {
          const eventId = getId(event);

          if (!eventId) return [];

          const response = await apiRequest(
            `/budgets/event/${encodeURIComponent(eventId)}`
          );

          const expenses = Array.isArray(response?.expenses)
            ? response.expenses
            : Array.isArray(response?.data?.expenses)
              ? response.data.expenses
              : [];

          const returnedEvent =
            response?.event ??
            response?.data?.event ??
            event;

          return expenses
            .filter(
              (expense) =>
                String(expense?.status ?? "Pending")
                  .trim()
                  .toLowerCase() === "pending"
            )
            .map((expense) => ({
              ...expense,

              event_id: expense.event_id || eventId,

              event_name:
                returnedEvent?.name ||
                returnedEvent?.title ||
                returnedEvent?.event_name ||
                getEventName(event),

              event_date:
                returnedEvent?.event_date ??
                returnedEvent?.date ??
                event?.event_date ??
                event?.date ??
                null,
            }));
        })
      );

      const pending = [];
      let failedRequests = 0;

      budgetResults.forEach((result) => {
        if (result.status === "fulfilled") {
          pending.push(...result.value);
        } else {
          failedRequests += 1;
        }
      });

      pending.sort((a, b) => {
        const dateA = getTimestamp(
          a.created_at || a.expense_date
        );

        const dateB = getTimestamp(
          b.created_at || b.expense_date
        );

        return dateB - dateA;
      });

      setApprovals(pending);

      if (
        budgetResults.length > 0 &&
        failedRequests === budgetResults.length
      ) {
        throw new Error(
          "Unable to retrieve budget records for the events. Please check your access and backend connection."
        );
      }

      if (failedRequests > 0) {
        setError(
          `Some event budgets could not be loaded (${failedRequests} of ${budgetResults.length}). The displayed requests may be incomplete.`
        );
      }
    } catch (err) {
      setError(
        err?.message ||
        "Unable to load pending approvals."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const processApproval = async (expense, action) => {
    const expenseId = String(
      expense?.id ??
      expense?._id ??
      ""
    );

    if (!expenseId) {
      setError("Unable to identify this expense.");
      return;
    }

    let reason = "";

    if (action === "reject") {
      const enteredReason = window.prompt(
        "Enter the reason for rejecting this expense:"
      );

      if (enteredReason === null) return;

      reason = enteredReason.trim();

      if (reason.length < 3) {
        setError(
          "Please enter a rejection reason of at least 3 characters."
        );
        return;
      }

      if (reason.length > 500) {
        setError(
          "The rejection reason cannot exceed 500 characters."
        );
        return;
      }
    }

    const confirmed = window.confirm(
      action === "approve"
        ? `Approve "${expense.description || "this expense"}" for ${money(
            expense.amount
          )}?`
        : `Reject "${expense.description || "this expense"}"?`
    );

    if (!confirmed) return;

    setProcessingId(expenseId);
    setError("");
    setNotice("");

    try {
      const endpoint =
        action === "approve"
          ? `/budgets/expenses/${encodeURIComponent(
              expenseId
            )}/approve`
          : `/budgets/expenses/${encodeURIComponent(
              expenseId
            )}/reject`;

      await apiRequest(endpoint, {
        method: "POST",

        ...(action === "reject"
          ? {
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ reason }),
            }
          : {}),
      });

      setNotice(
        action === "approve"
          ? "Expense approved successfully."
          : "Expense rejected successfully."
      );

      await loadApprovals(true);
    } catch (err) {
      setError(
        err?.message ||
        `Unable to ${action} this expense.`
      );
    } finally {
      setProcessingId("");
    }
  };

  if (!isAdmin(user)) {
    return (
      <section className="dashboard-panel">
        <div className="dashboard-empty-state">
          <ShieldCheck size={30} />

          <h3>Admin access required</h3>

          <p>
            Only administrators can review and approve
            event expenses.
          </p>
        </div>
      </section>
    );
  }

  const totalPending = approvals.reduce(
    (sum, expense) =>
      sum + (Number(expense.amount) || 0),
    0
  );

  return (
    <div className="dashboard-approvals-page">
      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">
            ADMINISTRATION
          </p>

          <h2>Expense Approvals</h2>

          <p>
            Review pending event expenses and record
            approval decisions.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={() => loadApprovals(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            size={16}
            className={
              loading || refreshing
                ? "dashboard-spinning"
                : ""
            }
          />
          Refresh
        </button>
      </section>

      {error && (
        <div className="dashboard-alert" role="alert">
          <AlertCircle size={18} />

          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div
          className="dashboard-alert dashboard-approval-success"
          role="status"
        >
          <CheckCircle2 size={18} />

          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice("")}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="dashboard-stat-grid">
        <StatCard
          icon={Clock3}
          label="Pending expenses"
          value={loading ? "…" : approvals.length}
          helper="Awaiting administrator review"
        />

        <StatCard
          icon={IndianRupee}
          label="Pending amount"
          value={loading ? "…" : money(totalPending)}
          helper="Total value awaiting review"
        />
      </div>

      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Pending expense requests</h2>

            <p>
              Approve valid expenses or reject them
              with a reason.
            </p>
          </div>

          <ShieldCheck size={22} />
        </div>

        {loading ? (
          <div className="dashboard-empty-state">
            <LoaderCircle
              size={24}
              className="dashboard-spinning"
            />

            <p>Loading pending expenses...</p>
          </div>
        ) : approvals.length === 0 ? (
          <div className="dashboard-empty-state">
            <CheckCircle2 size={30} />

            <h3>No pending approvals</h3>

            <p>
              All currently retrieved event expenses
              have been reviewed.
            </p>
          </div>
        ) : (
          <div className="dashboard-approval-list">
            {approvals.map((expense, index) => {
              const expenseId = String(
                expense.id ??
                expense._id ??
                index
              );

              const busy = processingId === expenseId;

              return (
                <article
                  className="dashboard-approval-card"
                  key={expenseId}
                >
                  <div className="dashboard-approval-main">
                    <div className="dashboard-approval-heading">
                      <div>
                        <span className="dashboard-eyebrow">
                          {expense.event_name || "Event"}
                        </span>

                        <h3>
                          {expense.description ||
                            "Unnamed expense"}
                        </h3>
                      </div>

                      <StatusBadge status="Pending" />
                    </div>

                    <div className="dashboard-approval-details">
                      <span>
                        <IndianRupee size={14} />
                        {money(expense.amount)}
                      </span>

                      <span>
                        <Package size={14} />
                        {expense.category ||
                          "Uncategorized"}
                      </span>

                      <span>
                        <CalendarDays size={14} />
                        Expense date:{" "}
                        {formatDate(expense.expense_date)}
                      </span>

                      <span>
                        <Clock3 size={14} />
                        Event date:{" "}
                        {formatDate(expense.event_date)}
                      </span>
                    </div>

                    {expense.linked_item_name && (
                      <p className="dashboard-approval-linked">
                        Linked item:{" "}
                        {expense.linked_item_type || "Item"}
                        {" — "}
                        {expense.linked_item_name}
                      </p>
                    )}

                    {expense.notes && (
                      <p className="dashboard-approval-notes">
                        {expense.notes}
                      </p>
                    )}

                    <p className="dashboard-approval-requester">
                      Requested by:{" "}
                      {expense.requested_by_name ||
                        expense.requested_by ||
                        "Not specified"}
                    </p>
                  </div>

                  <div className="dashboard-approval-actions">
                    <button
                      type="button"
                      className="dashboard-approve-button"
                      disabled={Boolean(processingId)}
                      onClick={() =>
                        processApproval(expense, "approve")
                      }
                    >
                      {busy ? (
                        <LoaderCircle
                          size={15}
                          className="dashboard-spinning"
                        />
                      ) : (
                        <CheckCircle2 size={15} />
                      )}

                      Approve
                    </button>

                    <button
                      type="button"
                      className="dashboard-reject-button"
                      disabled={Boolean(processingId)}
                      onClick={() =>
                        processApproval(expense, "reject")
                      }
                    >
                      <XCircle size={15} />
                      Reject
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* =======================================================
   DASHBOARD OVERVIEW
======================================================= */

function DashboardOverview({
  user,
  events,
  venues,
  loading,
  error,
  onRefresh,
  onNavigate,
}) {
  const upcomingEvents = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return events
      .filter((event) => {
        const date = getEventDate(event);
        const status = String(
          getStatus(event)
        ).toLowerCase();

        return (
          date &&
          date >= todayStart &&
          !status.includes("cancel") &&
          !status.includes("complete")
        );
      })
      .sort(
        (a, b) =>
          getEventDate(a) - getEventDate(b)
      );
  }, [events]);

  const attendeeCount = useMemo(() => {
    return events.reduce((total, event) => {
      const count =
        event?.attendee_count ??
        event?.attendees_count ??
        event?.registered_attendees ??
        event?.attendees?.length;

      const number = Number(count);

      return (
        total +
        (Number.isFinite(number) ? number : 0)
      );
    }, 0);
  }, [events]);

  const nextEvent = upcomingEvents[0];

  const modules = [
    { label: "Events", icon: CalendarDays },
    { label: "Venues", icon: DoorOpen },
    { label: "Resources", icon: Package },
    { label: "Scheduling", icon: CalendarPlus },
    { label: "Attendance", icon: Users },
    { label: "Budget", icon: Wallet },
    { label: "Vendors", icon: Building2 },
    { label: "Sponsorships", icon: Handshake },

    ...(isAdmin(user)
      ? [{ label: "Approvals", icon: ShieldCheck }]
      : []),
  ];

  return (
    <>
      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">
            EVENT MANAGEMENT WORKSPACE
          </p>

          <h2>
            {getGreeting()}
            {getUserName(user)
              ? `, ${getUserName(user)}`
              : ""}
            !
          </h2>

          <p>
            Manage your events, venues, attendance,
            and scheduling from one workspace.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-primary-button"
          onClick={() => onNavigate("Events")}
        >
          <Plus size={18} />
          Manage events
        </button>
      </section>

      {error && (
        <div className="dashboard-alert" role="alert">
          <AlertCircle size={18} />

          <span>{error}</span>

          <button
            type="button"
            onClick={onRefresh}
          >
            Retry
          </button>
        </div>
      )}

      <div className="dashboard-section-heading">
        <div>
          <h2>Overview</h2>
          <p>Statistics calculated from your API data.</p>
        </div>

        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            size={16}
            className={
              loading ? "dashboard-spinning" : ""
            }
          />
          Refresh
        </button>
      </div>

      <section className="dashboard-stat-grid">
        <StatCard
          icon={CalendarDays}
          label="Events"
          value={loading ? "…" : events.length}
          helper="Records returned by the API"
          onClick={() => onNavigate("Events")}
        />

        <StatCard
          icon={DoorOpen}
          label="Venues"
          value={loading ? "…" : venues.length}
          helper="Registered venue records"
          onClick={() => onNavigate("Venues")}
        />

        <StatCard
          icon={CalendarPlus}
          label="Upcoming events"
          value={
            loading ? "…" : upcomingEvents.length
          }
          helper="Future non-cancelled events"
          onClick={() => onNavigate("Scheduling")}
        />

        <StatCard
          icon={Users}
          label="Attendees"
          value={loading ? "…" : attendeeCount}
          helper="Based on attendee fields in event data"
          onClick={() => onNavigate("Attendance")}
        />
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Upcoming events</h2>
              <p>Sorted by event date.</p>
            </div>

            <button
              type="button"
              className="dashboard-text-button"
              onClick={() => onNavigate("Events")}
            >
              View all <ChevronRight size={16} />
            </button>
          </div>

          {loading ? (
            <p className="dashboard-empty-state">
              Loading events…
            </p>
          ) : upcomingEvents.length === 0 ? (
            <div className="dashboard-empty-state">
              <CalendarDays size={28} />

              <h3>No upcoming events</h3>

              <p>
                Events will appear here when the API
                returns scheduled future events.
              </p>
            </div>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Venue</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {upcomingEvents
                    .slice(0, 6)
                    .map((event, index) => (
                      <tr
                        key={
                          event?.id ??
                          event?.event_id ??
                          event?._id ??
                          `${getEventName(event)}-${index}`
                        }
                      >
                        <td>
                          <strong>
                            {getEventName(event)}
                          </strong>

                          <span className="dashboard-subtext">
                            {event?.category ??
                              event?.event_type ??
                              ""}
                          </span>
                        </td>

                        <td>
                          {formatDate(
                            getEventDate(event)
                          )}

                          <span className="dashboard-subtext">
                            {formatTime(
                              event?.time ??
                              event?.start_time
                            )}
                          </span>
                        </td>

                        <td>
                          {getVenueName(event, venues)}
                        </td>

                        <td>
                          <StatusBadge
                            status={getStatus(event)}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <MiniCalendar
          events={events}
          onSelectDate={() => onNavigate("Scheduling")}
        />
      </div>

      <div className="dashboard-secondary-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Next event</h2>
              <p>Your nearest upcoming event.</p>
            </div>

            <Clock3 size={20} />
          </div>

          {nextEvent ? (
            <div className="dashboard-next-event">
              <strong>
                {getEventName(nextEvent)}
              </strong>

              <p>
                <CalendarDays size={16} />
                {formatDate(
                  getEventDate(nextEvent)
                )}
              </p>

              <p>
                <Clock3 size={16} />
                {formatTime(
                  nextEvent?.time ??
                  nextEvent?.start_time
                )}
              </p>

              <p>
                <MapPin size={16} />
                {getVenueName(nextEvent, venues)}
              </p>

              <StatusBadge
                status={getStatus(nextEvent)}
              />
            </div>
          ) : (
            <p className="dashboard-empty-state">
              No upcoming event data is available.
            </p>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Workspace modules</h2>
              <p>Open a module to manage its records.</p>
            </div>

            <Activity size={20} />
          </div>

          <div className="dashboard-module-list">
            {modules.map(({ label, icon: Icon }) => (
              <button
                type="button"
                key={label}
                onClick={() => onNavigate(label)}
              >
                <Icon size={18} />

                <strong>{label}</strong>

                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="dashboard-footer">
        <span>{new Date().getFullYear()}</span>

        <span>
          Dashboard values are calculated from API responses.
        </span>
      </footer>
    </>
  );
}

/* =======================================================
   MAIN DASHBOARD
======================================================= */

export default function Dashboard({
  user: userProp,
  onLogout,
}) {
  const [user, setUser] = useState(() => {
    if (userProp) return userProp;

    try {
      return JSON.parse(
        localStorage.getItem("user") || "null"
      );
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState("Dashboard");

  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* Keep user state synchronized with Auth.jsx */

  useEffect(() => {
    if (userProp !== undefined) {
      setUser(userProp);
    }
  }, [userProp]);

  /* Load dashboard data */

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError("");

    const [eventsResult, venuesResult] =
      await Promise.allSettled([
        getEvents(),
        getVenues(),
      ]);

    if (eventsResult.status === "fulfilled") {
      setEvents(
        toArray(eventsResult.value, [
          "events",
          "items",
        ])
      );
    } else {
      setEvents([]);
    }

    if (venuesResult.status === "fulfilled") {
      setVenues(
        toArray(venuesResult.value, [
          "venues",
          "items",
        ])
      );
    } else {
      setVenues([]);
    }

    const errors = [];

    if (eventsResult.status === "rejected") {
      errors.push(
        eventsResult.reason?.message ||
        "Unable to load events."
      );
    }

    if (venuesResult.status === "rejected") {
      errors.push(
        venuesResult.reason?.message ||
        "Unable to load venues."
      );
    }

    if (errors.length > 0) {
      setError(errors.join(" "));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  /* Navigation */

  const handleNavigate = useCallback((page) => {
    setActivePage(page);
  }, []);

  /* Logout */

  const handleLogout = useCallback(async () => {
    if (typeof onLogout === "function") {
      await onLogout();
      return;
    }

    try {
      await logoutUser();
    } catch {
      // Local credentials are cleared below regardless.
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

  /* Active page */

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
      pageContent = (
        <ExpenseApprovals user={user} />
      );
      break;

    default:
      pageContent = (
        <DashboardOverview
          user={user}
          events={events}
          venues={venues}
          loading={loading}
          error={error}
          onRefresh={loadDashboardData}
          onNavigate={handleNavigate}
        />
      );
  }

  /* Main layout */

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
            <NotificationCenter />

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
              {(
                getUserName(user).trim().charAt(0) || "U"
              ).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="dashboard-content">
          {pageContent}
        </div>
      </main>
    </div>
  );
}