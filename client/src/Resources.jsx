
import { useEffect, useMemo, useRef, useState } from "react";
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
  LogOut,
} from "lucide-react";
import "./Resources.css";

const STORAGE_KEY = "eventsphere_resources_v1";
const PAGE_SIZE = 5;

const initialResources = [
  {
    id: "R001",
    name: "Projector",
    type: "AV Equipment",
    quantity: 10,
    availableQuantity: 3,
    description: "Projector for presentations",
  },
  {
    id: "R002",
    name: "Microphone",
    type: "AV Equipment",
    quantity: 10,
    availableQuantity: 7,
    description: "Wireless microphones",
  },
  {
    id: "R003",
    name: "Laptop",
    type: "IT Equipment",
    quantity: 15,
    availableQuantity: 10,
    description: "Event laptops",
  },
  {
    id: "R004",
    name: "Chairs",
    type: "Furniture",
    quantity: 100,
    availableQuantity: 60,
    description: "Event seating",
  },
  {
    id: "R005",
    name: "Conference Table",
    type: "Furniture",
    quantity: 10,
    availableQuantity: 0,
    description: "Conference room tables",
  },
];

const resourceTypes = [
  "AV Equipment",
  "IT Equipment",
  "Equipment",
  "Staff",
  "Transport",
  "Furniture",
  "Other",
];

const emptyForm = {
  name: "",
  type: "AV Equipment",
  quantity: "",
  availableQuantity: "",
  description: "",
};

function getStatus(resource) {
  const available = Number(resource.availableQuantity) || 0;
  const total = Number(resource.quantity) || 0;

  if (available === 0) return "Unavailable";
  if (available < total) return "In Use";
  return "Available";
}

function loadResources() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === null) {
      return initialResources.map((resource) => ({ ...resource }));
    }

    const parsed = JSON.parse(saved);

    return Array.isArray(parsed)
      ? parsed.filter(
          (resource) =>
            resource &&
            resource.id != null &&
            typeof resource.name === "string"
        )
      : initialResources.map((resource) => ({ ...resource }));
  } catch {
    return initialResources.map((resource) => ({ ...resource }));
  }
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

export default function Resources({ user, onLogout }) {
  const [resources, setResources] = useState(loadResources);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [storageError, setStorageError] = useState(false);

  const formPanelRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(resources));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [resources]);

  useEffect(() => {
    if (showForm) {
      formPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [showForm, editingId]);

  const stats = useMemo(() => {
    return {
      total: resources.length,
      available: resources.filter(
        (resource) => getStatus(resource) === "Available"
      ).length,
      inUse: resources.filter(
        (resource) => getStatus(resource) === "In Use"
      ).length,
      unavailable: resources.filter(
        (resource) => getStatus(resource) === "Unavailable"
      ).length,
    };
  }, [resources]);

  const filteredResources = useMemo(() => {
    const query = search.trim().toLowerCase();

    return resources.filter((resource) => {
      const matchesSearch = [
        resource.id,
        resource.name,
        resource.type,
        resource.description,
      ].some((value) =>
        String(value ?? "").toLowerCase().includes(query)
      );

      const matchesType =
        typeFilter === "All" || resource.type === typeFilter;

      const matchesStatus =
        statusFilter === "All" || getStatus(resource) === statusFilter;

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

  const userName = user?.name || "User";
  const userRole = user?.role || "Member";

  function openAddForm() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditForm(resource) {
    setEditingId(resource.id);

    setForm({
      name: resource.name ?? "",
      type: resource.type ?? "Other",
      quantity: String(resource.quantity ?? ""),
      availableQuantity: String(resource.availableQuantity ?? ""),
      description: resource.description ?? "",
    });

    setError("");
    setNotice("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setError("");
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => {
      const next = { ...previous, [name]: value };

      if (
        name === "quantity" &&
        next.availableQuantity !== "" &&
        Number(next.availableQuantity) > Number(value)
      ) {
        next.availableQuantity = value;
      }

      return next;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const name = form.name.trim();
    const quantity = Number(form.quantity);
    const availableQuantity = Number(form.availableQuantity);

    if (!name) {
      setError("Please enter a resource name.");
      return;
    }

    if (
      form.quantity.trim() === "" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      setError("Total quantity must be a positive whole number.");
      return;
    }

    if (
      form.availableQuantity.trim() === "" ||
      !Number.isSafeInteger(availableQuantity) ||
      availableQuantity < 0 ||
      availableQuantity > quantity
    ) {
      setError(
        "Available quantity must be a whole number between zero and total quantity."
      );
      return;
    }

    const resourceData = {
      name,
      type: form.type,
      quantity,
      availableQuantity,
      description: form.description.trim(),
    };

    if (editingId !== null) {
      setResources((previous) =>
        previous.map((resource) =>
          resource.id === editingId
            ? { ...resource, ...resourceData }
            : resource
        )
      );

      setNotice("Resource updated successfully.");
    } else {
      const maxNumber = resources.reduce((max, resource) => {
        const match = String(resource.id).match(/^R(\d+)$/i);
        return Math.max(max, match ? Number(match[1]) : 0);
      }, 0);

      const newResource = {
        id: `R${String(maxNumber + 1).padStart(3, "0")}`,
        ...resourceData,
      };

      setResources((previous) => [...previous, newResource]);

      // Calculate the new page using the current filter results.
      const nextCount = filteredResources.length + 1;
      setPage(Math.max(1, Math.ceil(nextCount / PAGE_SIZE)));

      setNotice("Resource added successfully.");
    }

    setForm({ ...emptyForm });
    setEditingId(null);
    setShowForm(false);
  }

  function deleteResource(resource) {
    const confirmed = window.confirm(
      `Delete "${resource.name}" (${resource.id})? This action cannot be undone.`
    );

    if (!confirmed) return;

    setResources((previous) =>
      previous.filter((item) => item.id !== resource.id)
    );

    if (editingId === resource.id) {
      closeForm();
    }

    setPage(1);
    setError("");
    setNotice(`"${resource.name}" was deleted.`);
  }

  function resetFilters() {
    setSearch("");
    setTypeFilter("All");
    setStatusFilter("All");
    setPage(1);
  }

  function handleLogout() {
    if (typeof onLogout === "function") {
      onLogout();
    }
  }

  const firstItem =
    filteredResources.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const lastItem = Math.min(
    currentPage * PAGE_SIZE,
    filteredResources.length
  );

  return (
    <section className="resource-page">
      <header className="resource-topbar">
        <div className="resource-context">
          <span className="resource-context-dot" />
          <span>Workspace overview</span>
        </div>

        <div className="resource-profile">
          <div className="resource-avatar" aria-hidden="true">
            {userName.charAt(0).toUpperCase()}
          </div>

          <div className="resource-profile-details">
            <strong>{userName}</strong>
            <small>{userRole}</small>
          </div>

          {typeof onLogout === "function" && (
            <button
              type="button"
              className="resource-logout"
              onClick={handleLogout}
            >
              <LogOut size={15} />
              <span>Logout</span>
            </button>
          )}
        </div>
      </header>

      <header className="resource-header">
        <div>
          <p className="resource-eyebrow">EVENTSPHERE WORKSPACE</p>
          <h1>Resource Management</h1>
          <p className="resource-subtitle">
            Manage event resources, track availability, and keep your
            inventory organized.
          </p>
        </div>

        <button
          type="button"
          className="resource-primary"
          onClick={showForm ? closeForm : openAddForm}
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? "Cancel" : "Add resource"}
        </button>
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

      {storageError && (
        <div
          className="resource-message resource-message-error"
          role="alert"
        >
          <X size={18} />
          <p>
            Your browser could not save resources locally. Changes may not
            persist after refreshing.
          </p>
          <button
            type="button"
            onClick={() => setStorageError(false)}
            aria-label="Dismiss storage warning"
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
          label="In use"
          value={stats.inUse}
          color="red"
          detail="Partially allocated"
        />

        <StatCard
          icon={Clock}
          label="Unavailable"
          value={stats.unavailable}
          color="purple"
          detail="No units available"
        />
      </section>

      {showForm && (
        <section
          className="resource-form-panel"
          ref={formPanelRef}
        >
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
                  maxLength={100}
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
                  {resourceTypes.map((type) => (
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
                  min="1"
                  step="1"
                  placeholder="Enter total quantity"
                  required
                />
              </label>

              <label className="resource-field">
                <span>Available quantity *</span>
                <input
                  type="number"
                  name="availableQuantity"
                  value={form.availableQuantity}
                  onChange={handleChange}
                  min="0"
                  max={form.quantity || undefined}
                  step="1"
                  placeholder="Enter available units"
                  required
                />
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
                maxLength={500}
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
                  setForm({ ...emptyForm });
                  setError("");
                }}
              >
                Clear fields
              </button>

              <button
                type="button"
                className="resource-secondary"
                onClick={closeForm}
              >
                Cancel
              </button>

              <button type="submit" className="resource-primary">
                {editingId !== null ? "Save changes" : "Save resource"}
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
              {resourceTypes.map((type) => (
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
              <option value="Available">Available</option>
              <option value="In Use">In use</option>
              <option value="Unavailable">Unavailable</option>
            </select>

            <button
              type="button"
              className="resource-secondary resource-refresh"
              onClick={resetFilters}
            >
              <RefreshCw size={15} />
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
                <th>Total quantity</th>
                <th>Available quantity</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {pageResources.map((resource, index) => {
                const status = getStatus(resource);

                return (
                  <tr key={resource.id}>
                    <td className="resource-row-number">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </td>

                    <td>
                      <strong className="resource-name">
                        {resource.name}
                      </strong>

                      {resource.description && (
                        <small className="resource-description">
                          {resource.description}
                        </small>
                      )}
                    </td>

                    <td>{resource.type}</td>
                    <td>{Number(resource.quantity).toLocaleString("en-IN")}</td>
                    <td>
                      {Number(resource.availableQuantity).toLocaleString(
                        "en-IN"
                      )}
                    </td>

                    <td>
                      <span
                        className={`resource-status ${status
                          .toLowerCase()
                          .replace(" ", "-")}`}
                      >
                        {status}
                      </span>
                    </td>

                    <td>
                      <div className="resource-row-actions">
                        <button
                          type="button"
                          className="resource-icon-action resource-edit-action"
                          onClick={() => openEditForm(resource)}
                          aria-label={`Edit ${resource.name}`}
                          title="Edit resource"
                        >
                          <Pencil size={14} />
                        </button>

                        <button
                          type="button"
                          className="resource-icon-action resource-delete-action"
                          onClick={() => deleteResource(resource)}
                          aria-label={`Delete ${resource.name}`}
                          title="Delete resource"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {pageResources.length === 0 && (
                <tr>
                  <td colSpan={7} className="resource-empty">
                    <span className="resource-empty-icon">
                      <Package size={22} />
                    </span>
                    <strong>No resources found</strong>
                    <p>Try another name or change your filters.</p>
                    <button
                      type="button"
                      className="resource-secondary"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </button>
                  </td>
                </tr>
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
