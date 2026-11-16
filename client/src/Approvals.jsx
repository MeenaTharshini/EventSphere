
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

import { apiRequest } from "./api";
import "./Approvals.css";

/* -------------------- Constants -------------------- */

const STATUSES = ["All", "Pending", "Approved", "Paid", "Rejected"];

/* -------------------- Helpers -------------------- */

function formatMoney(value) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getId(item) {
  return String(
    item?.id ??
      item?._id ??
      item?.expense_id ??
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
    return detail
      .map((item) => item.msg || item.message || "")
      .filter(Boolean)
      .join(", ");
  }

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  return "Something went wrong. Please try again.";
}

function getReview(expense) {
  const approval = expense?.approval || {};

  return {
    reviewer:
      approval.reviewed_by_name ||
      approval.reviewer_name ||
      approval.reviewed_by ||
      "",
    reviewedAt: approval.reviewed_at || "",
    reason:
      approval.rejection_reason ||
      approval.reason ||
      "",
  };
}

function getExpensesArray(response) {
  if (Array.isArray(response)) return response;

  if (Array.isArray(response?.approvals)) {
    return response.approvals;
  }

  if (Array.isArray(response?.expenses)) {
    return response.expenses;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.data?.approvals)) {
    return response.data.approvals;
  }

  if (Array.isArray(response?.data?.expenses)) {
    return response.data.expenses;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  return [];
}

function getUpdatedExpense(response) {
  if (!response) return null;

  return (
    response?.expense ||
    response?.data?.expense ||
    response?.data ||
    null
  );
}

/* -------------------- Approvals Component -------------------- */

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

  /* -------------------- Load Approvals --------------------
     GET /api/budgets/approvals

     This endpoint is already implemented in budgets.py.
     It returns expense requests across events for admins.
  ---------------------------------------------------------- */

  const loadApprovals = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");
    setSuccess("");

    try {
      const response = await apiRequest("/budgets/approvals");

      const records = getExpensesArray(response);

      const validExpenses = records
        .filter((expense) => getId(expense))
        .map((expense) => ({
          ...expense,
          status: normalizeStatus(expense.status),
        }));

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
    } catch (err) {
      setError(getErrorMessage(err));
      setExpenses([]);
      setSelectedId("");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadApprovals();
    } else {
      setLoading(false);
    }
  }, [isAdmin, loadApprovals]);

  /* -------------------- Summary -------------------- */

  const counts = useMemo(() => {
    const countBy = (status) =>
      expenses.filter(
        (item) => normalizeStatus(item.status) === status
      ).length;

    return {
      total: expenses.length,
      pending: countBy("Pending"),
      approved: countBy("Approved"),
      rejected: countBy("Rejected"),
      paid: countBy("Paid"),
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

  /* -------------------- Search and Filter -------------------- */

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

      return (
        matchesStatus &&
        (!query || searchable.includes(query))
      );
    });
  }, [expenses, search, statusFilter]);

  /* -------------------- Selected Expense -------------------- */

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

  /* -------------------- Update Local Expense -------------------- */

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

  /* -------------------- Approve Expense -------------------- */

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

      const updatedExpense = getUpdatedExpense(response);

      updateExpense(
        id,
        updatedExpense,
        {
          status: "Approved",
        }
      );

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

  /* -------------------- Reject Expense -------------------- */

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

  /* -------------------- Access Control -------------------- */

  if (!isAdmin) {
    return (
      <section className="approvals-page">
        <div className="approvals-access">
          <ShieldCheck size={34} />

          <h2>Administrator access required</h2>

          <p>
            Only administrators can review and decide expense requests.
          </p>
        </div>
      </section>
    );
  }

  const selectedStatus = selectedExpense
    ? normalizeStatus(selectedExpense.status)
    : "";

  const selectedReview = selectedExpense
    ? getReview(selectedExpense)
    : {};

  const isProcessing =
    selectedExpense &&
    processingId === getId(selectedExpense);

  /* -------------------- Render -------------------- */

  return (
    <section className="approvals-page">
      <header className="approvals-page-header">
        <div>
          <p className="approvals-eyebrow">FINANCE</p>
          <h2>Expense Approvals</h2>
          <p>
            Review, verify and manage expense requests across your events.
          </p>
        </div>

        <button
          type="button"
          className="approvals-secondary-button"
          onClick={() => loadApprovals(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            size={14}
            className={
              refreshing ? "approvals-rotating" : ""
            }
          />

          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {/* Alerts */}

      {error && (
        <div
          className="approvals-alert approvals-alert-error"
          role="alert"
        >
          <AlertCircle size={15} />

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
        <div
          className="approvals-alert approvals-alert-success"
          role="status"
        >
          <CheckCircle2 size={15} />

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

      {/* Overview */}

      <section className="approvals-overview">
        <div className="approvals-overview-heading">
          <div>
            <p className="approvals-eyebrow">
              FINANCIAL OVERVIEW
            </p>
            <h3>Approval activity</h3>
          </div>

          <div className="approvals-total-count">
            <strong>{counts.total}</strong>
            <span>Total requests</span>
          </div>
        </div>

        <div className="approvals-metrics">
          <div className="approvals-metric pending">
            <span className="approvals-metric-icon">
              <Clock3 size={16} />
            </span>

            <div>
              <strong>{counts.pending}</strong>
              <small>Awaiting review</small>
            </div>
          </div>

          <div className="approvals-metric approved">
            <span className="approvals-metric-icon">
              <CheckCircle2 size={16} />
            </span>

            <div>
              <strong>{counts.approved}</strong>
              <small>Approved</small>
            </div>
          </div>

          <div className="approvals-metric rejected">
            <span className="approvals-metric-icon">
              <XCircle size={16} />
            </span>

            <div>
              <strong>{counts.rejected}</strong>
              <small>Rejected</small>
            </div>
          </div>

          <div className="approvals-metric paid">
            <span className="approvals-metric-icon">
              <Wallet size={16} />
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

      {/* Workspace */}

      <section className="approvals-workspace">
        {/* LEFT: REQUEST QUEUE */}

        <aside className="approvals-queue">
          <div className="approvals-queue-heading">
            <div>
              <p className="approvals-eyebrow">INBOX</p>
              <h3>Request queue</h3>
            </div>

            <span className="approvals-queue-count">
              {filteredExpenses.length}
            </span>
          </div>

          <div className="approvals-queue-controls">
            <div className="approvals-search">
              <Search size={15} />

              <input
                type="search"
                placeholder="Search requests..."
                aria-label="Search requests"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </div>

            <select
              aria-label="Filter requests by status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === "All" ? "All statuses" : status}
                </option>
              ))}
            </select>
          </div>

          <div className="approvals-queue-list">
            {loading ? (
              <div className="approvals-queue-message">
                <div className="approvals-spinner" />
                <span>Loading requests...</span>
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="approvals-queue-message">
                <Inbox size={26} />

                <strong>No requests found</strong>

                <span>
                  Try another search or status filter.
                </span>

                {(search || statusFilter !== "All") && (
                  <button
                    type="button"
                    className="approvals-secondary-button"
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
                    className={`approvals-queue-item ${
                      active ? "active" : ""
                    }`}
                    onClick={() => setSelectedId(id)}
                  >
                    <div className="approvals-queue-item-top">
                      <span className="approvals-queue-category">
                        {expense.category || "Expense"}
                      </span>

                      <span
                        className={`approvals-status status-${statusClass(
                          status
                        )}`}
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
                        {expense.requested_by_name ||
                          "Unknown requester"}
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
            Showing {filteredExpenses.length} of{" "}
            {expenses.length} requests
          </div>
        </aside>

        {/* RIGHT: REQUEST DETAILS */}

        <section className="approvals-detail-panel">
          {!selectedExpense ? (
            <div className="approvals-detail-empty">
              <div className="approvals-detail-empty-icon">
                <FileText size={28} />
              </div>

              <h3>Select an expense request</h3>

              <p>
                Choose a request from the queue to inspect its
                details and review its approval status.
              </p>
            </div>
          ) : (
            <>
              {/* Detail header */}

              <div className="approvals-detail-header">
                <div>
                  <p className="approvals-eyebrow">
                    REQUEST DETAILS
                  </p>

                  <div className="approvals-detail-title-row">
                    <h3>
                      {selectedExpense.description ||
                        "Untitled expense"}
                    </h3>

                    <span
                      className={`approvals-status status-${statusClass(
                        selectedStatus
                      )}`}
                    >
                      {selectedStatus}
                    </span>
                  </div>

                  <p className="approvals-detail-id">
                    Request ID:{" "}
                    {getId(selectedExpense) || "Unavailable"}
                  </p>
                </div>

                <div className="approvals-detail-mark">
                  <Wallet size={20} />
                </div>
              </div>

              {/* Amount */}

              <div className="approvals-amount-panel">
                <div>
                  <span>Expense amount</span>
                  <strong>
                    {formatMoney(selectedExpense.amount)}
                  </strong>
                </div>

                <span className="approvals-amount-label">
                  <Tag size={13} />
                  {selectedExpense.category ||
                    "Uncategorized"}
                </span>
              </div>

              {/* Event information */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <Building2 size={16} />
                  <h4>Event information</h4>
                </div>

                <div className="approvals-info-grid">
                  <div className="approvals-info-field">
                    <span>Event name</span>
                    <strong>
                      {selectedExpense.event_name ||
                        "Unknown event"}
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
                      {selectedExpense.event_id ||
                        "Not available"}
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

              {/* Request information */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <UserRound size={16} />
                  <h4>Request information</h4>
                </div>

                <div className="approvals-info-grid">
                  <div className="approvals-info-field">
                    <span>Submitted by</span>
                    <strong>
                      {selectedExpense.requested_by_name ||
                        selectedExpense.requested_by ||
                        "Unknown"}
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

              {/* Linked item */}

              <div className="approvals-detail-section">
                <div className="approvals-section-title">
                  <Link2 size={16} />
                  <h4>Linked event item</h4>
                </div>

                {selectedExpense.linked_item_type ||
                selectedExpense.linked_item_name ? (
                  <div className="approvals-linked-item">
                    <div className="approvals-linked-icon">
                      <ArrowUpRight size={17} />
                    </div>

                    <div>
                      <strong>
                        {selectedExpense.linked_item_name ||
                          "Linked item"}
                      </strong>

                      <span>
                        {selectedExpense.linked_item_type ||
                          "Other"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="approvals-no-linked">
                    No venue, resource or vendor is linked to
                    this expense.
                  </div>
                )}
              </div>

              {/* Notes */}

              {selectedExpense.notes && (
                <div className="approvals-detail-section">
                  <div className="approvals-section-title">
                    <FileText size={16} />
                    <h4>Organizer notes</h4>
                  </div>

                  <div className="approvals-notes-box">
                    {selectedExpense.notes}
                  </div>
                </div>
              )}

              {/* Rejection reason */}

              {selectedStatus === "Rejected" &&
                selectedReview.reason && (
                  <div className="approvals-decision-box rejected">
                    <strong>Rejection reason</strong>
                    <p>{selectedReview.reason}</p>
                  </div>
                )}

              {/* Review record */}

              {selectedStatus !== "Pending" && (
                <div className="approvals-review-record">
                  <ShieldCheck size={17} />

                  <div>
                    <strong>Review completed</strong>

                    <span>
                      {selectedReview.reviewer
                        ? `Reviewed by ${selectedReview.reviewer}`
                        : "Reviewer information unavailable"}

                      {selectedReview.reviewedAt
                        ? ` · ${formatDate(
                            selectedReview.reviewedAt
                          )}`
                        : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Admin decision */}

              {selectedStatus === "Pending" && (
                <div className="approvals-decision-area">
                  <div className="approvals-decision-copy">
                    <p className="approvals-eyebrow">
                      ADMIN DECISION
                    </p>

                    <h4>Review this expense request</h4>

                    <p>
                      Verify the submitted details before
                      approving or rejecting.
                    </p>
                  </div>

                  <div className="approvals-decision-buttons">
                    <button
                      type="button"
                      className="approvals-danger-button"
                      onClick={() =>
                        handleReject(selectedExpense)
                      }
                      disabled={Boolean(processingId)}
                    >
                      {isProcessing ? (
                        <RefreshCw
                          size={15}
                          className="approvals-rotating"
                        />
                      ) : (
                        <XCircle size={15} />
                      )}

                      Reject request
                    </button>

                    <button
                      type="button"
                      className="approvals-primary-button"
                      onClick={() =>
                        handleApprove(selectedExpense)
                      }
                      disabled={Boolean(processingId)}
                    >
                      {isProcessing ? (
                        <RefreshCw
                          size={15}
                          className="approvals-rotating"
                        />
                      ) : (
                        <CheckCircle2 size={15} />
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
    </section>
  );
}
