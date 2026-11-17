
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Mail,
  RefreshCw,
  Trash2,
  X,
  Inbox,
  ShieldCheck,
} from "lucide-react";

import * as api from "./api";
import "./Notifications.css";

const {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  getEvents,
} = api;

const POLLING_INTERVAL = 10000;
const RECENT_PREVIEW_COUNT = 5;
const APPROVAL_PREVIEW_COUNT = 5;

// ---------------------------------------------------------
// RESPONSE HELPERS
// ---------------------------------------------------------

function getArray(response, keys = []) {
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

  return [];
}

function getId(item) {
  const id = item?.id ?? item?._id ?? item?.event_id;
  return id == null ? "" : String(id);
}

function getNotificationId(item) {
  const id = item?.id ?? item?._id;
  return id == null ? "" : String(id);
}

function getNotificationDate(notification) {
  const value =
    notification?.created_at ??
    notification?.timestamp ??
    notification?.date;

  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return "Date unavailable";

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(date) {
  if (!date) return "";

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function getEventName(event) {
  return (
    event?.name ??
    event?.title ??
    event?.event_name ??
    "Untitled event"
  );
}

// ---------------------------------------------------------
// NOTIFICATION CLASSIFICATION
// ---------------------------------------------------------

function getNotificationText(notification) {
  return `${notification?.title ?? ""} ${
    notification?.message ?? ""
  }`.toLowerCase();
}

function getCategory(notification) {
  const category = String(
    notification?.category ?? notification?.type ?? ""
  ).toLowerCase();

  const content = getNotificationText(notification);

  if (
    category.includes("approval") ||
    content.includes("approval")
  ) {
    return "Approval";
  }

  if (
    category.includes("event") ||
    category.includes("reminder") ||
    content.includes("reminder")
  ) {
    return "Event";
  }

  if (
    category.includes("registration") ||
    content.includes("registration") ||
    content.includes("registered")
  ) {
    return "Registration";
  }

  if (
    category.includes("ticket") ||
    content.includes("ticket")
  ) {
    return "Ticket";
  }

  if (
    category.includes("budget") ||
    content.includes("expense")
  ) {
    return "Budget";
  }

  return "General";
}

function getTone(notification) {
  const type = String(
    notification?.notification_type ?? notification?.type ?? ""
  ).toLowerCase();

  const content = getNotificationText(notification);

  if (
    type.includes("error") ||
    type.includes("danger") ||
    content.includes("rejected") ||
    content.includes("failed")
  ) {
    return "danger";
  }

  if (
    type.includes("warning") ||
    content.includes("cancelled") ||
    content.includes("canceled")
  ) {
    return "warning";
  }

  if (
    type.includes("success") ||
    content.includes("successfully") ||
    content.includes("approved")
  ) {
    return "success";
  }

  return "info";
}

// ---------------------------------------------------------
// APPROVAL NOTIFICATION HELPERS
// ---------------------------------------------------------

function getApprovalRow(notification) {
  const content = getNotificationText(notification);

  const raw = `${notification?.title ?? ""} ${
    notification?.message ?? ""
  }`;

  // Extract an item name enclosed in quotation marks.
  const quoted = raw.match(/['"“‘]([^'"”’]+)['"”’]/);

  const item =
    notification?.item ??
    notification?.expense_name ??
    notification?.metadata?.item ??
    (quoted ? quoted[1] : notification?.title || "Approval request");

  const amount =
    notification?.amount ??
    notification?.expense_amount ??
    notification?.metadata?.amount ??
    notification?.data?.amount;

  let status = "Pending";

  if (content.includes("rejected")) {
    status = "Rejected";
  } else if (content.includes("approved")) {
    status = "Approved";
  }

  return {
    id: getNotificationId(notification),
    item,
    amount,
    status,
    date: getNotificationDate(notification),
  };
}

// ---------------------------------------------------------
// FORMATTING
// ---------------------------------------------------------

function formatMoney(value) {
  if (value == null || value === "") return "—";

  const amount = Number(value);

  if (!Number.isFinite(amount)) return "—";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getNotificationList(response) {
  return getArray(response, ["notifications", "items"]);
}

// ---------------------------------------------------------
// MAIN NOTIFICATIONS PAGE
// ---------------------------------------------------------

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("all");

  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showAllApprovals, setShowAllApprovals] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [processingId, setProcessingId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const mountedRef = useRef(false);
  const requestInProgress = useRef(false);

  // -------------------------------------------------------
  // LOAD NOTIFICATIONS
  // -------------------------------------------------------

  const loadData = useCallback(async (showRefreshing = false) => {
    if (requestInProgress.current) return;

    requestInProgress.current = true;

    if (showRefreshing && mountedRef.current) {
      setRefreshing(true);
    }

    try {
      const [
        notificationResponse,
        countResponse,
        eventsResponse,
      ] = await Promise.all([
        getNotifications({ limit: 100, skip: 0 }),
        getUnreadNotificationCount(),
        typeof getEvents === "function"
          ? getEvents().catch(() => [])
          : Promise.resolve([]),
      ]);

      if (!mountedRef.current) return;

      const items = getNotificationList(notificationResponse);

      const unreadFromResponse =
        countResponse?.unread_count ??
        countResponse?.data?.unread_count ??
        countResponse?.count;

      const unreadFromItems = items.filter(
        (item) => !item?.is_read
      ).length;

      const sortedItems = [...items].sort((a, b) => {
        const dateA =
          getNotificationDate(a)?.getTime() ?? 0;

        const dateB =
          getNotificationDate(b)?.getTime() ?? 0;

        return dateB - dateA;
      });

      setNotifications(sortedItems);

      setUnreadCount(
        Math.max(
          0,
          Number(unreadFromResponse ?? unreadFromItems) || 0
        )
      );

      setEvents(
        getArray(eventsResponse, ["events", "items"])
      );

      setError("");
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err?.message || "Unable to load notifications."
        );
      }
    } finally {
      requestInProgress.current = false;

      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // -------------------------------------------------------
  // INITIAL LOAD + AUTOMATIC POLLING
  // -------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    loadData();

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        loadData();
      }
    }, POLLING_INTERVAL);

    const handleVisibility = () => {
      if (!document.hidden) {
        loadData();
      }
    };

    window.addEventListener("focus", handleVisibility);

    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    return () => {
      mountedRef.current = false;

      window.clearInterval(intervalId);

      window.removeEventListener(
        "focus",
        handleVisibility
      );

      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, [loadData]);

  // -------------------------------------------------------
  // EVENT FILTERING
  // -------------------------------------------------------

  const scopedNotifications = useMemo(() => {
    if (selectedEventId === "all") {
      return notifications;
    }

    return notifications.filter((notification) => {
      const relatedId =
        notification?.event_id ??
        notification?.related_id ??
        notification?.metadata?.event_id ??
        notification?.data?.event_id;

      // Keep general notifications visible when an event
      // filter is selected.
      if (relatedId == null) return true;

      return String(relatedId) === selectedEventId;
    });
  }, [notifications, selectedEventId]);

  // -------------------------------------------------------
  // APPROVAL NOTIFICATIONS
  // -------------------------------------------------------

  const approvalRows = useMemo(
    () =>
      scopedNotifications
        .filter(
          (item) => getCategory(item) === "Approval"
        )
        .map(getApprovalRow),
    [scopedNotifications]
  );

  const visibleApprovalRows = showAllApprovals
    ? approvalRows
    : approvalRows.slice(0, APPROVAL_PREVIEW_COUNT);

  // -------------------------------------------------------
  // RECENT NOTIFICATIONS
  // -------------------------------------------------------

  const visibleRecent = showAllRecent
    ? scopedNotifications
    : scopedNotifications.slice(0, RECENT_PREVIEW_COUNT);

  // -------------------------------------------------------
  // SUMMARY STATISTICS
  // -------------------------------------------------------

  const stats = useMemo(() => {
    const eventReminders = scopedNotifications.filter(
      (item) => getCategory(item) === "Event"
    ).length;

    const approvalAlerts = scopedNotifications.filter(
      (item) => getCategory(item) === "Approval"
    ).length;

    return {
      total: scopedNotifications.length,

      unread: scopedNotifications.filter(
        (item) => !item?.is_read
      ).length,

      eventReminders,
      approvalAlerts,
    };
  }, [scopedNotifications]);

  // -------------------------------------------------------
  // MARK SINGLE NOTIFICATION AS READ
  // -------------------------------------------------------

  async function handleMarkRead(notification) {
    const id = getNotificationId(notification);

    if (!id || notification?.is_read || processingId) {
      return;
    }

    setProcessingId(id);
    setError("");
    setSuccessMessage("");

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

      setUnreadCount((previous) =>
        Math.max(0, previous - 1)
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to mark notification as read."
      );
    } finally {
      if (mountedRef.current) {
        setProcessingId("");
      }
    }
  }

  // -------------------------------------------------------
  // MARK ALL NOTIFICATIONS AS READ
  // -------------------------------------------------------

  async function handleMarkAllRead() {
    if (unreadCount === 0 || markingAll) return;

    setMarkingAll(true);
    setError("");
    setSuccessMessage("");

    try {
      await markAllNotificationsRead();

      if (!mountedRef.current) return;

      setNotifications((previous) =>
        previous.map((item) => ({
          ...item,
          is_read: true,
        }))
      );

      setUnreadCount(0);

      setSuccessMessage(
        "All notifications marked as read."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to mark all notifications as read."
      );
    } finally {
      if (mountedRef.current) {
        setMarkingAll(false);
      }
    }
  }

  // -------------------------------------------------------
  // DELETE NOTIFICATION
  // -------------------------------------------------------

  async function handleDelete(notification) {
    const id = getNotificationId(notification);

    if (!id || processingId) return;

    const confirmed = window.confirm(
      "Delete this notification? This cannot be undone."
    );

    if (!confirmed) return;

    setProcessingId(id);
    setError("");
    setSuccessMessage("");

    try {
      await deleteNotification(id);

      if (!mountedRef.current) return;

      setNotifications((previous) =>
        previous.filter(
          (item) => getNotificationId(item) !== id
        )
      );

      if (!notification?.is_read) {
        setUnreadCount((previous) =>
          Math.max(0, previous - 1)
        );
      }

      setSuccessMessage(
        "Notification deleted successfully."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to delete notification."
      );
    } finally {
      if (mountedRef.current) {
        setProcessingId("");
      }
    }
  }

  // -------------------------------------------------------
  // NOTIFICATION TONE ICON
  // -------------------------------------------------------

  function renderToneIcon(tone) {
    if (tone === "success") {
      return <Check size={17} />;
    }

    if (tone === "danger") {
      return <CircleAlert size={17} />;
    }

    if (tone === "warning") {
      return <Clock3 size={17} />;
    }

    return <Bell size={17} />;
  }

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------

  return (
    <section className="notifications-page">

      {/* PAGE HEADER */}
      <header className="notifications-page-header">
        <div className="notifications-header-title">
          <span
            className="notifications-header-icon"
            aria-hidden="true"
          >
            <Bell size={25} strokeWidth={1.8} />
          </span>

          <div>
            <p className="notifications-eyebrow">
              WORKFLOW AUTOMATION
            </p>

            <h2>Notifications</h2>

            <p>
              Event updates, reminders and approval notifications
            </p>
          </div>
        </div>

        <div className="notifications-header-actions">
          <select
            className="notifications-event-select"
            value={selectedEventId}
            onChange={(event) =>
              setSelectedEventId(event.target.value)
            }
            aria-label="Filter notifications by event"
          >
            <option value="all">All events</option>

            {events.map((event, index) => {
              const id = getId(event);

              return (
                <option
                  value={id}
                  key={id || `event-${index}`}
                >
                  {getEventName(event)}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            className="notifications-secondary-button"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={15}
              className={refreshing ? "is-spinning" : ""}
            />

            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          <button
            type="button"
            className="notifications-primary-button"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0 || markingAll}
          >
            <CheckCheck size={16} />

            {markingAll
              ? "Marking..."
              : `Mark all read (${unreadCount})`}
          </button>
        </div>
      </header>

      {/* ERROR MESSAGE */}
      {error && (
        <div
          className="notifications-alert notifications-alert-error"
          role="alert"
        >
          <CircleAlert size={17} />

          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* SUCCESS MESSAGE */}
      {successMessage && (
        <div
          className="notifications-alert notifications-alert-success"
          role="status"
        >
          <CheckCircleIcon />

          <span>{successMessage}</span>

          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            aria-label="Dismiss message"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <section className="notifications-summary-grid">

        <article className="notifications-summary-card summary-emails">
          <span className="notifications-summary-icon">
            <Inbox size={21} />
          </span>

          <div>
            <span>Total Notifications</span>

            <strong>
              {loading ? "—" : stats.total}
            </strong>
          </div>
        </article>

        <article className="notifications-summary-card summary-reminders">
          <span className="notifications-summary-icon">
            <Bell size={21} />
          </span>

          <div>
            <span>Unread Notifications</span>

            <strong>
              {loading ? "—" : stats.unread}
            </strong>
          </div>
        </article>

        <article className="notifications-summary-card summary-approvals">
          <span className="notifications-summary-icon">
            <ShieldCheck size={21} />
          </span>

          <div>
            <span>Approval Alerts</span>

            <strong>
              {loading ? "—" : stats.approvalAlerts}
            </strong>
          </div>
        </article>

      </section>

      {/* MAIN CONTENT */}
      <div className="notifications-layout">

        {/* EVENT UPDATES */}
        <section className="notifications-panel notifications-reminders-panel">

          <div className="notifications-panel-header">
            <h3>
              <CalendarDays size={18} />
              Event Updates
            </h3>
          </div>

          <div className="notifications-panel-body">

            <div className="notifications-next-reminder">
              <span aria-hidden="true">
                <Bell size={19} />
              </span>

              <p>
                Event reminders are generated automatically
                by the reminder scheduler. New reminders will
                appear here when the backend creates them.
              </p>
            </div>

            <div className="notifications-reminder-active">
              <span className="notifications-reminder-illustration">
                <Mail size={28} />
              </span>

              <h4>
                {stats.eventReminders > 0
                  ? "Event updates are available"
                  : "You're up to date"}
              </h4>

              <p>
                {stats.eventReminders > 0
                  ? `${stats.eventReminders} event reminder notification(s) found.`
                  : "Event reminders and updates will appear here when generated."}
              </p>
            </div>

          </div>
        </section>

        {/* RIGHT COLUMN */}
        <div className="notifications-right-column">

          {/* APPROVAL NOTIFICATIONS */}
          <section className="notifications-panel">

            <div className="notifications-panel-header">
              <h3>
                <ShieldCheck size={18} />
                Approval Notifications
              </h3>

              {approvalRows.length > APPROVAL_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="notifications-view-all"
                  onClick={() =>
                    setShowAllApprovals((value) => !value)
                  }
                >
                  {showAllApprovals ? "Show less" : "View All"} →
                </button>
              )}
            </div>

            {loading ? (
              <div className="notifications-empty">
                Loading approvals...
              </div>
            ) : approvalRows.length === 0 ? (
              <div className="notifications-empty">
                <Inbox size={22} />
                <span>No approval notifications yet.</span>
              </div>
            ) : (
              <div className="notifications-table-wrap">

                <table className="notifications-table">
                  <thead>
                    <tr>
                      <th>Expense Item</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action Date</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleApprovalRows.map((row, index) => (
                      <tr
                        key={row.id || `approval-${index}`}
                      >
                        <td>{row.item}</td>

                        <td>
                          {formatMoney(row.amount)}
                        </td>

                        <td>
                          <span
                            className={`notifications-status status-${row.status.toLowerCase()}`}
                          >
                            {row.status}
                          </span>
                        </td>

                        <td>{formatDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

              </div>
            )}

          </section>

          {/* RECENT NOTIFICATIONS */}
          <section className="notifications-panel">

            <div className="notifications-panel-header">
              <h3>
                <Bell size={18} />
                Recent Notifications
              </h3>

              {scopedNotifications.length > RECENT_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="notifications-view-all"
                  onClick={() =>
                    setShowAllRecent((value) => !value)
                  }
                >
                  {showAllRecent ? "Show less" : "View All"} →
                </button>
              )}
            </div>

            {loading ? (
              <div className="notifications-empty">
                Loading notifications...
              </div>
            ) : visibleRecent.length === 0 ? (
              <div className="notifications-empty">
                <Inbox size={22} />
                <span>No notifications found.</span>
              </div>
            ) : (
              <ul
                className={`notifications-recent-list ${
                  showAllRecent ? "is-expanded" : ""
                }`}
              >
                {visibleRecent.map((notification, index) => {
                  const id =
                    getNotificationId(notification) ||
                    `notification-${index}`;

                  const tone = getTone(notification);
                  const isRead = Boolean(notification?.is_read);
                  const busy = processingId === id;
                  const createdAt =
                    getNotificationDate(notification);

                  return (
                    <li
                      key={id}
                      className={`notifications-recent-item ${
                        isRead ? "is-read" : "is-unread"
                      }`}
                    >
                      <span
                        className={`notifications-recent-icon tone-${tone}`}
                        aria-hidden="true"
                      >
                        {renderToneIcon(tone)}
                      </span>

                      <button
                        type="button"
                        className="notifications-recent-text"
                        onClick={() =>
                          handleMarkRead(notification)
                        }
                        disabled={busy || isRead}
                        title={
                          isRead
                            ? "Already read"
                            : "Mark as read"
                        }
                      >
                        {notification?.title &&
                        notification?.message ? (
                          <>
                            <strong>
                              {notification.title}:{" "}
                            </strong>

                            {notification.message}
                          </>
                        ) : (
                          notification?.message ||
                          notification?.title ||
                          "You have a new update."
                        )}

                        {!isRead && (
                          <span className="notifications-unread-label">
                            Unread
                          </span>
                        )}
                      </button>

                      <span className="notifications-recent-date">
                        {formatDate(createdAt)}

                        {createdAt
                          ? ` · ${formatTime(createdAt)}`
                          : ""}
                      </span>

                      <button
                        type="button"
                        className="notifications-recent-delete"
                        onClick={() =>
                          handleDelete(notification)
                        }
                        disabled={busy}
                        aria-label="Delete notification"
                        title="Delete notification"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

          </section>
        </div>
      </div>

      {/* FOOTER */}
      <p className="notifications-footer-note">
        <Clock3 size={14} />

        Notifications refresh automatically every 10 seconds
        while this page is open. Select an unread notification
        to mark it as read.
      </p>

    </section>
  );
}

// ---------------------------------------------------------
// SUCCESS ICON
// ---------------------------------------------------------

function CheckCircleIcon() {
  return (
    <Check size={17} aria-hidden="true" />
  );
}
