
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Package,
  CheckCircle2,
  Users,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  RefreshCw,
} from "lucide-react";

import {
  getResources,
  createResource,
  updateResource,
  deleteResource,
} from "./api";

import "./Resources.css";

const PAGE_SIZE = 5;

const RESOURCE_TYPES = [
  "Audio",
  "Lighting",
  "Furniture",
  "Catering",
  "Decoration",
  "Photography",
  "Video",
  "Other",
];

const AVAILABILITY_STATUSES = [
  "Available",
  "Unavailable",
  "Maintenance",
];

const EMPTY_FORM = {
  name: "",
  type: "Other",
  description: "",
  quantity: "1",
  unit_cost: "0",
  availability_status: "Available",
};

/* -------------------- Helpers -------------------- */

function getId(resource) {
  const id =
    resource?.id ??
    resource?._id ??
    resource?.resource_id;

  return id == null ? "" : String(id);
}

function getArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.resources)) return data.resources;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.resources)) {
    return data.data.resources;
  }

  return [];
}

function getErrorMessage(error, fallback) {
  const message = error?.message;

  return typeof message === "string" && message.trim()
    ? message
    : fallback;
}

function normalizeAvailability(value) {
  const normalized = String(value ?? "Available")
    .trim()
    .toLowerCase();

  if (normalized === "available") return "Available";
  if (normalized === "unavailable") return "Unavailable";
  if (normalized === "maintenance") return "Maintenance";

  return "Available";
}

function getStatus(resource) {
  return normalizeAvailability(resource?.availability_status);
}

function getStatusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function formatMoney(value) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getResourceName(resource) {
  return resource?.name ?? "Unnamed resource";
}

function StatCard({ icon: Icon, label, value, color, detail }) {
  return (
    <article className={`resource-stat resource-stat-${color}`}>
      <span className="resource-stat-icon" aria-hidden="true">
        <Icon size={19} />
      </span>

      <div className="resource-stat-content">
        <p>{label}</p>
        <strong>{value.toLocaleString("en-IN")}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

/* -------------------- Resources Component -------------------- */

export default function Resources({ user, onLogout }) {
  const [resources, setResources] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [page, setPage] = useState(1);

  const userRole = String(user?.role ?? "Member").trim().toLowerCase();

  const canManageResources = [
    "admin",
    "administrator",
    "organizer",
  ].includes(userRole);

  /* -------------------- Load Resources -------------------- */

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await getResources();
      setResources(getArray(result));
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load resources. Check that the Python backend is running."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  /* -------------------- Statistics -------------------- */

  const stats = useMemo(() => {
    return {
      total: resources.length,

      available: resources.filter(
        (resource) => getStatus(resource) === "Available"
      ).length,

      unavailable: resources.filter(
        (resource) => getStatus(resource) === "Unavailable"
      ).length,

      maintenance: resources.filter(
        (resource) => getStatus(resource) === "Maintenance"
      ).length,
    };
  }, [resources]);

  /* -------------------- Search and Filters -------------------- */

  const filteredResources = useMemo(() => {
    const query = search.trim().toLowerCase();

    return resources.filter((resource) => {
      const matchesSearch = [
        getId(resource),
        resource?.name,
        resource?.type,
        resource?.description,
        resource?.availability_status,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      );

      const matchesType =
        typeFilter === "All" || resource?.type === typeFilter;

      const matchesStatus =
        statusFilter === "All" ||
        getStatus(resource) === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [resources, search, typeFilter, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredResources.length / PAGE_SIZE)
  );

  const currentPage = Math.min(page, totalPages);

  const pageResources = filteredResources.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    setPage((previous) => Math.min(previous, totalPages));
  }, [totalPages]);

  /* -------------------- Form Helpers -------------------- */

  function openAddForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditForm(resource) {
    const id = getId(resource);

    if (!id) {
      setError("Cannot edit this resource because its ID is missing.");
      return;
    }

    setEditingId(id);

    setForm({
      name: resource?.name ?? "",
      type: RESOURCE_TYPES.includes(resource?.type)
        ? resource.type
        : "Other",
      description: resource?.description ?? "",
      quantity: String(resource?.quantity ?? 1),
      unit_cost: String(resource?.unit_cost ?? 0),
      availability_status: getStatus(resource),
    });

    setError("");
    setNotice("");
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  /* -------------------- Validation -------------------- */

  function validateForm() {
    if (!form.name.trim()) {
      return "Please enter a resource name.";
    }

    if (form.name.trim().length > 150) {
      return "The resource name cannot exceed 150 characters.";
    }

    if (!RESOURCE_TYPES.includes(form.type)) {
      return "Please select a valid resource type.";
    }

    if (
      form.quantity.trim() === "" ||
      !Number.isSafeInteger(Number(form.quantity)) ||
      Number(form.quantity) < 0
    ) {
      return "Quantity must be a non-negative whole number.";
    }

    if (
      form.unit_cost.trim() === "" ||
      !Number.isFinite(Number(form.unit_cost)) ||
      Number(form.unit_cost) < 0
    ) {
      return "Please enter a valid non-negative unit cost.";
    }

    if (!AVAILABILITY_STATUSES.includes(form.availability_status)) {
      return "Please select a valid availability status.";
    }

    if (form.description.length > 1000) {
      return "The description is too long.";
    }

    return "";
  }

  /* -------------------- Create / Update -------------------- */

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setNotice("");

    if (!canManageResources) {
      setError("You do not have permission to manage resources.");
      return;
    }

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = {
      name: form.name.trim(),
      type: form.type,
      description: form.description.trim(),
      quantity: Number(form.quantity),
      unit_cost: Number(form.unit_cost),
      availability_status: form.availability_status,
    };

    setSaving(true);

    try {
      if (editingId !== null) {
        await updateResource(editingId, payload);
        setNotice("Resource updated successfully.");
      } else {
        await createResource(payload);
        setNotice("Resource added successfully.");
      }

      setShowForm(false);
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
      setPage(1);

      await loadResources();
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to save the resource. Check the form and backend."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  /* -------------------- Delete -------------------- */

  async function handleDelete(resource) {
    if (!canManageResources) {
      setError("You do not have permission to delete resources.");
      return;
    }

    const id = getId(resource);

    if (!id) {
      setError("Cannot delete this resource because its ID is missing.");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${getResourceName(resource)}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setError("");
    setNotice("");
    setDeletingId(id);

    try {
      await deleteResource(id);

      if (editingId === id) {
        setShowForm(false);
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
      }

      setNotice(`"${getResourceName(resource)}" was deleted.`);
      await loadResources();
    } catch (err) {
      setError(
        getErrorMessage(err, "Unable to delete the resource.")
      );
    } finally {
      setDeletingId(null);
    }
  }

  /* -------------------- Reset Filters -------------------- */

  function resetFilters() {
    setSearch("");
    setTypeFilter("All");
    setStatusFilter("All");
    setPage(1);
  }

  const firstItem =
    filteredResources.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const lastItem = Math.min(
    currentPage * PAGE_SIZE,
    filteredResources.length
  );

  /* -------------------- Render -------------------- */

  return (
    <section className="resource-page">
      <header className="resource-header">
        <div>
          <p className="resource-eyebrow">EVENTSPHERE WORKSPACE</p>
          <h1>Resource Management</h1>
          <p className="resource-subtitle">
            Manage event resources, track availability, and keep your
            inventory organized.
          </p>
        </div>

        {canManageResources && (
          <button
            type="button"
            className="resource-primary"
            onClick={showForm ? closeForm : openAddForm}
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Cancel" : "Add resource"}
          </button>
        )}
      </header>

      {notice && (
        <div
          className="resource-message resource-message-success"
          role="status"
        >
          <CheckCircle2 size={18} />
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {error && !showForm && (
        <div
          className="resource-message resource-message-error"
          role="alert"
        >
          <X size={18} />
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section
        className="resource-summary"
        aria-label="Resource statistics"
      >
        <StatCard
          icon={Package}
          label="Total resources"
          value={stats.total}
          color="blue"
          detail="Registered inventory"
        />

        <StatCard
          icon={CheckCircle2}
          label="Available"
          value={stats.available}
          color="green"
          detail="Ready to use"
        />

        <StatCard
          icon={Users}
          label="Unavailable"
          value={stats.unavailable}
          color="red"
          detail="Not available for use"
        />

        <StatCard
          icon={Clock}
          label="Maintenance"
          value={stats.maintenance}
          color="purple"
          detail="Under maintenance"
        />
      </section>

      {showForm && (
        <section className="resource-form-panel">
          <div className="resource-form-heading">
            <div>
              <p className="resource-eyebrow">
                {editingId !== null
                  ? "UPDATE INVENTORY"
                  : "NEW INVENTORY ITEM"}
              </p>

              <h2>
                {editingId !== null
                  ? "Edit resource"
                  : "Add a new resource"}
              </h2>

              <p>Enter the resource information below.</p>
            </div>

            <button
              type="button"
              className="resource-close"
              onClick={closeForm}
              disabled={saving}
              aria-label="Close form"
            >
              <X size={17} />
            </button>
          </div>

          <form className="resource-form" onSubmit={handleSubmit}>
            <div className="resource-form-grid">
              <label className="resource-field">
                <span>Resource name *</span>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="e.g. Wireless microphone"
                  maxLength={150}
                  required
                />
              </label>

              <label className="resource-field">
                <span>Resource type *</span>
                <select
                  name="type"
                  value={form.type}
                  onChange={handleChange}
                  required
                >
                  {RESOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="resource-field">
                <span>Total quantity *</span>
                <input
                  type="number"
                  name="quantity"
                  value={form.quantity}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  placeholder="Enter total quantity"
                  required
                />
              </label>

              <label className="resource-field">
                <span>Unit cost (₹) *</span>
                <input
                  type="number"
                  name="unit_cost"
                  value={form.unit_cost}
                  onChange={handleChange}
                  min="0"
                  step="0.01"
                  placeholder="Enter cost per unit"
                  required
                />
              </label>

              <label className="resource-field">
                <span>Availability status *</span>
                <select
                  name="availability_status"
                  value={form.availability_status}
                  onChange={handleChange}
                  required
                >
                  {AVAILABILITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="resource-field resource-description-field">
              <span>Description</span>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Enter a short description (optional)"
                rows={3}
                maxLength={1000}
              />
            </label>

            {error && (
              <p className="resource-form-error" role="alert">
                {error}
              </p>
            )}

            <div className="resource-form-actions">
              <button
                type="button"
                className="resource-secondary"
                onClick={() => {
                  setForm({ ...EMPTY_FORM });
                  setError("");
                }}
                disabled={saving}
              >
                Clear fields
              </button>

              <button
                type="button"
                className="resource-secondary"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="resource-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId !== null
                    ? "Save changes"
                    : "Save resource"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="resource-directory">
        <div className="resource-toolbar">
          <div className="resource-toolbar-title">
            <h2>Resource list</h2>
            <p>{filteredResources.length} resource(s) displayed</p>
          </div>

          <div className="resource-toolbar-actions">
            <label className="resource-search">
              <Search size={16} aria-hidden="true" />

              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search resources..."
                aria-label="Search resources"
              />

              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </label>

            <select
              className="resource-filter"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter resource type"
            >
              <option value="All">All types</option>
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <select
              className="resource-filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter resource status"
            >
              <option value="All">All statuses</option>
              {AVAILABILITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="resource-secondary resource-refresh"
              onClick={loadResources}
              disabled={loading}
            >
              <RefreshCw size={15} />
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              type="button"
              className="resource-secondary resource-refresh"
              onClick={resetFilters}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Resource name</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Unit cost</th>
                <th>Status</th>
                {canManageResources && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={canManageResources ? 7 : 6}
                    className="resource-empty"
                  >
                    Loading resources...
                  </td>
                </tr>
              ) : pageResources.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManageResources ? 7 : 6}
                    className="resource-empty"
                  >
                    <span className="resource-empty-icon">
                      <Package size={22} />
                    </span>

                    <strong>No resources found</strong>

                    <p>
                      {resources.length === 0
                        ? "Add a resource to get started."
                        : "Try another name or change your filters."}
                    </p>

                    {canManageResources && resources.length === 0 && (
                      <button
                        type="button"
                        className="resource-primary"
                        onClick={openAddForm}
                      >
                        <Plus size={15} />
                        Add resource
                      </button>
                    )}

                    {resources.length > 0 && (
                      <button
                        type="button"
                        className="resource-secondary"
                        onClick={resetFilters}
                      >
                        Reset filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                pageResources.map((resource, index) => {
                  const id = getId(resource);
                  const status = getStatus(resource);

                  return (
                    <tr key={id || `${resource.name}-${index}`}>
                      <td className="resource-row-number">
                        {(currentPage - 1) * PAGE_SIZE + index + 1}
                      </td>

                      <td>
                        <strong className="resource-name">
                          {getResourceName(resource)}
                        </strong>

                        {resource.description && (
                          <small className="resource-description">
                            {resource.description}
                          </small>
                        )}
                      </td>

                      <td>{resource.type || "Other"}</td>

                      <td>
                        {Number(resource.quantity ?? 0).toLocaleString(
                          "en-IN"
                        )}
                      </td>

                      <td>{formatMoney(resource.unit_cost)}</td>

                      <td>
                        <span
                          className={`resource-status ${getStatusClass(status)}`}
                        >
                          {status}
                        </span>
                      </td>

                      {canManageResources && (
                        <td>
                          <div className="resource-row-actions">
                            <button
                              type="button"
                              className="resource-icon-action resource-edit-action"
                              onClick={() => openEditForm(resource)}
                              aria-label={`Edit ${getResourceName(resource)}`}
                              title="Edit resource"
                            >
                              <Pencil size={14} />
                            </button>

                            <button
                              type="button"
                              className="resource-icon-action resource-delete-action"
                              onClick={() => handleDelete(resource)}
                              disabled={deletingId === id}
                              aria-label={`Delete ${getResourceName(resource)}`}
                              title="Delete resource"
                            >
                              {deletingId === id ? (
                                <RefreshCw size={14} />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="resource-directory-footer">
          <span>
            Showing {firstItem}–{lastItem} of {filteredResources.length}{" "}
            resource(s)
          </span>

          <div className="resource-pagination">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() =>
                setPage((previous) => Math.max(1, previous - 1))
              }
              aria-label="Previous page"
            >
              ‹
            </button>

            <span>
              {currentPage} / {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() =>
                setPage((previous) =>
                  Math.min(totalPages, previous + 1)
                )
              }
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </footer>
      </section>

      <footer className="resource-page-footer">
        <span>© {new Date().getFullYear()} EventSphere</span>
        <span>Plan thoughtfully. Make every moment count.</span>
      </footer>
    </section>
  );
}