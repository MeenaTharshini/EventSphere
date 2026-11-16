
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock3,
  Wallet,
  Building2,
  UserRound,
  Tag,
  Link2,
  FileText,
  ShieldCheck,
  AlertCircle,
  ArrowUpRight,
  Inbox,
} from "lucide-react";

import { apiRequest, getEvents } from "./api";
import "./Approvals.css";

/* --------------------------------------------------
   CONSTANTS
-------------------------------------------------- */

const STATUSES = ["All", "Pending", "Approved", "Paid", "Rejected"];

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */

function formatMoney(value) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getId(item) {
  return String(item?.id ?? item?._id ?? item?.expense_id ?? "");
}

function getEventId(event) {
  return String(
    event?.id ??
    event?._id ??
    event?.event_id ??
    ""
  );
}

function normalizeStatus(status) {
  const value = String(status || "Pending").trim().toLowerCase();

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusClass(status) {
  return normalizeStatus(status).toLowerCase().replace(/\s+/g, "-");
}

function formatDate(value) {
  if (!value) return "Not available";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function getErrorMessage(error) {
  const detail =
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    error?.detail ??
    error?.message;

  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || item.message || "").filter(Boolean).join(", ");
  }

  return detail || "Something went wrong. Please try again.";
}

function getReview(expense) {
  const approval = expense?.approval || {};

  return {
    reviewer:
      approval.reviewed_by_name ||
      approval.reviewer_name ||
      "",
    reviewedAt:
      approval.reviewed_at ||
      "",
    reason:
      approval.rejection_reason ||
      "",
  };
}

function getEventName(event) {
  return (
    event?.name ||
    event?.event_name ||
    event?.eventName ||
    event?.title ||
    "Unknown event"
  );
}

function getEventDate(event) {
  return (
    event?.event_date ||
    event?.date ||
    event?.start_date ||
    ""
  );
}

function getEventsArray(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.events)) return response.events;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.events)) return response.data.events;
  if (Array.isArray(response?.results)) return response.results;

  return [];
}

function getExpensesArray(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.expenses)) return response.expenses;
  if (Array.isArray(response?.data?.expenses)) return response.data.expenses;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.approvals)) return response.approvals;

  return [];
}

function getUpdatedExpense(response) {
  return (
    response?.expense ||
    response?.data?.expense ||
    null
  );
}

/* --------------------------------------------------
   MAIN COMPONENT
-------------------------------------------------- */

export default function Approvals({ user }) {
  const role = String(
    user?.activeRole ??
    user?.role ??
    user?.user_role ??
    user?.user?.role ??
    ""
  )
    .trim()
    .toLowerCase();

  const isAdmin = ["admin", "administrator"].includes(role);

  const [expenses, setExpenses] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /* --------------------------------------------------
     LOAD EXPENSES FROM ALL EVENTS

     Backend routes used:
     GET /events
     GET /budgets/event/{event_id}

     There is no dependency on a separate
     GET /budgets/approvals endpoint.
  -------------------------------------------------- */

  const loadApprovals = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");
    setSuccess("");

    try {
      const eventsResponse = await getEvents();
      const events = getEventsArray(eventsResponse);

      if (events.length === 0) {
        setExpenses([]);
        setSelectedId("");
        return;
      }

      const results = await Promise.allSettled(
        events.map(async (event) => {
          const eventId = getEventId(event);

          if (!eventId) {
            return [];
          }

          const budgetResponse = await apiRequest(
            `/budgets/event/${encodeURIComponent(eventId)}`
          );

          const eventExpenses = getExpensesArray(budgetResponse);

          return eventExpenses.map((expense) => ({
            ...expense,
            event_id: expense.event_id || eventId,
            event_name:
              expense.event_name ||
              budgetResponse?.event?.name ||
              budgetResponse?.event?.event_name ||
              budgetResponse?.data?.event?.name ||
              getEventName(event),
            event_date:
              expense.event_date ||
              budgetResponse?.event?.event_date ||
              budgetResponse?.event?.date ||
              budgetResponse?.data?.event?.event_date ||
              getEventDate(event),
            status: normalizeStatus(expense.status),
          }));
        })
      );

      const successfulResults = results
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value);

      const failedRequests = results.filter(
        (result) => result.status === "rejected"
      );

      // Remove records without an identifiable expense ID.
      const validExpenses = successfulResults.filter(
        (expense) => getId(expense)
      );

      // Sort newest requests first.
      validExpenses.sort((a, b) => {
        const dateA = new Date(
          a.created_at || a.expense_date || 0
        ).getTime();

        const dateB = new Date(
          b.created_at || b.expense_date || 0
        ).getTime();

        return dateB - dateA;
      });

      setExpenses(validExpenses);

      setSelectedId((currentId) => {
        if (
          currentId &&
          validExpenses.some((item) => getId(item) === currentId)
        ) {
          return currentId;
        }

        const firstPending = validExpenses.find(
          (item) => normalizeStatus(item.status) === "Pending"
        );

        return getId(firstPending || validExpenses[0]) || "";
      });

      if (failedRequests.length > 0) {
        if (validExpenses.length > 0) {
          setError(
            `Some event expense records could not be loaded (${failedRequests.length} of ${events.length}). The available records are displayed.`
          );
        } else {
          setError(
            "Unable to load expense requests from the events. Please check the backend and try again."
          );
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setExpenses([]);
      setSelectedId("");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /* --------------------------------------------------
     INITIAL LOAD
  -------------------------------------------------- */

  useEffect(() => {
    if (isAdmin) {
      loadApprovals();
    } else {
      setLoading(false);
    }
  }, [isAdmin, loadApprovals]);

  /* --------------------------------------------------
     SUMMARY COUNTS
  -------------------------------------------------- */

  const counts = useMemo(() => {
    return {
      total: expenses.length,

      pending: expenses.filter(
        (item) => normalizeStatus(item.status) === "Pending"
      ).length,

      approved: expenses.filter(
        (item) => normalizeStatus(item.status) === "Approved"
      ).length,

      rejected: expenses.filter(
        (item) => normalizeStatus(item.status) === "Rejected"
      ).length,

      paid: expenses.filter(
        (item) => normalizeStatus(item.status) === "Paid"
      ).length,
    };
  }, [expenses]);

  const pendingAmount = useMemo(() => {
    return expenses
      .filter(
        (item) => normalizeStatus(item.status) === "Pending"
      )
      .reduce(
        (total, item) => total + (Number(item.amount) || 0),
        0
      );
  }, [expenses]);

  /* --------------------------------------------------
     SEARCH AND FILTER
  -------------------------------------------------- */

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();

    return expenses.filter((expense) => {
      const status = normalizeStatus(expense.status);

      const matchesStatus =
        statusFilter === "All" || status === statusFilter;

      const searchable = [
        expense.description,
        expense.category,
        expense.event_name,
        expense.event_id,
        expense.requested_by_name,
        expense.requested_by,
        expense.linked_item_name,
        expense.linked_item_type,
        getId(expense),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query || searchable.includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [expenses, search, statusFilter]);

  /* --------------------------------------------------
     SELECTED EXPENSE
  -------------------------------------------------- */

  const selectedExpense = useMemo(() => {
    return (
      filteredExpenses.find(
        (item) => getId(item) === selectedId
      ) ||
      filteredExpenses[0] ||
      null
    );
  }, [filteredExpenses, selectedId]);

  useEffect(() => {
    if (
      selectedExpense &&
      getId(selectedExpense) !== selectedId
    ) {
      setSelectedId(getId(selectedExpense));
    }
  }, [selectedExpense, selectedId]);

  /* --------------------------------------------------
     UPDATE EXPENSE LOCALLY
  -------------------------------------------------- */

  const updateExpense = useCallback(
    (id, updatedExpense, fallback = {}) => {
      setExpenses((current) =>
        current.map((item) => {
          if (getId(item) !== id) return item;

          return {
            ...item,
            ...fallback,
            ...(updatedExpense || {}),
          };
        })
      );
    },
    []
  );

  /* --------------------------------------------------
     APPROVE EXPENSE
  -------------------------------------------------- */

  const handleApprove = async (expense) => {
    const id = getId(expense);

    if (
      !id ||
      normalizeStatus(expense.status) !== "Pending" ||
      processingId
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Approve "${expense.description || "this expense"}" for ${formatMoney(expense.amount)}?`
    );

    if (!confirmed) return;

    setProcessingId(id);
    setError("");
    setSuccess("");

    try {
      const response = await apiRequest(
        `/budgets/expenses/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
        }
      );

      updateExpense(id, getUpdatedExpense(response), {
        status: "Approved",
      });

      setSuccess(
        response?.message ||
        response?.data?.message ||
        "Expense approved successfully."
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId("");
    }
  };

  /* --------------------------------------------------
     REJECT EXPENSE
  -------------------------------------------------- */

  const handleReject = async (expense) => {
    const id = getId(expense);

    if (
      !id ||
      normalizeStatus(expense.status) !== "Pending" ||
      processingId
    ) {
      return;
    }

    const reason = window.prompt(
      `Enter the reason for rejecting "${expense.description || "this expense"}":`
    );

    if (reason === null) return;

    const cleanReason = reason.trim();

    if (cleanReason.length < 3) {
      setError(
        "Please enter a rejection reason of at least 3 characters."
      );
      return;
    }

    if (cleanReason.length > 500) {
      setError(
        "The rejection reason cannot exceed 500 characters."
      );
      return;
    }

    setProcessingId(id);
    setError("");
    setSuccess("");

    try {
      const response = await apiRequest(
        `/budgets/expenses/${encodeURIComponent(id)}/reject`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: cleanReason,
          }),
        }
      );

      const updatedExpense = getUpdatedExpense(response);

      updateExpense(
        id,
        updatedExpense
          ? {
              ...updatedExpense,
              approval: {
                ...(expense.approval || {}),
                ...(updatedExpense.approval || {}),
                rejection_reason:
                  updatedExpense.approval?.rejection_reason ||
                  cleanReason,
              },
            }
          : null,
        {
          status: "Rejected",
          approval: {
            ...(expense.approval || {}),
            rejection_reason: cleanReason,
          },
        }
      );

      setSuccess(
        response?.message ||
        response?.data?.message ||
        "Expense rejected successfully."
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProcessingId("");
    }
  };

  /* --------------------------------------------------
     ACCESS CONTROL
  -------------------------------------------------- */

  if (!isAdmin) {
    return (
      <main className="approvals-page">
        <div className="approvals-access">
          <ShieldCheck size={34} />

          <h2>Administrator access required</h2>

          <p>
            Only administrators can review and decide expense requests.
          </p>
        </div>
      </main>
    );
  }

  /* --------------------------------------------------
     SELECTED REQUEST DETAILS
  -------------------------------------------------- */

  const selectedStatus = selectedExpense
    ? normalizeStatus(selectedExpense.status)
    : "";

  const selectedReview = selectedExpense
    ? getReview(selectedExpense)
    : {};

  const isProcessing =
    selectedExpense &&
    processingId === getId(selectedExpense);

  /* --------------------------------------------------
     PAGE UI
  -------------------------------------------------- */

  return (
    <main className="approvals-page">

      {/* PAGE HEADER */}

      <header className="approvals-header">
        <div>
          <div className="approvals-breadcrumb">
            Workspace <span>/</span> Finance <span>/</span> Approvals
          </div>

          <div className="approvals-title-row">
            <div>
              <h1>Expense Approvals</h1>

              <p>
                Review, verify and manage expense requests across your events.
              </p>
            </div>

            <button
              type="button"
              className="approvals-refresh"
              onClick={() => loadApprovals(true)}
              disabled={loading || refreshing}
            >
              <RefreshCw
                size={16}
                className={
                  refreshing ? "approvals-rotating" : ""
                }
              />

              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* FEEDBACK */}

      {error && (
        <div className="approvals-notice error">
          <AlertCircle size={17} />

          <span>{error}</span>

          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}

      {success && (
        <div className="approvals-notice success">
          <CheckCircle2 size={17} />

          <span>{success}</span>

          <button
            type="button"
            aria-label="Dismiss success message"
            onClick={() => setSuccess("")}
          >
            ×
          </button>
        </div>
      )}

      {/* FINANCIAL OVERVIEW */}

      <section className="approvals-overview">
        <div className="approvals-overview-heading">
          <div>
            <span className="approvals-eyebrow">
              FINANCIAL OVERVIEW
            </span>

            <h2>Approval activity</h2>
          </div>

          <div className="approvals-total-count">
            <span>{counts.total}</span>
            <small>Total requests</small>
          </div>
        </div>

        <div className="approvals-metrics">

          <div className="approvals-metric pending">
            <span className="approvals-metric-icon">
              <Clock3 size={17} />
            </span>

            <div>
              <strong>{counts.pending}</strong>
              <small>Awaiting review</small>
            </div>
          </div>

          <div className="approvals-metric approved">
            <span className="approvals-metric-icon">
              <CheckCircle2 size={17} />
            </span>

            <div>
              <strong>{counts.approved}</strong>
              <small>Approved</small>
            </div>
          </div>

          <div className="approvals-metric rejected">
            <span className="approvals-metric-icon">
              <XCircle size={17} />
            </span>

            <div>
              <strong>{counts.rejected}</strong>
              <small>Rejected</small>
            </div>
          </div>

          <div className="approvals-metric paid">
            <span className="approvals-metric-icon">
              <Wallet size={17} />
            </span>

            <div>
              <strong>{counts.paid}</strong>
              <small>Paid</small>
            </div>
          </div>

          <div className="approvals-pending-value">
            <span>Pending value</span>

            <strong>{formatMoney(pendingAmount)}</strong>

            <small>Amount awaiting decision</small>
          </div>

        </div>
      </section>

      {/* REVIEW WORKSPACE */}

      <section className="approvals-workspace">

        {/* LEFT: REQUEST QUEUE */}

        <aside className="approvals-queue">

          <div className="approvals-queue-heading">
            <div>
              <span className="approvals-eyebrow">
                INBOX
              </span>

              <h2>Request queue</h2>
            </div>

            <span className="approvals-queue-count">
              {filteredExpenses.length}
            </span>
          </div>

          {/* SEARCH */}

          <div className="approvals-search">
            <Search size={17} />

            <input
              type="search"
              placeholder="Search requests..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {/* STATUS FILTER */}

          <div className="approvals-status-select">
            <label htmlFor="approvals-status">
              Filter by status
            </label>

            <select
              id="approvals-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {/* REQUEST LIST */}

          <div className="approvals-queue-list">

            {loading ? (
              <div className="approvals-queue-message">
                <div className="approvals-spinner" />

                <span>Loading requests...</span>
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="approvals-queue-message">
                <Inbox size={27} />

                <strong>No requests found</strong>

                <span>
                  Try another search or status filter.
                </span>

                {(search || statusFilter !== "All") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("All");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              filteredExpenses.map((expense) => {
                const id = getId(expense);
                const status = normalizeStatus(expense.status);
                const active =
                  id === getId(selectedExpense);

                return (
                  <button
                    type="button"
                    key={id}
                    className={`approvals-queue-item ${active ? "active" : ""}`}
                    onClick={() => setSelectedId(id)}
                  >
                    <div className="approvals-queue-item-top">
                      <span className="approvals-queue-category">
                        {expense.category || "Expense"}
                      </span>

                      <span
                        className={`approvals-status ${statusClass(status)}`}
                      >
                        {status}
                      </span>
                    </div>

                    <strong className="approvals-queue-expense">
                      {expense.description || "Untitled expense"}
                    </strong>

                    <span className="approvals-queue-event">
                      <Building2 size={13} />

                      {expense.event_name || "Unknown event"}
                    </span>

                    <div className="approvals-queue-item-bottom">
                      <span>
                        {expense.requested_by_name || "Unknown requester"}
                      </span>

                      <strong>
                        {formatMoney(expense.amount)}
                      </strong>
                    </div>
                  </button>
                );
              })
            )}

          </div>

          <div className="approvals-queue-footer">
            Showing {filteredExpenses.length} of {expenses.length} requests
          </div>

        </aside>

        {/* RIGHT: REQUEST DETAILS */}

        <section className="approvals-detail-panel">

          {!selectedExpense ? (
            <div className="approvals-detail-empty">
              <div className="approvals-detail-empty-icon">
                <FileText size={30} />
              </div>

              <h2>Select an expense request</h2>

              <p>
                Choose a request from the queue to inspect its details
                and review its approval status.
              </p>
            </div>
          ) : (
            <>

              {/* REQUEST HEADER */}

              <div className="approvals-detail-header">
                <div>
                  <span className="approvals-eyebrow">
                    REQUEST DETAILS
                  </span>

                  <div className="approvals-detail-title-row">
                    <h2>
                      {selectedExpense.description || "Untitled expense"}
                    </h2>

                    <span
                      className={`approvals-status ${statusClass(selectedStatus)}`}
                    >
                      {selectedStatus}
                    </span>
                  </div>

                  <p>
                    Request ID: {getId(selectedExpense) || "Unavailable"}
                  </p>
                </div>

                <div className="approvals-detail-mark">
                  <Wallet size={22} />
                </div>
              </div>

              {/* AMOUNT */}

              <div className="approvals-amount-panel">
                <div>
                  <span>Expense amount</span>

                  <strong>
                    {formatMoney(selectedExpense.amount)}
                  </strong>
                </div>

                <span className="approvals-amount-label">
                  <Tag size={14} />

                  {selectedExpense.category || "Uncategorized"}
                </span>
              </div>

              {/* EVENT INFORMATION */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <Building2 size={17} />

                  <h3>Event information</h3>
                </div>

                <div className="approvals-info-grid">
                  <div className="approvals-info-field">
                    <span>Event name</span>

                    <strong>
                      {selectedExpense.event_name || "Unknown event"}
                    </strong>
                  </div>

                  <div className="approvals-info-field">
                    <span>Event date</span>

                    <strong>
                      {formatDate(selectedExpense.event_date)}
                    </strong>
                  </div>

                  <div className="approvals-info-field">
                    <span>Event ID</span>

                    <strong className="approvals-id-text">
                      {selectedExpense.event_id || "Not available"}
                    </strong>
                  </div>

                  <div className="approvals-info-field">
                    <span>Expense date</span>

                    <strong>
                      {formatDate(selectedExpense.expense_date)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* REQUEST INFORMATION */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <UserRound size={17} />

                  <h3>Request information</h3>
                </div>

                <div className="approvals-info-grid">
                  <div className="approvals-info-field">
                    <span>Submitted by</span>

                    <strong>
                      {selectedExpense.requested_by_name || "Unknown"}
                    </strong>
                  </div>

                  <div className="approvals-info-field">
                    <span>Submitted on</span>

                    <strong>
                      {formatDate(selectedExpense.created_at)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* LINKED ITEM */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <Link2 size={17} />

                  <h3>Linked event item</h3>
                </div>

                {selectedExpense.linked_item_type ||
                selectedExpense.linked_item_name ? (
                  <div className="approvals-linked-item">
                    <div className="approvals-linked-icon">
                      <ArrowUpRight size={18} />
                    </div>

                    <div>
                      <strong>
                        {selectedExpense.linked_item_name || "Linked item"}
                      </strong>

                      <span>
                        {selectedExpense.linked_item_type || "Other"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="approvals-no-linked">
                    No venue, resource or vendor is linked to this expense.
                  </div>
                )}
              </div>

              {/* ORGANIZER NOTES */}

              {selectedExpense.notes && (
                <div className="approvals-detail-section">
                  <div className="approvals-section-title">
                    <FileText size={17} />

                    <h3>Organizer notes</h3>
                  </div>

                  <div className="approvals-notes-box">
                    {selectedExpense.notes}
                  </div>
                </div>
              )}

              {/* REJECTION REASON */}

              {selectedStatus === "Rejected" &&
                selectedReview.reason && (
                  <div className="approvals-decision-box rejected">
                    <strong>Rejection reason</strong>

                    <p>{selectedReview.reason}</p>
                  </div>
                )}

              {/* REVIEW RECORD */}

              {selectedStatus !== "Pending" && (
                <div className="approvals-review-record">
                  <ShieldCheck size={18} />

                  <div>
                    <strong>Review completed</strong>

                    <span>
                      {selectedReview.reviewer
                        ? `Reviewed by ${selectedReview.reviewer}`
                        : "Reviewer information unavailable"}

                      {selectedReview.reviewedAt
                        ? ` · ${formatDate(selectedReview.reviewedAt)}`
                        : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* ADMIN DECISION */}

              {selectedStatus === "Pending" && (
                <div className="approvals-decision-area">
                  <div className="approvals-decision-copy">
                    <span className="approvals-eyebrow">
                      ADMIN DECISION
                    </span>

                    <h3>Review this expense request</h3>

                    <p>
                      Verify the submitted details before approving or rejecting.
                    </p>
                  </div>

                  <div className="approvals-decision-buttons">
                    <button
                      type="button"
                      className="approvals-decline"
                      onClick={() => handleReject(selectedExpense)}
                      disabled={Boolean(processingId)}
                    >
                      <XCircle size={17} />

                      Reject request
                    </button>

                    <button
                      type="button"
                      className="approvals-accept"
                      onClick={() => handleApprove(selectedExpense)}
                      disabled={Boolean(processingId)}
                    >
                      {isProcessing ? (
                        <RefreshCw
                          size={17}
                          className="approvals-rotating"
                        />
                      ) : (
                        <CheckCircle2 size={17} />
                      )}

                      {isProcessing
                        ? "Processing..."
                        : "Approve request"}
                    </button>
                  </div>
                </div>
              )}

            </>
          )}

        </section>

      </section>
    </main>
  );
}
