
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Wallet,
  IndianRupee,
  TrendingUp,
  Receipt,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CalendarDays,
  PieChart,
  AlertCircle,
  CheckCircle2,
  X,
  Save,
  LoaderCircle,
  Search,
  Filter,
  Building2,
  Users,
  Package,
  Store,
  Clock,
  List,
  ChevronDown,
} from "lucide-react";

import { apiRequest, getEvents } from "./api";
import "./Budget.css";

/* -------------------- Constants -------------------- */

const CATEGORIES = [
  "Venue",
  "Catering",
  "Staffing",
  "Marketing",
  "Logistics",
  "Equipment",
];

const STATUSES = ["Pending", "Approved", "Paid", "Rejected"];

const CATEGORY_COLORS = {
  Venue: "#2878e8",
  Catering: "#f59e0b",
  Staffing: "#16a34a",
  Marketing: "#e65b87",
  Logistics: "#8b5cf6",
  Equipment: "#14b8a6",
};

function getLocalDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const EMPTY_EXPENSE = {
  description: "",
  category: "Venue",
  amount: "",
  expense_date: getLocalDate(),
  status: "Pending",
  notes: "",
  linked_item_type: "Other",
  linked_item_id: "",
  linked_item_name: "",
};

/* -------------------- Helpers -------------------- */

function listFrom(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.events)) return response.events;
  if (Array.isArray(response?.data)) return response.data;

  return [];
}

function idOf(item) {
  return String(
    item?.id ??
      item?._id ??
      item?.event_id ??
      item?.venue_id ??
      item?.resource_id ??
      item?.vendor_id ??
      ""
  );
}

function expenseIdOf(item) {
  return String(item?.id ?? item?._id ?? "");
}

function errorText(error, fallback) {
  return error?.message || fallback;
}

function normalizedStatus(status) {
  const value = String(status || "Pending").trim();

  return STATUSES.includes(value) ? value : "Pending";
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return "Not specified";

  const parts = String(value).slice(0, 10).split("-");

  if (parts.length !== 3) return value;

  const [year, month, day] = parts;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day)
  ).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(value) {
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

function linkedItemKey(type, id) {
  if (!type || !id) return "";

  return `${String(type).toLowerCase()}:${String(id)}`;
}

/* -------------------- Reusable components -------------------- */

function Panel({ title, icon: Icon, action, className = "", children }) {
  return (
    <section className={`budget-panel ${className}`}>
      <div className="budget-panel-header">
        <h3>
          {Icon && (
            <span className="budget-panel-icon">
              <Icon size={15} />
            </span>
          )}
          {title}
        </h3>

        {action}
      </div>

      {children}
    </section>
  );
}

function SummaryCard({ title, value, icon: Icon, tone }) {
  return (
    <div className={`budget-summary-card tone-${tone}`}>
      <div className="budget-summary-icon">
        <Icon size={22} />
      </div>

      <div className="budget-summary-text">
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function FormField({ label, className = "", children }) {
  return (
    <label className={`budget-field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/* -------------------- Budget component -------------------- */

export default function Budget() {
  const requestSequence = useRef(0);

  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  const [eventInfo, setEventInfo] = useState(null);
  const [budget, setBudget] = useState(null);
  const [expenses, setExpenses] = useState([]);

  const [budgetInput, setBudgetInput] = useState("");
  const [showBudgetEditor, setShowBudgetEditor] = useState(false);

  const [expenseForm, setExpenseForm] = useState({ ...EMPTY_EXPENSE });
  const [editingExpenseId, setEditingExpenseId] = useState(null);

  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingBudget, setLoadingBudget] = useState(false);

  const [savingBudget, setSavingBudget] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [deletingExpenseId, setDeletingExpenseId] = useState(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showAllExpenses, setShowAllExpenses] = useState(false);

  /* -------------------- Load events -------------------- */

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    setError("");

    try {
      const response = await getEvents();
      const eventList = listFrom(response);

      setEvents(eventList);

      setSelectedEventId((currentId) => {
        const stillExists = eventList.some(
          (item) => idOf(item) === currentId
        );

        if (stillExists) return currentId;

        return eventList.length > 0 ? idOf(eventList[0]) : "";
      });
    } catch (err) {
      setEvents([]);
      setSelectedEventId("");
      setError(errorText(err, "Unable to load events."));
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  /* -------------------- Load selected event budget -------------------- */

  const loadBudget = useCallback(async (eventId, options = {}) => {
    if (!eventId) {
      setEventInfo(null);
      setBudget(null);
      setExpenses([]);
      setBudgetInput("");
      return;
    }

    const requestId = ++requestSequence.current;

    setLoadingBudget(true);
    setError("");

    if (!options.preserveNotice) {
      setNotice("");
    }

    try {
      const response = await apiRequest(
        `/budgets/event/${encodeURIComponent(eventId)}`
      );

      if (requestId !== requestSequence.current) return;

      setEventInfo(response?.event || null);
      setBudget(response?.budget || null);

      setExpenses(
        Array.isArray(response?.expenses) ? response.expenses : []
      );

      setBudgetInput(
        response?.budget?.total_budget != null
          ? String(response.budget.total_budget)
          : ""
      );
    } catch (err) {
      if (requestId !== requestSequence.current) return;

      setEventInfo(null);
      setBudget(null);
      setExpenses([]);
      setBudgetInput("");

      setError(errorText(err, "Unable to load event budget details."));
    } finally {
      if (requestId === requestSequence.current) {
        setLoadingBudget(false);
      }
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (selectedEventId) {
      loadBudget(selectedEventId);
    } else {
      setEventInfo(null);
      setBudget(null);
      setExpenses([]);
      setBudgetInput("");
    }

    setExpenseForm({
      ...EMPTY_EXPENSE,
      expense_date: getLocalDate(),
    });

    setEditingExpenseId(null);
    setShowAllExpenses(false);
    setShowBudgetEditor(false);
  }, [selectedEventId, loadBudget]);

  /* -------------------- Refresh -------------------- */

  const handleRefresh = async () => {
    setError("");
    setNotice("");

    await loadEvents();

    if (selectedEventId) {
      await loadBudget(selectedEventId);
    }
  };

  /* -------------------- Selected venue / services -------------------- */

  const selectedItems = useMemo(() => {
    if (!eventInfo) return [];

    const items = [];

    if (eventInfo.venue) {
      items.push({
        ...eventInfo.venue,
        id: idOf(eventInfo.venue),
        kind: "Venue",
      });
    }

    (eventInfo.resources || []).forEach((item) => {
      items.push({
        ...item,
        id: idOf(item),
        kind: "Resource",
      });
    });

    (eventInfo.vendors || []).forEach((item) => {
      items.push({
        ...item,
        id: idOf(item),
        kind: "Vendor",
      });
    });

    return items.filter((item) => item.id);
  }, [eventInfo]);

  /* -------------------- Allocated and unallocated items -------------------- */

  const allocatedItemKeys = useMemo(() => {
    const keys = new Set();

    expenses.forEach((expense) => {
      if (normalizedStatus(expense.status) === "Rejected") return;

      if (!expense.linked_item_id || !expense.linked_item_type) return;

      keys.add(
        linkedItemKey(
          expense.linked_item_type,
          expense.linked_item_id
        )
      );
    });

    return keys;
  }, [expenses]);

  const unallocatedItems = useMemo(() => {
    return selectedItems.filter((item) => {
      const key = linkedItemKey(item.kind, item.id);
      return !allocatedItemKeys.has(key);
    });
  }, [selectedItems, allocatedItemKeys]);

  const expenseFormItems = useMemo(() => {
    if (!editingExpenseId) return unallocatedItems;

    const currentItemKey = linkedItemKey(
      expenseForm.linked_item_type,
      expenseForm.linked_item_id
    );

    const currentItem = selectedItems.find(
      (item) =>
        linkedItemKey(item.kind, item.id) === currentItemKey
    );

    if (!currentItem) return unallocatedItems;

    const alreadyIncluded = unallocatedItems.some(
      (item) =>
        linkedItemKey(item.kind, item.id) === currentItemKey
    );

    return alreadyIncluded
      ? unallocatedItems
      : [currentItem, ...unallocatedItems];
  }, [
    editingExpenseId,
    expenseForm.linked_item_type,
    expenseForm.linked_item_id,
    selectedItems,
    unallocatedItems,
  ]);

  /* -------------------- Calculated values -------------------- */

  const totalBudget = Number(budget?.total_budget || 0);
  const totalExpenses = Number(budget?.total_expenses || 0);

  const remainingBudget = Number(
    budget?.remaining_budget ?? totalBudget - totalExpenses
  );

  const utilization =
    totalBudget > 0
      ? Math.min(100, Math.max(0, (totalExpenses / totalBudget) * 100))
      : 0;

  /* -------------------- Category breakdown -------------------- */

  const categoryTotals = useMemo(() => {
    const totals = {};

    CATEGORIES.forEach((category) => {
      totals[category] = 0;
    });

    expenses.forEach((expense) => {
      if (normalizedStatus(expense.status) === "Rejected") return;

      if (Object.hasOwn(totals, expense.category)) {
        totals[expense.category] += Number(expense.amount) || 0;
      }
    });

    return totals;
  }, [expenses]);

  const categoryEntries = useMemo(() => {
    return CATEGORIES.map((category) => ({
      category,
      amount: categoryTotals[category] || 0,
      color: CATEGORY_COLORS[category],
    }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [categoryTotals]);

  const pieGradient = useMemo(() => {
    const total = categoryEntries.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    if (!total) return "#e8eee9";

    let current = 0;

    const sections = categoryEntries.map((item) => {
      const start = current;

      current += (item.amount / total) * 100;

      return `${item.color} ${start}% ${current}%`;
    });

    return `conic-gradient(${sections.join(", ")})`;
  }, [categoryEntries]);

  /* -------------------- Filter expenses -------------------- */

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();

    return expenses.filter((expense) => {
      const matchesSearch =
        !query ||
        String(expense.description || "").toLowerCase().includes(query) ||
        String(expense.category || "").toLowerCase().includes(query) ||
        String(expense.notes || "").toLowerCase().includes(query) ||
        String(expense.linked_item_name || "")
          .toLowerCase()
          .includes(query);

      const matchesCategory =
        categoryFilter === "All" || expense.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [expenses, search, categoryFilter]);

  const visibleExpenses = showAllExpenses
    ? filteredExpenses
    : filteredExpenses.slice(0, 5);

  /* -------------------- Save event budget -------------------- */

  const saveBudget = async (event) => {
    event.preventDefault();

    if (!selectedEventId) {
      setError("Please select an event first.");
      return;
    }

    const amount = Number(budgetInput);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid budget greater than zero.");
      return;
    }

    setSavingBudget(true);
    setError("");
    setNotice("");

    try {
      await apiRequest(
        `/budgets/event/${encodeURIComponent(selectedEventId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_budget: amount }),
        }
      );

      await loadBudget(selectedEventId, { preserveNotice: true });

      setShowBudgetEditor(false);
      setNotice("Event budget saved successfully.");
    } catch (err) {
      setError(errorText(err, "Unable to save the event budget."));
    } finally {
      setSavingBudget(false);
    }
  };

  /* -------------------- Expense form helpers -------------------- */

  const updateExpenseField = (field, value) => {
    setExpenseForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetExpenseForm = () => {
    setExpenseForm({
      ...EMPTY_EXPENSE,
      expense_date: getLocalDate(),
    });

    setEditingExpenseId(null);
    setError("");
  };

  const startEdit = (expense) => {
    const expenseId = expenseIdOf(expense);

    if (!expenseId) {
      setError("Unable to identify this expense.");
      return;
    }

    setEditingExpenseId(expenseId);

    setExpenseForm({
      description: expense.description || "",

      category: CATEGORIES.includes(expense.category)
        ? expense.category
        : "Venue",

      amount: String(expense.amount ?? ""),

      expense_date: expense.expense_date
        ? String(expense.expense_date).slice(0, 10)
        : getLocalDate(),

      status: normalizedStatus(expense.status),
      notes: expense.notes || "",
      linked_item_type: expense.linked_item_type || "Other",
      linked_item_id: expense.linked_item_id
        ? String(expense.linked_item_id)
        : "",
      linked_item_name: expense.linked_item_name || "",
    });

    setError("");
    setNotice("");
  };

  const handleLinkedItemChange = (value) => {
    if (!value) {
      setExpenseForm((current) => ({
        ...current,
        linked_item_type: "Other",
        linked_item_id: "",
        linked_item_name: "",
      }));

      return;
    }

    const separatorIndex = value.indexOf(":");

    if (separatorIndex === -1) return;

    const type = value.slice(0, separatorIndex);
    const itemId = value.slice(separatorIndex + 1);

    const item = expenseFormItems.find(
      (selected) =>
        selected.kind === type &&
        String(selected.id) === String(itemId)
    );

    if (!item) return;

    let category = "Equipment";

    if (item.kind === "Venue") {
      category = "Venue";
    } else if (item.type === "Catering") {
      category = "Catering";
    } else if (CATEGORIES.includes(item.category)) {
      category = item.category;
    }

    const itemName = item.name || item.business_name || "";

    setExpenseForm((current) => ({
      ...current,
      linked_item_type: item.kind,
      linked_item_id: String(item.id),
      linked_item_name: itemName,
      category,
      description:
        current.description ||
        `${itemName || item.kind} expense`,
    }));
  };

  /* -------------------- Add / update expense -------------------- */

  const saveExpense = async (event) => {
    event.preventDefault();

    if (!selectedEventId) {
      setError("Please select an event.");
      return;
    }

    if (!budget || totalBudget <= 0) {
      setError("Set the event budget before adding expenses.");
      return;
    }

    const isEditing = Boolean(editingExpenseId);

    const description = expenseForm.description.trim();
    const amount = Number(expenseForm.amount);
    const expenseDate = expenseForm.expense_date;

    if (description.length < 2 || description.length > 200) {
      setError("Description must contain between 2 and 200 characters.");
      return;
    }

    if (!CATEGORIES.includes(expenseForm.category)) {
      setError("Select a valid expense category.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setError("Select a valid expense date.");
      return;
    }

    if (!STATUSES.includes(expenseForm.status)) {
      setError("Select a valid expense status.");
      return;
    }

    if (expenseForm.notes.length > 1000) {
      setError("Notes cannot exceed 1000 characters.");
      return;
    }

    if (!isEditing && expenseForm.linked_item_id) {
      const selectedKey = linkedItemKey(
        expenseForm.linked_item_type,
        expenseForm.linked_item_id
      );

      if (allocatedItemKeys.has(selectedKey)) {
        setError(
          "This item already has an allocated expense. Edit its existing expense instead."
        );
        return;
      }
    }

    const payload = {
      description,
      category: expenseForm.category,
      amount,
      expense_date: expenseDate,
      status: expenseForm.status,
      notes: expenseForm.notes.trim(),

      linked_item_type: expenseForm.linked_item_id
        ? expenseForm.linked_item_type
        : null,

      linked_item_id: expenseForm.linked_item_id || null,
      linked_item_name: expenseForm.linked_item_name || null,
    };

    setSavingExpense(true);
    setError("");
    setNotice("");

    const expenseBeingEdited = editingExpenseId;

    try {
      const endpoint = isEditing
        ? `/budgets/expenses/${encodeURIComponent(expenseBeingEdited)}`
        : `/budgets/event/${encodeURIComponent(selectedEventId)}/expenses`;

      await apiRequest(endpoint, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      await loadBudget(selectedEventId, { preserveNotice: true });

      setNotice(
        isEditing
          ? "Expense updated successfully."
          : "Expense added successfully."
      );

      resetExpenseForm();
    } catch (err) {
      setError(
        errorText(
          err,
          isEditing
            ? "Unable to update the expense."
            : "Unable to add the expense."
        )
      );
    } finally {
      setSavingExpense(false);
    }
  };

  /* -------------------- Delete expense -------------------- */

  const deleteExpense = async (expense) => {
    const expenseId = expenseIdOf(expense);

    if (!expenseId) {
      setError("Unable to identify this expense.");
      return;
    }

    const description = expense.description || "this expense";

    const confirmed = window.confirm(
      `Are you sure you want to delete "${description}"?\n\nThis will remove the expense record and update the event budget.`
    );

    if (!confirmed) return;

    setDeletingExpenseId(expenseId);
    setError("");
    setNotice("");

    try {
      await apiRequest(
        `/budgets/expenses/${encodeURIComponent(expenseId)}`,
        {
          method: "DELETE",
        }
      );

      // If the deleted expense was open in the edit form,
      // return the form to Add mode.
      if (editingExpenseId === expenseId) {
        resetExpenseForm();
      }

      await loadBudget(selectedEventId, { preserveNotice: true });

      setNotice("Expense deleted successfully.");
    } catch (err) {
      setError(
        errorText(err, "Unable to delete the expense.")
      );
    } finally {
      setDeletingExpenseId(null);
    }
  };

  /* -------------------- Loading view -------------------- */

  if (loadingEvents && events.length === 0) {
    return (
      <div className="budget-page">
        <div className="budget-empty">
          <LoaderCircle size={22} className="budget-spin" />
          <p>Loading events...</p>
        </div>
      </div>
    );
  }

  const busy = loadingBudget || loadingEvents;
  const budgetReady = Boolean(budget) && totalBudget > 0;

  /* -------------------- Render -------------------- */

  return (
    <div className="budget-page">
      {/* Page header */}

      <header className="budget-page-header">
        <div>
          <p className="budget-eyebrow">BUDGET MANAGEMENT</p>
          <h2>Budget &amp; Expenses</h2>
          <p>Manage the budget and expenses of your scheduled events.</p>
        </div>

        <button
          type="button"
          className="budget-btn budget-btn-secondary"
          onClick={handleRefresh}
          disabled={busy}
        >
          <RefreshCw size={14} className={busy ? "budget-spin" : ""} />
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {/* Alerts */}

      {error && (
        <div className="budget-alert budget-alert-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {notice && (
        <div className="budget-alert budget-alert-success" role="status">
          <CheckCircle2 size={16} />
          <span>{notice}</span>

          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Event selector */}

      <section className="budget-toolbar">
        <div className="budget-toolbar-icon">
          <CalendarDays size={18} />
        </div>

        <label className="budget-toolbar-field">
          <span>Select event</span>

          <select
            value={selectedEventId}
            onChange={(event) => setSelectedEventId(event.target.value)}
            disabled={events.length === 0}
          >
            <option value="">Select an existing event</option>

            {events.map((item) => (
              <option key={idOf(item)} value={idOf(item)}>
                {item.name || item.title || "Untitled event"}
              </option>
            ))}
          </select>
        </label>

        {loadingBudget && (
          <span className="budget-toolbar-note">
            <LoaderCircle size={14} className="budget-spin" />
            Loading event details...
          </span>
        )}
      </section>

      {events.length === 0 && !loadingEvents && (
        <div className="budget-empty">
          <h3>No events found</h3>
          <p>Create an event first to manage its budget and expenses.</p>
        </div>
      )}

      {eventInfo && (
        <>
          {/* Event banner */}

          <section className="budget-banner">
            <div className="budget-banner-main">
              <p className="budget-banner-eyebrow">
                EVENT DETAILS · READ ONLY
              </p>

              <h2>{eventInfo.name}</h2>

              <p className="budget-banner-meta">
                {eventInfo.event_type} · {eventInfo.status}
              </p>
            </div>

            <div className="budget-banner-stats">
              <div>
                <CalendarDays size={16} />
                <span>Event date</span>
                <strong>
                  {dateLabel(eventInfo.event_date)}
                  {eventInfo.end_date &&
                    eventInfo.end_date !== eventInfo.event_date &&
                    ` – ${dateLabel(eventInfo.end_date)}`}
                </strong>
              </div>

              <div>
                <Clock size={16} />
                <span>Event time</span>
                <strong>
                  {timeLabel(eventInfo.start_time)} –{" "}
                  {timeLabel(eventInfo.end_time)}
                </strong>
              </div>

              <div>
                <Users size={16} />
                <span>Attendees</span>
                <strong>{eventInfo.attendee_count ?? 0}</strong>
              </div>
            </div>

            <p className="budget-banner-note">
              The event date, venue and selected services come from Event
              Management and cannot be changed here.
            </p>
          </section>

          {/* Summary cards */}

          <div className="budget-summary-grid">
            <SummaryCard
              title="Total Event Budget"
              value={money(totalBudget)}
              icon={Wallet}
              tone="green"
            />

            <SummaryCard
              title="Total Expenses"
              value={money(totalExpenses)}
              icon={Receipt}
              tone="amber"
            />

            <SummaryCard
              title="Remaining Budget"
              value={money(remainingBudget)}
              icon={IndianRupee}
              tone="mint"
            />

            <SummaryCard
              title="Budget Utilization"
              value={`${utilization.toFixed(1)}%`}
              icon={TrendingUp}
              tone="blue"
            />
          </div>

          {/* Overview + category breakdown */}

          <div className="budget-two-col">
            <Panel title="Budget Overview" icon={TrendingUp}>
              <div className="budget-panel-body">
                <div className="budget-progress-row">
                  <span>Budget utilization</span>
                  <strong>{utilization.toFixed(1)}%</strong>
                </div>

                <div className="budget-progress">
                  <div
                    className={`budget-progress-fill ${
                      utilization > 90 ? "is-danger" : ""
                    }`}
                    style={{ width: `${utilization}%` }}
                  />
                </div>

                <div className="budget-progress-legend">
                  <span>Spent: {money(totalExpenses)}</span>
                  <span>Remaining: {money(remainingBudget)}</span>
                </div>

                <div className="budget-allocated">
                  <div>
                    <span>Allocated event budget</span>
                    <strong>{money(totalBudget)}</strong>
                  </div>

                  <button
                    type="button"
                    className="budget-btn budget-btn-primary"
                    onClick={() =>
                      setShowBudgetEditor((current) => !current)
                    }
                  >
                    <Pencil size={13} />
                    {totalBudget > 0 ? "Edit Budget" : "Set Budget"}
                  </button>
                </div>

                {showBudgetEditor && (
                  <form className="budget-editor" onSubmit={saveBudget}>
                    <FormField label="Total Event Budget (₹)">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={budgetInput}
                        onChange={(event) =>
                          setBudgetInput(event.target.value)
                        }
                        placeholder="Enter total event budget"
                        required
                      />
                    </FormField>

                    <div className="budget-editor-actions">
                      <button
                        type="submit"
                        className="budget-btn budget-btn-primary"
                        disabled={savingBudget}
                      >
                        {savingBudget ? (
                          <LoaderCircle size={14} className="budget-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {savingBudget ? "Saving..." : "Save Budget"}
                      </button>

                      <button
                        type="button"
                        className="budget-btn budget-btn-secondary"
                        onClick={() => setShowBudgetEditor(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </Panel>

            <Panel title="Expense Category Breakdown" icon={PieChart}>
              <div className="budget-panel-body budget-category">
                <div
                  className="budget-pie"
                  style={{ background: pieGradient }}
                  role="img"
                  aria-label="Expense distribution by category"
                >
                  <div className="budget-pie-center">
                    <strong>{money(totalExpenses)}</strong>
                    <span>Total spent</span>
                  </div>
                </div>

                <ul className="budget-legend">
                  {categoryEntries.length === 0 && (
                    <li className="budget-legend-empty">
                      No expense categories yet.
                    </li>
                  )}

                  {categoryEntries.map((item) => (
                    <li key={item.category}>
                      <span className="budget-legend-name">
                        <i style={{ background: item.color }} />
                        {item.category}
                      </span>

                      <strong>{money(item.amount)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </div>

          {/* Expenses table + expense form */}

          <div className="budget-workspace">
            <Panel
              title="Recent Expenses"
              icon={List}
              className="budget-expenses-panel"
              action={
                <button
                  type="button"
                  className="budget-link-button"
                  onClick={() => setShowAllExpenses((current) => !current)}
                >
                  {showAllExpenses ? "Show Less" : "View All"}

                  <ChevronDown
                    size={13}
                    className={showAllExpenses ? "is-flipped" : ""}
                  />
                </button>
              }
            >
              <div className="budget-filters">
                <div className="budget-search">
                  <Search size={14} />

                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search expenses..."
                    aria-label="Search expenses"
                  />
                </div>

                <div className="budget-filter-select">
                  <Filter size={13} />

                  <select
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value)
                    }
                    aria-label="Filter expenses by category"
                  >
                    <option value="All">All Categories</option>

                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="budget-table-wrap">
                <table className="budget-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description / Linked Item</th>
                      <th>Category</th>
                      <th className="is-right">Amount</th>
                      <th>Status</th>
                      <th className="is-right">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loadingBudget ? (
                      <tr>
                        <td colSpan={6} className="budget-table-message">
                          <LoaderCircle size={18} className="budget-spin" />
                          <span>Loading expenses...</span>
                        </td>
                      </tr>
                    ) : visibleExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="budget-table-message">
                          <Receipt size={24} />

                          <span>
                            {expenses.length === 0
                              ? "No expenses recorded yet."
                              : "No expenses match your search."}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      visibleExpenses.map((expense, index) => {
                        const status = normalizedStatus(expense.status);
                        const expenseId = expenseIdOf(expense);
                        const isDeleting =
                          deletingExpenseId === expenseId;

                        return (
                          <tr
                            key={
                              expenseId ||
                              `${expense.description}-${index}`
                            }
                          >
                            <td className="is-nowrap">
                              {dateLabel(expense.expense_date)}
                            </td>

                            <td>
                              <strong className="budget-expense-title">
                                {expense.description || "—"}
                              </strong>

                              {expense.linked_item_name && (
                                <span className="budget-expense-link">
                                  {expense.linked_item_type}:{" "}
                                  {expense.linked_item_name}
                                </span>
                              )}
                            </td>

                            <td className="is-nowrap">
                              {expense.category || "—"}
                            </td>

                            <td className="is-right is-nowrap budget-amount">
                              {money(expense.amount)}
                            </td>

                            <td>
                              <span
                                className={`budget-status status-${status.toLowerCase()}`}
                              >
                                {status}
                              </span>
                            </td>

                            <td className="is-right">
                              <div className="budget-row-actions">
                                <button
                                  type="button"
                                  className="budget-icon-button"
                                  onClick={() => startEdit(expense)}
                                  title="Edit expense"
                                  aria-label="Edit expense"
                                  disabled={
                                    Boolean(deletingExpenseId) ||
                                    savingExpense
                                  }
                                >
                                  <Pencil size={13} />
                                </button>

                                <button
                                  type="button"
                                  className="budget-icon-button"
                                  onClick={() => deleteExpense(expense)}
                                  title="Delete expense"
                                  aria-label="Delete expense"
                                  disabled={
                                    Boolean(deletingExpenseId) ||
                                    savingExpense
                                  }
                                >
                                  {isDeleting ? (
                                    <LoaderCircle
                                      size={14}
                                      className="budget-spin"
                                    />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {!loadingBudget && expenses.length > 0 && (
                <div className="budget-table-footer">
                  <span>
                    Showing {visibleExpenses.length} of{" "}
                    {filteredExpenses.length} matching expenses
                  </span>

                  <strong>Total: {money(totalExpenses)}</strong>
                </div>
              )}
            </Panel>

            <Panel
              title={editingExpenseId ? "Edit Expense" : "Add Event Expense"}
              icon={editingExpenseId ? Pencil : Plus}
              className="budget-form-panel"
            >
              <form className="budget-form" onSubmit={saveExpense}>
                <p className="budget-form-note">
                  {editingExpenseId
                    ? "Update the details of this existing expense."
                    : "Add an expense for an item that has not yet been allocated to an expense."}
                </p>

                <FormField
                  label="Link to selected venue / service"
                  className="is-wide"
                >
                  <select
                    value={
                      expenseForm.linked_item_id
                        ? `${expenseForm.linked_item_type}:${expenseForm.linked_item_id}`
                        : ""
                    }
                    onChange={(event) =>
                      handleLinkedItemChange(event.target.value)
                    }
                  >
                    <option value="">General event expense</option>

                    {expenseFormItems.map((item) => (
                      <option
                        key={`${item.kind}:${item.id}`}
                        value={`${item.kind}:${item.id}`}
                      >
                        {item.kind}: {item.name || item.business_name}
                      </option>
                    ))}
                  </select>
                </FormField>

                {!editingExpenseId &&
                  selectedItems.length > 0 &&
                  unallocatedItems.length === 0 && (
                    <p className="budget-form-note is-wide">
                      All selected venues and services already have
                      allocated expenses. You can still add a general
                      event expense.
                    </p>
                  )}

                <FormField label="Expense Description" className="is-wide">
                  <input
                    type="text"
                    value={expenseForm.description}
                    onChange={(event) =>
                      updateExpenseField("description", event.target.value)
                    }
                    placeholder="e.g. Venue advance payment"
                    maxLength={200}
                    required
                  />
                </FormField>

                <FormField label="Category">
                  <select
                    value={expenseForm.category}
                    onChange={(event) =>
                      updateExpenseField("category", event.target.value)
                    }
                    required
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Status">
                  <select
                    value={expenseForm.status}
                    onChange={(event) =>
                      updateExpenseField("status", event.target.value)
                    }
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Amount (₹)">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(event) =>
                      updateExpenseField("amount", event.target.value)
                    }
                    placeholder="Enter amount"
                    required
                  />
                </FormField>

                <FormField label="Expense / Payment Date">
                  <input
                    type="date"
                    value={expenseForm.expense_date}
                    onChange={(event) =>
                      updateExpenseField("expense_date", event.target.value)
                    }
                    required
                  />
                </FormField>

                <FormField label="Notes (Optional)" className="is-wide">
                  <textarea
                    value={expenseForm.notes}
                    onChange={(event) =>
                      updateExpenseField("notes", event.target.value)
                    }
                    placeholder="Additional details"
                    maxLength={1000}
                    rows={3}
                  />
                </FormField>

                {!budgetReady && !loadingBudget && (
                  <p className="budget-form-warning">
                    Set the event budget before adding or editing expenses.
                  </p>
                )}

                <div className="budget-form-actions">
                  {editingExpenseId && (
                    <button
                      type="button"
                      className="budget-btn budget-btn-secondary"
                      onClick={resetExpenseForm}
                    >
                      Cancel
                    </button>
                  )}

                  <button
                    type="submit"
                    className="budget-btn budget-btn-primary"
                    disabled={
                      savingExpense ||
                      Boolean(deletingExpenseId) ||
                      loadingBudget ||
                      !budgetReady
                    }
                  >
                    {savingExpense ? (
                      <LoaderCircle size={15} className="budget-spin" />
                    ) : editingExpenseId ? (
                      <Save size={15} />
                    ) : (
                      <Plus size={15} />
                    )}

                    {savingExpense
                      ? "Saving..."
                      : editingExpenseId
                        ? "Update Expense"
                        : "Add Expense"}
                  </button>
                </div>
              </form>
            </Panel>
          </div>

          {/* Selected venue and services */}

          <Panel
            title="Selected Venue & Services"
            icon={Building2}
            className="budget-services-panel"
          >
            <div className="budget-services">
              {selectedItems.length === 0 && (
                <p className="budget-services-empty">
                  No venue, resources or vendors were found for this event.
                </p>
              )}

              {selectedItems.map((item, index) => {
                const Icon =
                  item.kind === "Venue"
                    ? Building2
                    : item.kind === "Vendor"
                      ? Store
                      : Package;

                const itemName =
                  item.name || item.business_name || "Unnamed item";

                const detail =
                  item.address ||
                  item.type ||
                  item.category ||
                  item.city ||
                  "";

                const isAllocated = allocatedItemKeys.has(
                  linkedItemKey(item.kind, item.id)
                );

                return (
                  <div
                    className="budget-service-card"
                    key={`${item.kind}-${item.id || index}`}
                  >
                    <div className="budget-service-icon">
                      <Icon size={17} />
                    </div>

                    <div className="budget-service-text">
                      <span className="budget-service-kind">
                        {item.kind}
                      </span>

                      <strong>{itemName}</strong>

                      {detail && <small>{detail}</small>}

                      {Number(item.estimated_cost) > 0 && (
                        <em>
                          Catalogue estimate: {money(item.estimated_cost)}
                        </em>
                      )}

                      <small>
                        {isAllocated
                          ? "Expense allocated"
                          : "No expense allocated"}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}

      {!eventInfo && !loadingBudget && selectedEventId && (
        <div className="budget-empty">
          <p>Event budget details are not available.</p>
        </div>
      )}
    </div>
  );
}
