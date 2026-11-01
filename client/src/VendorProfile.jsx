import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  Globe,
  Info,
  LoaderCircle,
  MapPin,
  Save,
  Send,
  ShieldCheck,
  UserRound,
  X,
  XCircle,
  CalendarDays,
  Tag,
} from "lucide-react";

import {
  createVendorProfile,
  getMyVendorProfile,
  updateMyVendorProfile,
} from "./api";

import "./VendorProfile.css";
import AssignedEvents from "./AssignedEvents";

const CATEGORIES = [
  "Catering",
  "Photography",
  "Videography",
  "Decoration",
  "Entertainment",
  "Lighting",
  "Venue",
  "Transportation",
  "Security",
  "Other",
];

const EMPTY_FORM = {
  business_name: "",
  category: "Catering",
  contact_person: "",
  email: "",
  phone: "",
  description: "",
  city: "",
  state: "",
  country: "India",
  address: "",
  services: [],
  price_from: "",
  website: "",
};

function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function normalizeStatus(status) {
  return String(status || "Pending")
    .trim()
    .toLowerCase();
}

function getStatusLabel(status) {
  return String(status || "Pending")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getErrorMessage(error) {
  const detail =
    error?.response?.data?.detail ??
    error?.response?.data?.message ??
    error?.detail ??
    error?.message ??
    "Something went wrong. Please try again.";

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = item?.loc?.at(-1) ?? "field";
        return `${field}: ${item?.msg ?? "Invalid value"}`;
      })
      .join(". ");
  }

  return String(detail);
}

function isNotFoundError(error) {
  return (
    error?.response?.status === 404 ||
    /not found|does not exist/i.test(getErrorMessage(error))
  );
}

function normalizeProfile(profile) {
  return {
    ...EMPTY_FORM,
    ...profile,
    services: Array.isArray(profile?.services)
      ? profile.services
      : [],
    price_from:
      profile?.price_from === null ||
      profile?.price_from === undefined
        ? ""
        : String(profile.price_from),
  };
}

function VendorProfile({
  user: userProp,
  onLogout,
  onViewAssignedEvents,
}) {
  const user = userProp || getSavedUser();

  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    contact_person: user?.name || "",
    email: user?.email || "",
  }));

  const [vendor, setVendor] = useState(null);
  const [servicesText, setServicesText] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isEditing = Boolean(vendor);
  const status = normalizeStatus(vendor?.status);

  const serviceList = useMemo(
    () =>
      servicesText
        .split(",")
        .map((service) => service.trim())
        .filter(Boolean),
    [servicesText]
  );

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setError("");

      try {
        const response = await getMyVendorProfile();

        if (!active) return;

        const profile = response?.vendor;

        if (profile) {
          const normalized = normalizeProfile(profile);

          setVendor(profile);
          setForm(normalized);
          setServicesText(normalized.services.join(", "));
        } else {
          setVendor(null);
        }
      } catch (err) {
        if (!active) return;

        if (isNotFoundError(err)) {
          setVendor(null);
        } else {
          setError(getErrorMessage(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  }

  function handleServicesChange(event) {
    setServicesText(event.target.value);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    const services = serviceList;

    const priceFrom =
      form.price_from === "" ? null : Number(form.price_from);

    if (
      priceFrom !== null &&
      (!Number.isFinite(priceFrom) || priceFrom < 0)
    ) {
      setError("Please enter a valid starting price.");
      return;
    }

    const payload = {
      ...form,
      business_name: form.business_name.trim(),
      contact_person: form.contact_person.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      description: form.description.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim(),
      address: form.address.trim(),
      website: form.website.trim(),
      services,
      price_from: priceFrom,
    };

    setSaving(true);

    try {
      const response = isEditing
        ? await updateMyVendorProfile(payload)
        : await createVendorProfile(payload);

      const savedVendor = response?.vendor;

      if (savedVendor) {
        const normalized = normalizeProfile(savedVendor);

        setVendor(savedVendor);
        setForm(normalized);
        setServicesText(normalized.services.join(", "));
      } else {
        const updatedVendor = {
          ...(vendor || {}),
          ...payload,
          status: vendor?.status || "Pending",
        };

        setVendor(updatedVendor);

        setForm({
          ...payload,
          price_from:
            payload.price_from === null
              ? ""
              : String(payload.price_from),
        });
      }

      setSuccess(
        response?.message ||
          "Vendor profile saved successfully."
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="es-vendor">
        <header className="es-header">
          <a className="es-brand" href="/" aria-label="EventSphere home">
            <CalendarDays className="es-brand-icon" size={29} />
            <span>EventSphere</span>
          </a>
        </header>

        <main className="es-vendor-loading">
          <LoaderCircle size={25} className="es-spin" />
          <span>Loading your vendor profile...</span>
        </main>
      </div>
    );
  }

  return (
    <div className="es-vendor">
      {/* Header — same style as AttendeeRegistration */}
      <header className="es-header">
        <a className="es-brand" href="/" aria-label="EventSphere home">
          <CalendarDays className="es-brand-icon" size={29} />
          <span>EventSphere</span>
        </a>

        <nav className="es-header-nav" aria-label="Main navigation">
          <span>Plan</span>
          <i>•</i>
          <span>Manage</span>
          <i>•</i>
          <span>Create Better Events</span>
        </nav>

        <div className="es-user-actions">
          {user?.name && (
            <span className="es-user-name">
              Hi, {user.name}
            </span>
          )}

          {typeof onLogout === "function" && (
            <button
              type="button"
              className="es-logout-button"
              onClick={onLogout}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="es-vendor-layout">
        {/* Main form card */}
        <section className="es-vendor-form-card">
          <div className="es-form-heading">
            <Building2
              className="es-heading-icon"
              size={40}
            />

            <div>
              <span className="es-eyebrow">
                YOUR BUSINESS SPACE
              </span>

              <h1>
                {isEditing
                  ? "Vendor Profile"
                  : "Become an Event Vendor"}
              </h1>

              <p>
                {isEditing
                  ? "Keep your business details, services, and pricing up to date."
                  : "Introduce your business to event organizers and showcase the services you offer."}
              </p>
            </div>
          </div>

          {error && (
            <div
              className="es-alert es-alert-error"
              role="alert"
            >
              <XCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              className="es-alert es-alert-success"
              role="status"
            >
              <CheckCircle2 size={20} />
              <div>
                <strong>Profile saved successfully!</strong>
                <p>{success}</p>
              </div>
            </div>
          )}

          {status === "pending" && (
            <div className="es-vendor-notice is-pending">
              <Clock3 size={19} />

              <div>
                <strong>Profile submitted for review</strong>
                <p>
                  Your profile is awaiting administrator approval.
                  Once approved, your business can appear in the
                  vendor directory.
                </p>
              </div>
            </div>
          )}

          {status === "rejected" && (
            <div className="es-vendor-notice is-rejected">
              <XCircle size={19} />

              <div>
                <strong>Application needs attention</strong>
                <p>
                  Review your business information and update your
                  profile. You may need to contact the administrator
                  for further details.
                </p>
              </div>
            </div>
          )}

          {status === "approved" && (
            <div className="es-vendor-notice is-approved">
              <ShieldCheck size={19} />

              <div>
                <strong>Your vendor profile is approved</strong>
                <p>
                  Your business can now appear in the approved
                  vendor directory.
                </p>
              </div>
            </div>
          )}

          <form
            className="es-vendor-form"
            onSubmit={handleSubmit}
          >
            {/* Business information */}
            <section className="es-vendor-section">
              <div className="es-vendor-section-heading">
                <span className="es-vendor-section-number">
                  01
                </span>

                <div>
                  <h2>Business information</h2>
                  <p>
                    Basic details about your vendor business.
                  </p>
                </div>
              </div>

              <div className="es-vendor-grid">
                <div className="es-field">
                  <label htmlFor="business_name">
                    Business name <b>*</b>
                  </label>

                  <div className="es-input-box">
                    <Building2 size={17} />

                    <input
                      id="business_name"
                      name="business_name"
                      value={form.business_name}
                      onChange={handleChange}
                      placeholder="e.g. Creative Moments"
                      required
                      minLength={2}
                      maxLength={150}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="category">
                    Service category <b>*</b>
                  </label>

                  <div className="es-input-box es-select-box">
                    <Tag size={17} />

                    <select
                      id="category"
                      name="category"
                      value={form.category}
                      onChange={handleChange}
                      required
                    >
                      {CATEGORIES.map((category) => (
                        <option
                          key={category}
                          value={category}
                        >
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="contact_person">
                    Contact person <b>*</b>
                  </label>

                  <div className="es-input-box">
                    <UserRound size={17} />

                    <input
                      id="contact_person"
                      name="contact_person"
                      value={form.contact_person}
                      onChange={handleChange}
                      placeholder="Your full name"
                      required
                      minLength={2}
                      maxLength={100}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="email">
                    Business email <b>*</b>
                  </label>

                  <div className="es-input-box">
                    <Info size={17} />

                    <input
                      id="email"
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      placeholder="business@example.com"
                      required
                      maxLength={254}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="phone">
                    Phone number <b>*</b>
                  </label>

                  <div className="es-input-box">
                    <UserRound size={17} />

                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      value={form.phone}
                      onChange={handleChange}
                      placeholder="+91 9876543210"
                      required
                      minLength={7}
                      maxLength={20}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="website">
                    Business website
                  </label>

                  <div className="es-input-box">
                    <Globe size={17} />

                    <input
                      id="website"
                      name="website"
                      type="url"
                      value={form.website}
                      onChange={handleChange}
                      placeholder="https://yourbusiness.com"
                      maxLength={300}
                    />
                  </div>
                </div>
              </div>

              <div className="es-field">
                <label htmlFor="description">
                  Business description
                </label>

                <textarea
                  id="description"
                  name="description"
                  className="es-vendor-textarea"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Describe your business and what makes your services special..."
                  rows={5}
                  maxLength={2000}
                />

                <span className="es-vendor-hint">
                  {form.description.length}/2000 characters
                </span>
              </div>
            </section>

            {/* Location */}
            <section className="es-vendor-section">
              <div className="es-vendor-section-heading">
                <span className="es-vendor-section-number">
                  02
                </span>

                <div>
                  <h2>Business location</h2>
                  <p>
                    Help organizers find vendors in their area.
                  </p>
                </div>
              </div>

              <div className="es-vendor-grid">
                <div className="es-field">
                  <label htmlFor="city">City</label>

                  <div className="es-input-box">
                    <MapPin size={17} />

                    <input
                      id="city"
                      name="city"
                      value={form.city}
                      onChange={handleChange}
                      placeholder="Chennai"
                      maxLength={100}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="state">State</label>

                  <div className="es-input-box">
                    <MapPin size={17} />

                    <input
                      id="state"
                      name="state"
                      value={form.state}
                      onChange={handleChange}
                      placeholder="Tamil Nadu"
                      maxLength={100}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="country">Country</label>

                  <div className="es-input-box">
                    <Globe size={17} />

                    <input
                      id="country"
                      name="country"
                      value={form.country}
                      onChange={handleChange}
                      placeholder="India"
                      maxLength={100}
                    />
                  </div>
                </div>

                <div className="es-field">
                  <label htmlFor="address">
                    Business address
                  </label>

                  <div className="es-input-box">
                    <MapPin size={17} />

                    <input
                      id="address"
                      name="address"
                      value={form.address}
                      onChange={handleChange}
                      placeholder="Street, area, landmark"
                      maxLength={300}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Services and pricing */}
            <section className="es-vendor-section">
              <div className="es-vendor-section-heading">
                <span className="es-vendor-section-number">
                  03
                </span>

                <div>
                  <h2>Services and pricing</h2>
                  <p>
                    Add the services you offer and your starting price.
                  </p>
                </div>
              </div>

              <div className="es-field">
                <label htmlFor="services">
                  Services offered
                </label>

                <div className="es-input-box">
                  <Tag size={17} />

                  <input
                    id="services"
                    name="services"
                    value={servicesText}
                    onChange={handleServicesChange}
                    placeholder="Wedding catering, buffet, corporate events"
                  />
                </div>

                <span className="es-vendor-hint">
                  Separate each service with a comma.
                </span>
              </div>

              <div className="es-field es-vendor-price-field">
                <label htmlFor="price_from">
                  Starting price (₹)
                </label>

                <div className="es-input-box">
                  <span className="es-vendor-currency">₹</span>

                  <input
                    id="price_from"
                    name="price_from"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price_from}
                    onChange={handleChange}
                    placeholder="15000"
                  />
                </div>

                <span className="es-vendor-hint">
                  Enter the minimum price for your services.
                </span>
              </div>
            </section>

            {/* Form footer */}
            <div className="es-vendor-form-footer">
              <div className="es-form-notice">
                <Info size={18} />

                <span>
                  {isEditing
                    ? "Your changes will be saved to your vendor profile."
                    : "New vendor profiles are submitted for administrator approval."}
                </span>
              </div>

              <button
                type="submit"
                className="es-vendor-submit-button"
                disabled={saving}
              >
                {saving ? (
                  <>
                    <LoaderCircle
                      size={19}
                      className="es-spin"
                    />
                    Saving...
                  </>
                ) : isEditing ? (
                  <>
                    <Save size={18} />
                    Save changes
                    <ArrowUpRight
                      size={17}
                      className="es-button-arrow"
                    />
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    Submit profile
                    <ArrowUpRight
                      size={17}
                      className="es-button-arrow"
                    />
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Right-side profile summary */}
        <aside className="es-vendor-side-card">
          <div className="es-vendor-side-heading">
            <div>
              <span className="es-eyebrow">
                YOUR BUSINESS SPACE
              </span>

              <h2>Vendor overview</h2>

              <p>
                Your profile details and approval status.
              </p>
            </div>
          </div>
          <button
  type="button"
  className="es-vendor-assigned-button"
  onClick={onViewAssignedEvents}
>
  <CalendarDays size={17} />
  Your Assigned Events
  <ArrowUpRight size={16} className="es-assigned-button-arrow" />
</button>
          <div className="es-vendor-summary">
            <div className="es-vendor-summary-icon">
              <Building2 size={21} />
            </div>

            <div>
              <strong>
                {form.business_name || "Your business"}
              </strong>

              <span>
                {form.category || "Service category"}
              </span>
            </div>
          </div>

          <div className="es-vendor-status-panel">
            <span className="es-vendor-panel-label">
              PROFILE STATUS
            </span>

            <div className={`es-vendor-status is-${status}`}>
              {status === "approved" ? (
                <BadgeCheck size={18} />
              ) : status === "rejected" ? (
                <XCircle size={18} />
              ) : (
                <Clock3 size={18} />
              )}

              <span>{getStatusLabel(vendor?.status)}</span>
            </div>

            <p>
              {status === "approved"
                ? "Your profile is approved and may be listed in the vendor directory."
                : status === "rejected"
                  ? "Your application needs changes before it can be approved."
                  : "Your profile is waiting for administrator review."}
            </p>
          </div>

          <div className="es-vendor-side-details">
            <div className="es-vendor-side-detail">
              <UserRound size={16} />

              <div>
                <span>Contact person</span>
                <strong>
                  {form.contact_person || "Not provided"}
                </strong>
              </div>
            </div>

            <div className="es-vendor-side-detail">
              <MapPin size={16} />

              <div>
                <span>Location</span>
                <strong>
                  {[form.city, form.state]
                    .filter(Boolean)
                    .join(", ") || "Not provided"}
                </strong>
              </div>
            </div>

            <div className="es-vendor-side-detail">
              <Globe size={16} />

              <div>
                <span>Website</span>
                <strong className="es-vendor-break">
                  {form.website || "Not provided"}
                </strong>
              </div>
            </div>

            <div className="es-vendor-side-detail">
              <Tag size={16} />

              <div>
                <span>Starting price</span>
                <strong>
                  {form.price_from !== ""
                    ? `₹${Number(form.price_from).toLocaleString("en-IN")}`
                    : "Not provided"}
                </strong>
              </div>
            </div>
          </div>

          <div className="es-vendor-services-panel">
            <div className="es-vendor-services-heading">
              <h3>Services offered</h3>

              <span>{serviceList.length}</span>
            </div>

            {serviceList.length > 0 ? (
              <div className="es-vendor-service-tags">
                {serviceList.map((service, index) => (
                  <span key={`${service}-${index}`}>
                    <CheckCircle2 size={13} />
                    {service}
                  </span>
                ))}
              </div>
            ) : (
              <div className="es-vendor-empty-services">
                <Tag size={19} />

                <p>
                  Your services will appear here once you add them.
                </p>
              </div>
            )}
          </div>

          <div className="es-vendor-side-note">
            <ShieldCheck size={17} />

            <p>
              Keep your business information accurate so organizers
              can contact you confidently.
            </p>
          </div>
        </aside>
      </main>

      <footer className="es-footer">
        EventSphere <span>·</span> Every event starts with a
        connection.
      </footer>
    </div>
  );
}

export default VendorProfile;