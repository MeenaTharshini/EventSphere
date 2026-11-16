
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Handshake,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  IndianRupee,
  Wallet,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  CalendarDays,
  Mail,
  Phone,
  FileText,
  TrendingUp,
  Building2,
} from "lucide-react";

import {
  getEvents,
  getSponsorships,
  createSponsorship,
  updateSponsorship,
  deleteSponsorship,
} from "./api";

import "./Sponsorships.css";

const TIERS = ["Title", "Platinum", "Gold", "Silver", "Bronze", "Custom"];

const STATUSES = [
  "Pending",
  "Confirmed",
  "Partially Paid",
  "Paid",
  "Cancelled",
];

const INITIAL_FORM = {
  event_id: "",
  sponsor_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  tier: "Custom",
  pledged_amount: "",
  amount_received: "0",
  status: "Pending",
  benefits: "",
  notes: "",
};

const currency = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(amount)) ? Number(amount) : 0);

const getEventId = (event) =>
  event?._id || event?.id || event?.event_id || "";

const getEventName = (event) =>
  event?.name || event?.title || event?.event_name || "Untitled event";

const getSponsorshipId = (item) =>
  String(item?.id || item?._id || item?.sponsorship_id || "");

const extractArray = (response, key) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.[key])) return response[key];
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.[key])) return response.data[key];
  if (Array.isArray(response?.data?.items)) return response.data.items;
  return [];
};

const getErrorMessage = (error) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.detail ||
  error?.message ||
  "Something went wrong. Please try again.";

const getUserRole = (user) =>
  String(user?.role || user?.user?.role || user?.activeRole || "")
    .trim()
    .toLowerCase();

const getPaymentStatus = (item) => {
  if (item.status === "Cancelled") return "Cancelled";

  const pledged = Number(item.pledged_amount || 0);
  const received = Number(item.amount_received || 0);

  if (pledged > 0 && received >= pledged) return "Paid";
  if (received > 0) return "Partially Paid";

  return item.status || "Pending";
};

const getStatusClass = (status) => {
  switch (status) {
    case "Paid":
      return "paid";
    case "Partially Paid":
      return "partial";
    case "Confirmed":
      return "confirmed";
    case "Cancelled":
      return "cancelled";
    default:
      return "pending";
  }
};

const getStatusIcon = (status) => {
  if (status === "Paid") return <CheckCircle2 size={14} />;
  if (status === "Cancelled") return <X size={14} />;
  if (status === "Partially Paid") return <TrendingUp size={14} />;
  return <Clock size={14} />;
};

const getTierClass = (tier) =>
  String(tier || "Custom").toLowerCase().replace(/\s+/g, "-");

function Sponsorships({ user }) {
  const [events, setEvents] = useState([]);
  const [sponsorships, setSponsorships] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...INITIAL_FORM });

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const role = getUserRole(user);
  const isManager = ["admin", "administrator", "organizer"].includes(role);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [eventResponse, sponsorshipResponse] = await Promise.all([
        getEvents(),
        getSponsorships(),
      ]);

      setEvents(extractArray(eventResponse, "events"));
      setSponsorships(extractArray(sponsorshipResponse, "sponsorships"));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredSponsorships = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return sponsorships.filter((item) => {
      const matchesSearch =
        !searchTerm ||
        String(item.sponsor_name || "").toLowerCase().includes(searchTerm) ||
        String(item.event_name || "").toLowerCase().includes(searchTerm) ||
        String(item.contact_name || "").toLowerCase().includes(searchTerm) ||
        String(item.tier || "").toLowerCase().includes(searchTerm);

      const matchesEvent =
        eventFilter === "all" ||
        String(item.event_id || "") === eventFilter;

      const matchesStatus =
        statusFilter === "all" ||
        getPaymentStatus(item) === statusFilter;

      return matchesSearch && matchesEvent && matchesStatus;
    });
  }, [sponsorships, search, eventFilter, statusFilter]);

  const summary = useMemo(() => {
    const active = sponsorships.filter(
      (item) => item.status !== "Cancelled"
    );

    const totalPledged = active.reduce(
      (sum, item) => sum + Number(item.pledged_amount || 0),
      0
    );

    const totalReceived = active.reduce(
      (sum, item) => sum + Number(item.amount_received || 0),
      0
    );

    const outstanding = active.reduce(
      (sum, item) =>
        sum +
        Math.max(
          Number(item.pledged_amount || 0) -
            Number(item.amount_received || 0),
          0
        ),
      0
    );

    return {
      sponsors: active.length,
      totalPledged,
      totalReceived,
      outstanding,
    };
  }, [sponsorships]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm({
      ...INITIAL_FORM,
      event_id: eventFilter !== "all" ? eventFilter : "",
    });
    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const openEditForm = (item) => {
    setEditingId(getSponsorshipId(item));

    setForm({
      event_id: String(item.event_id || ""),
      sponsor_name: item.sponsor_name || "",
      contact_name: item.contact_name || "",
      contact_email: item.contact_email || "",
      contact_phone: item.contact_phone || "",
      tier: item.tier || "Custom",
      pledged_amount: String(item.pledged_amount ?? ""),
      amount_received: String(item.amount_received ?? 0),
      status: item.status || "Pending",
      benefits: item.benefits || "",
      notes: item.notes || "",
    });

    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm({ ...INITIAL_FORM });
    setError("");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.event_id) {
      setError("Please select an event.");
      return;
    }

    if (form.sponsor_name.trim().length < 2) {
      setError("Sponsor name must contain at least 2 characters.");
      return;
    }

    const pledged = Number(form.pledged_amount);
    const received = Number(form.amount_received);

    if (!Number.isFinite(pledged) || pledged <= 0) {
      setError("Enter a valid pledged amount greater than zero.");
      return;
    }

    if (!Number.isFinite(received) || received < 0) {
      setError("Enter a valid amount received.");
      return;
    }

    if (received > pledged) {
      setError("Amount received cannot exceed the pledged amount.");
      return;
    }

    const payload = {
      event_id: form.event_id,
      sponsor_name: form.sponsor_name.trim(),
      contact_name: form.contact_name.trim(),
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim(),
      tier: form.tier,
      pledged_amount: pledged,
      amount_received: received,
      status: form.status,
      benefits: form.benefits.trim(),
      notes: form.notes.trim(),
    };

    setSaving(true);

    try {
      if (editingId) {
        await updateSponsorship(editingId, payload);
        setSuccess("Sponsorship updated successfully.");
      } else {
        await createSponsorship(payload);
        setSuccess("Sponsorship created successfully.");
      }

      setShowForm(false);
      setEditingId(null);
      setForm({ ...INITIAL_FORM });

      await loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    const id = getSponsorshipId(item);
    if (!id) {
      setError("Unable to identify this sponsorship record.");
      return;
    }

    const confirmed = window.confirm(
      `Delete the sponsorship from "${item.sponsor_name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(id);
    setError("");
    setSuccess("");

    try {
      await deleteSponsorship(id);

      setSponsorships((previous) =>
        previous.filter((record) => getSponsorshipId(record) !== id)
      );

      setSuccess("Sponsorship deleted successfully.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const getDerivedStatus = () => {
    const pledged = Number(form.pledged_amount || 0);
    const received = Number(form.amount_received || 0);

    if (form.status === "Cancelled") return "Cancelled";
    if (pledged > 0 && received >= pledged) return "Paid";
    if (received > 0) return "Partially Paid";

    return form.status;
  };

  const visibleCount = filteredSponsorships.length;

  if (!isManager) {
    return (
      <div className="sponsorship-page">
        <div className="sponsorship-empty">
          <AlertCircle size={34} />
          <h3>Access restricted</h3>
          <p>Only organizers and administrators can manage sponsorships.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sponsorship-page">
      {/* Page heading */}
      <div className="sponsorship-page-header">
        <div>
          <p className="sponsorship-eyebrow">
            <Handshake size={14} />
            EVENT MANAGEMENT
          </p>
          <h2>Sponsorship Management</h2>
          <p>
            Manage sponsors, track pledged contributions, and monitor
            payments across your events.
          </p>
        </div>

        <div className="sponsorship-header-actions">
          <button
            type="button"
            className="sponsorship-secondary-button"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              className={loading ? "sponsorship-spin" : ""}
            />
            Refresh
          </button>

          <button
            type="button"
            className="sponsorship-primary-button"
            onClick={openCreateForm}
            disabled={events.length === 0}
          >
            <Plus size={16} />
            Add Sponsor
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && !showForm && (
        <div className="sponsorship-alert sponsorship-alert-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="sponsorship-alert sponsorship-alert-success">
          <CheckCircle2 size={16} />
          <span>{success}</span>
          <button
            type="button"
            onClick={() => setSuccess("")}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="sponsorship-stats-grid">
        <div className="sponsorship-stat-card">
          <div className="sponsorship-stat-icon sponsors-icon">
            <Users size={19} />
          </div>
          <div className="sponsorship-stat-content">
            <span>Active Sponsors</span>
            <strong>{summary.sponsors}</strong>
            <small>Excluding cancelled records</small>
          </div>
        </div>

        <div className="sponsorship-stat-card">
          <div className="sponsorship-stat-icon pledged-icon">
            <Handshake size={19} />
          </div>
          <div className="sponsorship-stat-content">
            <span>Total Pledged</span>
            <strong>{currency(summary.totalPledged)}</strong>
            <small>Committed sponsorship value</small>
          </div>
        </div>

        <div className="sponsorship-stat-card">
          <div className="sponsorship-stat-icon received-icon">
            <Wallet size={19} />
          </div>
          <div className="sponsorship-stat-content">
            <span>Amount Received</span>
            <strong>{currency(summary.totalReceived)}</strong>
            <small>Payments collected</small>
          </div>
        </div>

        <div className="sponsorship-stat-card">
          <div className="sponsorship-stat-icon outstanding-icon">
            <IndianRupee size={19} />
          </div>
          <div className="sponsorship-stat-content">
            <span>Outstanding</span>
            <strong>{currency(summary.outstanding)}</strong>
            <small>Pending collection</small>
          </div>
        </div>
      </div>

      {/* Search and filters */}
      <div className="sponsorship-toolbar">
        <div className="sponsorship-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search sponsor, contact or event..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="sponsorship-filter">
          <CalendarDays size={15} />
          <select
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
            aria-label="Filter by event"
          >
            <option value="all">All events</option>
            {events.map((event) => {
              const id = getEventId(event);
              if (!id) return null;

              return (
                <option key={id} value={String(id)}>
                  {getEventName(event)}
                </option>
              );
            })}
          </select>
        </div>

        <div className="sponsorship-filter">
          <Filter size={15} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by payment status"
          >
            <option value="all">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <span className="sponsorship-result-count">
          {visibleCount} {visibleCount === 1 ? "record" : "records"}
        </span>
      </div>

      {/* Sponsorship cards */}
      <section className="sponsorship-records-section">
        <div className="sponsorship-section-heading">
          <div>
            <h3>Sponsorship Records</h3>
            <p>View and manage contributions from your sponsors.</p>
          </div>
        </div>

        {loading ? (
          <div className="sponsorship-loading">
            <RefreshCw size={22} className="sponsorship-spin" />
            <span>Loading sponsorship records...</span>
          </div>
        ) : filteredSponsorships.length === 0 ? (
          <div className="sponsorship-empty">
            <div className="sponsorship-empty-icon">
              <Handshake size={28} />
            </div>
            <h3>No sponsorship records found</h3>
            <p>
              {sponsorships.length === 0
                ? "Start by adding a sponsor to one of your events."
                : "Try changing your search or filter settings."}
            </p>

            {sponsorships.length === 0 && (
              <button
                type="button"
                className="sponsorship-primary-button"
                onClick={openCreateForm}
                disabled={events.length === 0}
              >
                <Plus size={15} />
                Add First Sponsor
              </button>
            )}
          </div>
        ) : (
          <div className="sponsorship-grid">
            {filteredSponsorships.map((item) => {
              const id = getSponsorshipId(item);
              const pledged = Number(item.pledged_amount || 0);
              const received = Number(item.amount_received || 0);
              const balance = Math.max(pledged - received, 0);
              const status = getPaymentStatus(item);
              const progress =
                pledged > 0
                  ? Math.min((received / pledged) * 100, 100)
                  : 0;

              return (
                <article className="sponsorship-card" key={id}>
                  <div className="sponsorship-card-top">
                    <div className="sponsorship-sponsor-identity">
                      <div className="sponsorship-avatar">
                        {(item.sponsor_name || "S")
                          .trim()
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div className="sponsorship-sponsor-heading">
                        <h4>{item.sponsor_name || "Unnamed sponsor"}</h4>
                        <span>
                          {item.contact_name || "No contact person"}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`sponsorship-status ${getStatusClass(status)}`}
                    >
                      {getStatusIcon(status)}
                      {status}
                    </span>
                  </div>

                  <div className="sponsorship-card-event">
                    <Building2 size={14} />
                    <span>{item.event_name || "Event"}</span>
                  </div>

                  <div className="sponsorship-card-meta">
                    <span
                      className={`sponsorship-tier tier-${getTierClass(
                        item.tier
                      )}`}
                    >
                      {item.tier || "Custom"} Sponsor
                    </span>
                    {item.contact_email && (
                      <span className="sponsorship-contact">
                        <Mail size={13} />
                        {item.contact_email}
                      </span>
                    )}
                    {item.contact_phone && (
                      <span className="sponsorship-contact">
                        <Phone size={13} />
                        {item.contact_phone}
                      </span>
                    )}
                  </div>

                  <div className="sponsorship-card-financials">
                    <div>
                      <span>Pledged</span>
                      <strong>{currency(pledged)}</strong>
                    </div>
                    <div>
                      <span>Received</span>
                      <strong className="received-value">
                        {currency(received)}
                      </strong>
                    </div>
                    <div>
                      <span>Balance</span>
                      <strong className="balance-value">
                        {currency(balance)}
                      </strong>
                    </div>
                  </div>

                  <div className="sponsorship-progress">
                    <div className="sponsorship-progress-label">
                      <span>Payment progress</span>
                      <strong>{Math.round(progress)}%</strong>
                    </div>
                    <div className="sponsorship-progress-track">
                      <div
                        className="sponsorship-progress-fill"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {item.benefits && (
                    <div className="sponsorship-card-description">
                      <FileText size={14} />
                      <p>{item.benefits}</p>
                    </div>
                  )}

                  <div className="sponsorship-card-actions">
                    <button
                      type="button"
                      className="sponsorship-secondary-button"
                      onClick={() => openEditForm(item)}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>

                    <button
                      type="button"
                      className="sponsorship-danger-button"
                      onClick={() => handleDelete(item)}
                      disabled={deletingId === id}
                    >
                      {deletingId === id ? (
                        <RefreshCw
                          size={14}
                          className="sponsorship-spin"
                        />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Add / edit modal */}
      {showForm && (
        <div
          className="sponsorship-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <div
            className="sponsorship-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sponsorship-form-title"
          >
            <div className="sponsorship-modal-heading">
              <div>
                <p className="sponsorship-eyebrow">
                  <Handshake size={14} />
                  SPONSORSHIP DETAILS
                </p>
                <h2 id="sponsorship-form-title">
                  {editingId ? "Edit Sponsorship" : "Add New Sponsor"}
                </h2>
                <p>Enter sponsor information and contribution details.</p>
              </div>

              <button
                type="button"
                className="sponsorship-modal-close"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close form"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="sponsorship-alert sponsorship-alert-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="sponsorship-form-body">
                <div className="sponsorship-form-section-title">
                  <span>01</span>
                  Event and sponsor information
                </div>

                <div className="sponsorship-form-grid">
                  <label className="sponsorship-field full-width">
                    <span>Event <b>*</b></span>
                    <select
                      name="event_id"
                      value={form.event_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select an event</option>
                      {events.map((event) => {
                        const id = getEventId(event);
                        if (!id) return null;

                        return (
                          <option key={id} value={String(id)}>
                            {getEventName(event)}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  <label className="sponsorship-field">
                    <span>Sponsor name <b>*</b></span>
                    <input
                      name="sponsor_name"
                      value={form.sponsor_name}
                      onChange={handleChange}
                      placeholder="Enter company or sponsor name"
                      minLength={2}
                      maxLength={150}
                      required
                    />
                  </label>

                  <label className="sponsorship-field">
                    <span>Contact person</span>
                    <input
                      name="contact_name"
                      value={form.contact_name}
                      onChange={handleChange}
                      placeholder="Contact person's name"
                      maxLength={100}
                    />
                  </label>

                  <label className="sponsorship-field">
                    <span><Mail size={13} /> Contact email</span>
                    <input
                      type="email"
                      name="contact_email"
                      value={form.contact_email}
                      onChange={handleChange}
                      placeholder="sponsor@example.com"
                    />
                  </label>

                  <label className="sponsorship-field">
                    <span><Phone size={13} /> Contact phone</span>
                    <input
                      type="tel"
                      name="contact_phone"
                      value={form.contact_phone}
                      onChange={handleChange}
                      placeholder="Contact number"
                      maxLength={30}
                    />
                  </label>
                </div>

                <div className="sponsorship-form-section-title">
                  <span>02</span>
                  Sponsorship and payment
                </div>

                <div className="sponsorship-form-grid">
                  <label className="sponsorship-field">
                    <span>Sponsorship tier <b>*</b></span>
                    <select
                      name="tier"
                      value={form.tier}
                      onChange={handleChange}
                      required
                    >
                      {TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="sponsorship-field">
                    <span>Payment status</span>
                    <select
                      name="status"
                      value={form.status}
                      onChange={handleChange}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Confirmed">Confirmed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                    <small>
                      Paid and Partially Paid are calculated from payment
                      amounts.
                    </small>
                  </label>

                  <label className="sponsorship-field">
                    <span>Pledged amount (₹) <b>*</b></span>
                    <div className="sponsorship-input-with-icon">
                      <IndianRupee size={15} />
                      <input
                        type="number"
                        name="pledged_amount"
                        value={form.pledged_amount}
                        onChange={handleChange}
                        placeholder="e.g. 50000"
                        min="0.01"
                        step="0.01"
                        required
                      />
                    </div>
                  </label>

                  <label className="sponsorship-field">
                    <span>Amount received (₹)</span>
                    <div className="sponsorship-input-with-icon">
                      <IndianRupee size={15} />
                      <input
                        type="number"
                        name="amount_received"
                        value={form.amount_received}
                        onChange={handleChange}
                        placeholder="e.g. 10000"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </label>
                </div>

                <div className="sponsorship-payment-preview">
                  <div>
                    <span>Current payment status</span>
                    <strong
                      className={`sponsorship-status ${getStatusClass(
                        getDerivedStatus()
                      )}`}
                    >
                      {getDerivedStatus()}
                    </strong>
                  </div>
                  <div>
                    <span>Outstanding balance</span>
                    <strong>
                      {currency(
                        Math.max(
                          Number(form.pledged_amount || 0) -
                            Number(form.amount_received || 0),
                          0
                        )
                      )}
                    </strong>
                  </div>
                </div>

                <div className="sponsorship-form-section-title">
                  <span>03</span>
                  Benefits and additional notes
                </div>

                <div className="sponsorship-form-grid">
                  <label className="sponsorship-field full-width">
                    <span><FileText size={13} /> Sponsorship benefits</span>
                    <textarea
                      name="benefits"
                      value={form.benefits}
                      onChange={handleChange}
                      placeholder="Describe the benefits offered to this sponsor..."
                      rows={3}
                      maxLength={2000}
                    />
                  </label>

                  <label className="sponsorship-field full-width">
                    <span>Internal notes</span>
                    <textarea
                      name="notes"
                      value={form.notes}
                      onChange={handleChange}
                      placeholder="Add any additional information..."
                      rows={3}
                      maxLength={2000}
                    />
                  </label>
                </div>
              </div>

              <div className="sponsorship-form-actions">
                <button
                  type="button"
                  className="sponsorship-secondary-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="sponsorship-primary-button"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <RefreshCw
                        size={15}
                        className="sponsorship-spin"
                      />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      {editingId ? "Save Changes" : "Create Sponsorship"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Sponsorships;
