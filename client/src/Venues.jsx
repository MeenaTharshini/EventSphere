
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getVenues,
  createVenue,
  updateVenue,
  deleteVenue,
} from "./api";
import "./Venues.css";

const emptyVenue = {
  name: "",
  address: "",
  city: "",
  state: "",
  country: "",
  postal_code: "",
  capacity: "0",
  cost_per_day: "0",
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

const formatNumber = (value) =>
  (Number(value) || 0).toLocaleString("en-IN");

const getLocation = (venue) =>
  [venue.city, venue.state, venue.country]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ") || venue.address || "Not specified";

const isBooked = (venue) =>
  String(venue.availability || "").toLowerCase() === "booked";

export default function Venues({ user }) {
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyVenue });

  const userRole = String(
  user?.role ?? user?.user?.role ?? ""
)
  .trim()
  .toLowerCase();

const canManage = ["admin", "administrator", "organizer"].includes(
  userRole
);
  const loadVenues = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await getVenues();
      const records = Array.isArray(data)
        ? data
        : Array.isArray(data?.venues)
          ? data.venues
          : [];

      setVenues(records);
    } catch (err) {
      setError(err.message || "Unable to load venues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const filteredVenues = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return venues;

    return venues.filter((venue) =>
      [
        venue.name,
        venue.address,
        venue.city,
        venue.state,
        venue.country,
        venue.postal_code,
      ].some((value) =>
        String(value || "").toLowerCase().includes(query)
      )
    );
  }, [venues, search]);

  const totalCapacity = venues.reduce(
    (total, venue) => total + (Number(venue.capacity) || 0),
    0
  );

  const bookedCount = venues.filter(isBooked).length;
  const availableCount = venues.length - bookedCount;

  function updateField(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  function openAddForm() {
    setEditingId(null);
    setForm({ ...emptyVenue });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEditForm(venue) {
    setEditingId(venue.id);
    setForm({
      name: venue.name ?? "",
      address: venue.address ?? "",
      city: venue.city ?? "",
      state: venue.state ?? "",
      country: venue.country ?? "",
      postal_code: venue.postal_code ?? "",
      capacity: String(venue.capacity ?? 0),
      cost_per_day: String(venue.cost_per_day ?? 0),
    });

    setError("");
    setNotice("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyVenue });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!form.name.trim()) {
      setError("Please enter a venue name.");
      return;
    }

    const capacity = Number(form.capacity);
    const cost = Number(form.cost_per_day);

    if (
      form.capacity.trim() === "" ||
      !Number.isFinite(capacity) ||
      capacity < 0 ||
      !Number.isInteger(capacity)
    ) {
      setError("Capacity must be a non-negative whole number.");
      return;
    }

    if (
      form.cost_per_day.trim() === "" ||
      !Number.isFinite(cost) ||
      cost < 0
    ) {
      setError("Cost per day must be a valid non-negative amount.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim(),
      postal_code: form.postal_code.trim(),
      capacity,
      cost_per_day: cost,
    };

    setSaving(true);

    try {
      if (editingId !== null) {
        await updateVenue(editingId, payload);
        setNotice("Venue updated successfully.");
      } else {
        await createVenue(payload);
        setNotice("Venue added successfully.");
      }

      closeForm();
      await loadVenues();
    } catch (err) {
      setError(err.message || "Unable to save venue.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(venue) {
    const confirmed = window.confirm(
      `Delete "${venue.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setError("");
    setNotice("");
    setDeletingId(venue.id);

    try {
      await deleteVenue(venue.id);
      setNotice(`"${venue.name}" was deleted.`);
      await loadVenues();
    } catch (err) {
      setError(err.message || "Unable to delete venue.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="venues-page">
     

      <header className="venues-header">
        <div>
          <p className="venues-eyebrow">EVENTSPHERE WORKSPACE</p>
          <h1>Venue Management</h1>
          <p className="venues-subtitle">
            Manage event venues, locations, capacity, and availability.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            className="venues-primary"
            onClick={showForm ? closeForm : openAddForm}
          >
            <span aria-hidden="true">{showForm ? "×" : "＋"}</span>
            {showForm ? "Cancel" : "Add venue"}
          </button>
        )}
      </header>

      <section className="venues-summary" aria-label="Venue statistics">
        <article className="venues-stat venues-stat-blue">
          <span className="venues-stat-icon">▦</span>
          <div>
            <p>Total venues</p>
            <strong>{loading ? "…" : formatNumber(venues.length)}</strong>
            <small>Registered spaces</small>
          </div>
        </article>

        <article className="venues-stat venues-stat-green">
          <span className="venues-stat-icon">✓</span>
          <div>
            <p>Available venues</p>
            <strong>{loading ? "…" : formatNumber(availableCount)}</strong>
            <small>Not marked as booked</small>
          </div>
        </article>

        <article className="venues-stat venues-stat-red">
          <span className="venues-stat-icon">▣</span>
          <div>
            <p>Booked venues</p>
            <strong>{loading ? "…" : formatNumber(bookedCount)}</strong>
            <small>Marked as booked</small>
          </div>
        </article>

        <article className="venues-stat venues-stat-purple">
          <span className="venues-stat-icon">♙</span>
          <div>
            <p>Total capacity</p>
            <strong>{loading ? "…" : formatNumber(totalCapacity)}</strong>
            <small>Combined guest capacity</small>
          </div>
        </article>
      </section>

      {notice && (
        <div className="venues-message venues-message-success" role="status">
          <span>✓</span>
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="venues-message venues-message-error" role="alert">
          <span>!</span>
          <p>{error}</p>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {showForm && canManage && (
        <form className="venues-form" onSubmit={handleSubmit}>
          <div className="venues-form-heading">
            <div>
              <p className="venues-eyebrow">
                {editingId !== null ? "UPDATE DETAILS" : "NEW LOCATION"}
              </p>
              <h2>{editingId !== null ? "Edit venue" : "Add a new venue"}</h2>
              <p>Enter the venue information below.</p>
            </div>

            <button
              type="button"
              className="venues-close"
              onClick={closeForm}
              disabled={saving}
              aria-label="Close form"
            >
              ×
            </button>
          </div>

          <div className="venues-form-grid">
            <label className="venues-field">
              <span>Venue name *</span>
              <input
                name="name"
                value={form.name}
                onChange={updateField}
                required
                maxLength={150}
                placeholder="e.g. Grand Convention Hall"
              />
            </label>

            <label className="venues-field">
              <span>Street address</span>
              <input
                name="address"
                value={form.address}
                onChange={updateField}
                placeholder="Enter street address"
              />
            </label>

            <label className="venues-field">
              <span>City</span>
              <input name="city" value={form.city} onChange={updateField} placeholder="Enter city" />
            </label>

            <label className="venues-field">
              <span>State</span>
              <input name="state" value={form.state} onChange={updateField} placeholder="Enter state" />
            </label>

            <label className="venues-field">
              <span>Country</span>
              <input name="country" value={form.country} onChange={updateField} placeholder="Enter country" />
            </label>

            <label className="venues-field">
              <span>PIN / Postal code</span>
              <input name="postal_code" value={form.postal_code} onChange={updateField} placeholder="Enter postal code" />
            </label>

            <label className="venues-field">
              <span>Guest capacity *</span>
              <input
                type="number"
                name="capacity"
                min="0"
                step="1"
                value={form.capacity}
                onChange={updateField}
                required
              />
            </label>

            <label className="venues-field">
              <span>Cost per day (₹) *</span>
              <input
                type="number"
                name="cost_per_day"
                min="0"
                step="0.01"
                value={form.cost_per_day}
                onChange={updateField}
                required
              />
            </label>
          </div>

          <div className="venues-form-actions">
            <button type="button" className="venues-secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="venues-primary" disabled={saving}>
              {saving ? "Saving..." : editingId !== null ? "Save changes" : "Save venue"}
            </button>
          </div>
        </form>
      )}

      <section className="venues-directory">
        <div className="venues-toolbar">
          <div>
            <h2>Venue list</h2>
            <p>
              {loading
                ? "Loading registered venues..."
                : `${filteredVenues.length} venue(s) displayed`}
            </p>
          </div>

          <div className="venues-toolbar-actions">
            <label className="venues-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search venues"
                placeholder="Search by name or location..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <button
              type="button"
              className="venues-secondary venues-refresh"
              onClick={loadVenues}
              disabled={loading}
            >
              ↻ {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="venues-empty">
            <span className="venues-spinner" />
            <p>Loading venue directory...</p>
          </div>
        ) : filteredVenues.length === 0 ? (
          <div className="venues-empty">
            <span className="venues-empty-icon">⌖</span>
            <h3>{venues.length === 0 ? "No venues added yet" : "No matching venues"}</h3>
            <p>
              {search
                ? "Try another name, city, state, or postal code."
                : "Add a venue to start building your directory."}
            </p>
            {canManage && venues.length === 0 && (
              <button type="button" className="venues-primary" onClick={openAddForm}>
                ＋ Add your first venue
              </button>
            )}
          </div>
        ) : (
          <div className="venues-table-wrap">
            <table className="venues-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Venue name</th>
                  <th>Location</th>
                  <th>Capacity</th>
                  <th>Cost per day (₹)</th>
                  <th>Availability</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredVenues.map((venue, index) => (
                  <tr key={venue.id}>
                    <td className="venues-row-number">{index + 1}</td>

                    <td>
                      <strong className="venues-table-name">{venue.name}</strong>
                      {venue.address && (
                        <small className="venues-table-address">{venue.address}</small>
                      )}
                    </td>

                    <td>{getLocation(venue)}</td>
                    <td>{formatNumber(venue.capacity)}</td>
                    <td className="venues-cost-cell">{formatMoney(venue.cost_per_day)}</td>

                    <td>
                      <span className={`venues-availability ${isBooked(venue) ? "is-booked" : "is-available"}`}>
                        {isBooked(venue) ? "Booked" : "Available"}
                      </span>
                    </td>

                    <td>
                      {canManage ? (
                        <div className="venues-row-actions">
                          <button
                            type="button"
                            className="venues-icon-action venues-edit-action"
                            title="Edit venue"
                            aria-label={`Edit ${venue.name}`}
                            onClick={() => openEditForm(venue)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="venues-icon-action venues-delete-action"
                            title="Delete venue"
                            aria-label={`Delete ${venue.name}`}
                            disabled={deletingId === venue.id}
                            onClick={() => handleDelete(venue)}
                          >
                            {deletingId === venue.id ? "…" : "×"}
                          </button>
                        </div>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredVenues.length > 0 && (
          <footer className="venues-directory-footer">
            <span>
              Showing {filteredVenues.length} of {venues.length} venue(s)
            </span>
            <span>EventSphere · Find your perfect space</span>
          </footer>
        )}
      </section>

      <footer className="venues-page-footer">
        <span>© {new Date().getFullYear()} EventSphere</span>
        <span>Every great event starts with the right venue.</span>
      </footer>
    </section>
  );
}
