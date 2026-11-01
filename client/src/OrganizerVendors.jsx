import { useCallback, useEffect, useMemo, useState } from "react";
import { getVendors, approveVendor, rejectVendor } from "./api";
import "./OrganizerVendors.css";

const FILTERS = ["All", "Pending", "Approved", "Rejected"];

function getArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  for (const key of ["vendors", "profiles", "items"]) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(data?.data?.[key])) return data.data[key];
  }
  return [];
}
function idOf(v) {
  const id = v?.id ?? v?._id ?? v?.vendor_id ?? v?.profile_id;
  return id == null ? "" : String(id);
}
function nameOf(v) {
  return v?.business_name ?? v?.businessName ?? v?.name ?? "Unnamed business";
}
function categoryOf(v) {
  return v?.category ?? v?.service_category ?? "Other";
}
function statusOf(v) {
  const s = String(v?.status ?? v?.approval_status ?? v?.profile_status ?? "Pending").toLowerCase();
  if (["approved", "accepted", "active"].includes(s)) return "Approved";
  if (["rejected", "declined"].includes(s)) return "Rejected";
  return "Pending";
}
function locationOf(v) {
  return [v?.city, v?.state, v?.country].filter(Boolean).join(", ") || "Location not provided";
}
function servicesOf(v) {
  const raw = v?.services_offered ?? v?.services ?? [];
  return Array.isArray(raw) ? raw.filter(Boolean) :
    typeof raw === "string" ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
}
function money(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "Not provided";
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(Number(value));
}
function errorText(err, fallback) {
  const detail = err?.response?.data?.detail;
  return (typeof detail === "string" && detail.trim()) || err?.message || fallback;
}
function initials(value) {
  return String(value || "V").trim().split(/\\s+/).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "").join("");
}

export default function OrganizerVendors() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState(null);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setVendors(getArray(await getVendors()));
    } catch (err) {
      setError(errorText(err, "Unable to load vendors. Check the backend and vendor API."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const counts = useMemo(() => vendors.reduce((acc, vendor) => {
    acc.All += 1;
    acc[statusOf(vendor)] += 1;
    return acc;
  }, { All: 0, Pending: 0, Approved: 0, Rejected: 0 }), [vendors]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      const searchable = [
        nameOf(v), categoryOf(v), v?.contact_person, v?.contactPerson,
        v?.email, v?.business_email, locationOf(v),
      ].join(" ").toLowerCase();
      return (!q || searchable.includes(q)) && (filter === "All" || statusOf(v) === filter);
    });
  }, [vendors, search, filter]);

  async function decide(vendor, decision) {
    const vendorId = idOf(vendor);
    if (!vendorId) {
      setError("This vendor profile has no ID and cannot be updated.");
      return;
    }
    const approved = decision === "approve";
    if (!window.confirm(`${approved ? "Approve" : "Reject"} "${nameOf(vendor)}"’s vendor profile?`)) return;

    setActionId(vendorId);
    setError("");
    setSuccess("");
    try {
      if (approved) await approveVendor(vendorId);
      else await rejectVendor(vendorId);
      setSuccess(`${nameOf(vendor)} has been ${approved ? "approved" : "rejected"}.`);
      setSelected((current) => current && idOf(current) === vendorId
        ? { ...current, status: approved ? "Approved" : "Rejected" } : current);
      await loadVendors();
    } catch (err) {
      setError(errorText(err, `Unable to ${decision} this vendor. Please try again.`));
    } finally {
      setActionId("");
    }
  }

  return (
    <section className="organizer-vendors-page">
      <header className="organizer-vendors-header">
        <div>
          <p className="organizer-vendors-eyebrow">VENDOR MANAGEMENT</p>
          <h2>Vendors</h2>
          <p>Review vendor applications, manage approvals, and keep your event partners organized.</p>
        </div>
        <button className="ov-secondary-button" type="button" onClick={loadVendors} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {error && <div className="ov-alert ov-alert-error" role="alert">
        <span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
      </div>}
      {success && <div className="ov-alert ov-alert-success" role="status">
        <span>{success}</span><button type="button" aria-label="Dismiss message" onClick={() => setSuccess("")}>×</button>
      </div>}

      <div className="ov-stats-grid">
        {FILTERS.map((item) => <button key={item} type="button"
          className={`ov-stat-card ${filter === item ? "is-active" : ""}`}
          onClick={() => setFilter(item)}>
          <span className="ov-stat-label">{item === "All" ? "All vendors" : item}</span>
          <strong>{counts[item]}</strong>
          <i className={`ov-stat-dot ov-dot-${item.toLowerCase()}`} />
        </button>)}
      </div>

      <section className="ov-toolbar">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search business, category, contact, or location..." aria-label="Search vendors" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter vendors">
          {FILTERS.map((item) => <option key={item} value={item}>{item === "All" ? "All statuses" : item}</option>)}
        </select>
      </section>

      {loading ? <div className="ov-empty">Loading vendor profiles...</div> :
        visible.length === 0 ? <div className="ov-empty">
          <div className="ov-empty-mark">V</div><h3>No vendors found</h3>
          <p>{vendors.length === 0 ? "Vendor applications will appear here after businesses submit their profiles." :
            "Try changing your search or status filter."}</p>
        </div> : <div className="ov-vendor-grid">
          {visible.map((vendor, index) => {
            const vendorId = idOf(vendor) || `vendor-${index}`;
            const name = nameOf(vendor);
            const status = statusOf(vendor);
            const services = servicesOf(vendor);
            return <article className="ov-vendor-card" key={vendorId}>
              <div className="ov-vendor-card-top">
                <div className="ov-vendor-avatar">{initials(name)}</div>
                <span className={`ov-status ov-status-${status.toLowerCase()}`}>{status}</span>
              </div>
              <h3>{name}</h3><p className="ov-vendor-category">{categoryOf(vendor)}</p>
              <div className="ov-vendor-details">
                <p><span>Contact person</span><strong>{vendor?.contact_person ?? vendor?.contactPerson ?? "Not provided"}</strong></p>
                <p><span>Location</span><strong>{locationOf(vendor)}</strong></p>
                <p><span>Starting price</span><strong>{money(vendor?.price_from ?? vendor?.starting_price ?? vendor?.startingPrice)}</strong></p>
                <p><span>Services</span><strong>{services.length ? services.slice(0, 2).join(", ") + (services.length > 2 ? ` +${services.length - 2}` : "") : "Not provided"}</strong></p>
              </div>
              <div className="ov-card-actions">
                <button type="button" className="ov-secondary-button" onClick={() => setSelected(vendor)}>Review profile</button>
                {status === "Pending" && <>
                  <button type="button" className="ov-approve-button" onClick={() => decide(vendor, "approve")} disabled={actionId === idOf(vendor)}>
                    {actionId === idOf(vendor) ? "Working..." : "Approve"}
                  </button>
                  <button type="button" className="ov-reject-button" onClick={() => decide(vendor, "reject")} disabled={actionId === idOf(vendor)}>Reject</button>
                </>}
              </div>
            </article>;
          })}
        </div>}

      {selected && <div className="ov-modal-backdrop" onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSelected(null);
      }}>
        <section className="ov-modal" role="dialog" aria-modal="true" aria-labelledby="ov-modal-title">
          <div className="ov-modal-heading">
            <div><p className="organizer-vendors-eyebrow">VENDOR APPLICATION</p><h2 id="ov-modal-title">{nameOf(selected)}</h2></div>
            <button type="button" className="ov-modal-close" aria-label="Close vendor details" onClick={() => setSelected(null)}>×</button>
          </div>
          <div className="ov-profile-status-row"><span>Profile status</span>
            <span className={`ov-status ov-status-${statusOf(selected).toLowerCase()}`}>{statusOf(selected)}</span>
          </div>
          <div className="ov-profile-grid">
            <div><span>Category</span><strong>{categoryOf(selected)}</strong></div>
            <div><span>Contact person</span><strong>{selected?.contact_person ?? selected?.contactPerson ?? "Not provided"}</strong></div>
            <div><span>Business email</span><strong>{selected?.email ?? selected?.business_email ?? "Not provided"}</strong></div>
            <div><span>Phone number</span><strong>{selected?.phone ?? selected?.phone_number ?? "Not provided"}</strong></div>
            <div><span>Location</span><strong>{locationOf(selected)}</strong></div>
            <div><span>Starting price</span><strong>{money(selected?.price_from ?? selected?.starting_price ?? selected?.startingPrice)}</strong></div>
            <div className="ov-profile-full"><span>Website</span>
              {selected?.website ? <a href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a> : <strong>Not provided</strong>}
            </div>
            <div className="ov-profile-full"><span>Business address</span><strong>{selected?.address ?? "Not provided"}</strong></div>
            <div className="ov-profile-full"><span>Business description</span>
              <p>{selected?.description ?? selected?.business_description ?? "No description provided."}</p>
            </div>
            <div className="ov-profile-full"><span>Services offered</span><div className="ov-service-chips">
              {servicesOf(selected).length ? servicesOf(selected).map((service, i) => <span key={`${service}-${i}`}>{service}</span>) : <strong>Not provided</strong>}
            </div></div>
          </div>
          <div className="ov-modal-actions">
            <button type="button" className="ov-secondary-button" onClick={() => setSelected(null)}>Close</button>
            {statusOf(selected) === "Pending" && <>
              <button type="button" className="ov-reject-button" onClick={() => decide(selected, "reject")} disabled={actionId === idOf(selected)}>Reject application</button>
              <button type="button" className="ov-approve-button" onClick={() => decide(selected, "approve")} disabled={actionId === idOf(selected)}>
                {actionId === idOf(selected) ? "Working..." : "Approve vendor"}
              </button>
            </>}
          </div>
        </section>
      </div>}
    </section>
  );
}
