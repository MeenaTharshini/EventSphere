
// =========================================================
// EventSphere API Configuration
// React + Vite frontend → FastAPI + MongoDB backend
// File: client/src/api.js
// =========================================================

const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api"
).replace(/\/+$/, "");

// =========================================================
// AUTHENTICATION HELPERS
// =========================================================

function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    sessionStorage.getItem("token")
  );
}

function getErrorMessage(data, status) {
  if (typeof data?.detail === "string") {
    return data.detail;
  }

  if (Array.isArray(data?.detail)) {
    return data.detail
      .map((item) => {
        const field = Array.isArray(item.loc)
          ? item.loc[item.loc.length - 1]
          : "";

        const message = item.msg || "Invalid input";

        return field && field !== "body"
          ? `${field}: ${message}`
          : message;
      })
      .join(", ");
  }

  return (
    data?.message ||
    data?.error ||
    `Request failed (${status}).`
  );
}

// =========================================================
// COMMON API REQUEST HANDLER
// =========================================================

export async function apiRequest(endpoint, options = {}) {
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  const url = `${API_BASE_URL}${normalizedEndpoint}`;

  const headers = new Headers(options.headers || {});
  const token = getAuthToken();

  // Public authentication endpoints.
  // These must not receive an old/stale Authorization token.
  const isPublicAuthRequest = [
    "/auth/login",
    "/auth/admin/login",
    "/auth/register",
  ].includes(normalizedEndpoint);

  // Set JSON content type when a request has a body.
  if (
    options.body !== undefined &&
    options.body !== null &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  // Attach authentication token only to protected requests.
  if (
    token &&
    !isPublicAuthRequest &&
    !headers.has("Authorization")
  ) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    const contentType =
      response.headers.get("content-type") || "";

    let data = {};

    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => ({}));
    } else if (response.status !== 204) {
      const responseText = await response
        .text()
        .catch(() => "");

      data = responseText
        ? { message: responseText }
        : {};
    }

    if (!response.ok) {
      const message = getErrorMessage(
        data,
        response.status
      );

      // Failed public login/signup attempts must not
      // terminate an existing user's session.
      if (
        response.status === 401 &&
        !isPublicAuthRequest
      ) {
        logoutUser();

        window.dispatchEvent(
          new Event("auth:logout")
        );
      }

      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "Request timed out after 10 seconds. Check the FastAPI server and MongoDB connection."
      );
    }

    if (error instanceof TypeError) {
      throw new Error(
        "Cannot connect to FastAPI at " +
          API_BASE_URL +
          ". Check the backend URL and CORS settings."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =========================================================
// AUTHENTICATION
// =========================================================

// POST /api/auth/register
// Public registration: Attendee, Organizer, Vendor.
export function registerUser(user) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(user),
  });
}

// POST /api/auth/login
// Normal user login.
export async function loginUser(credentials) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  if (data.token) {
    localStorage.setItem("token", data.token);
    sessionStorage.removeItem("token");
  }

  if (data.user) {
    localStorage.setItem(
      "user",
      JSON.stringify(data.user)
    );
  }

  return data;
}

// POST /api/auth/admin/login
// Separate administrator login portal.
export async function loginAdmin(credentials) {
  const data = await apiRequest("/auth/admin/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  if (!data?.token || !data?.user) {
    throw new Error(
      "Admin login failed. Please try again."
    );
  }

  const role = String(data.user.role || "")
    .trim()
    .toLowerCase();

  if (
    role !== "admin" &&
    role !== "administrator"
  ) {
    throw new Error(
      "This account does not have administrator access."
    );
  }

  // Store Admin credentials using the same
  // authentication storage as normal users.
  localStorage.setItem("token", data.token);

  localStorage.setItem(
    "user",
    JSON.stringify(data.user)
  );

  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");

  return data;
}

// GET /api/auth/me
export async function getCurrentUser() {
  const data = await apiRequest("/auth/me");

  if (data.user) {
    localStorage.setItem(
      "user",
      JSON.stringify(data.user)
    );

    return data.user;
  }

  return data;
}

// Clear authentication details.
export function logoutUser() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");

  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
}

// =========================================================
// VENDOR ASSIGNED EVENTS
// GET /api/vendors/events/assigned
// =========================================================

export async function getMyAssignedEvents() {
  const response = await apiRequest(
    "/vendors/events/assigned",
    {
      method: "GET",
    }
  );

  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.events)) {
    return response.events;
  }

  if (Array.isArray(response?.assigned_events)) {
    return response.assigned_events;
  }

  return [];
}

// =========================================================
// EVENTS
// =========================================================

// GET /api/events/
export function getEvents() {
  return apiRequest("/events/");
}

// POST /api/events/
export function createEvent(event) {
  return apiRequest("/events/", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

// GET /api/events/{id}
export function getEvent(id) {
  return apiRequest(
    `/events/${encodeURIComponent(id)}`
  );
}

// PUT /api/events/{id}
export function updateEvent(id, event) {
  return apiRequest(
    `/events/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(event),
    }
  );
}

// DELETE /api/events/{id}
export function deleteEvent(id) {
  return apiRequest(
    `/events/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}

// =========================================================
// VENUES
// =========================================================

// GET /api/venues/
export function getVenues() {
  return apiRequest("/venues/");
}

// GET /api/venues/{id}
export function getVenue(id) {
  return apiRequest(
    `/venues/${encodeURIComponent(id)}`
  );
}

// POST /api/venues/
export function createVenue(venue) {
  return apiRequest("/venues/", {
    method: "POST",
    body: JSON.stringify(venue),
  });
}

// PUT /api/venues/{id}
export function updateVenue(id, venue) {
  return apiRequest(
    `/venues/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(venue),
    }
  );
}

// DELETE /api/venues/{id}
export function deleteVenue(id) {
  return apiRequest(
    `/venues/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}

// =========================================================
// RESOURCES
// =========================================================

// GET /api/resources/
export function getResources() {
  return apiRequest("/resources/");
}

// GET /api/resources/{id}
export function getResource(id) {
  return apiRequest(
    `/resources/${encodeURIComponent(id)}`
  );
}

// POST /api/resources/
export function createResource(resource) {
  return apiRequest("/resources/", {
    method: "POST",
    body: JSON.stringify(resource),
  });
}

// PUT /api/resources/{id}
export function updateResource(id, resource) {
  return apiRequest(
    `/resources/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(resource),
    }
  );
}

// DELETE /api/resources/{id}
export function deleteResource(id) {
  return apiRequest(
    `/resources/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}

// =========================================================
// BACKEND HEALTH CHECK
// GET /api/health
// =========================================================

export function checkBackendHealth() {
  return apiRequest("/health", {
    method: "GET",
  });
}

// =========================================================
// ATTENDEE REGISTRATION
// POST /api/attendees/register
// =========================================================

export function registerAttendee(attendee) {
  return apiRequest("/attendees/register", {
    method: "POST",
    body: JSON.stringify({
      name: attendee.name?.trim(),
      email: attendee.email?.trim().toLowerCase(),
      phone: attendee.phone?.trim(),
      event_id: attendee.event_id?.trim(),
      category: attendee.category?.trim(),
    }),
  });
}

// =========================================================
// LOGGED-IN ATTENDEE REGISTRATIONS
// GET /api/attendees/my-registrations
// =========================================================

export async function getMyRegistrations() {
  const response = await apiRequest(
    "/attendees/my-registrations",
    {
      method: "GET",
    }
  );

  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.registrations)) {
    return response.registrations;
  }

  return [];
}

// =========================================================
// DIGITAL TICKETS
// =========================================================

// GET /api/tickets
export async function getMyTickets() {
  const response = await apiRequest("/tickets", {
    method: "GET",
  });

  return Array.isArray(response?.tickets)
    ? response.tickets
    : [];
}

// GET /api/tickets/{ticket_id}
export async function getTicket(ticketId) {
  return apiRequest(
    `/tickets/${encodeURIComponent(ticketId)}`,
    {
      method: "GET",
    }
  );
}

// GET /api/tickets/verify/{ticket_id}
export async function verifyTicket(ticketId) {
  return apiRequest(
    `/tickets/verify/${encodeURIComponent(ticketId)}`,
    {
      method: "GET",
    }
  );
}

// POST /api/tickets/{ticket_id}/check-in
export async function checkInTicket(ticketId) {
  return apiRequest(
    `/tickets/${encodeURIComponent(ticketId)}/check-in`,
    {
      method: "POST",
    }
  );
}

// PATCH /api/tickets/{ticket_id}/cancel
export async function cancelTicket(ticketId) {
  return apiRequest(
    `/tickets/${encodeURIComponent(ticketId)}/cancel`,
    {
      method: "PATCH",
    }
  );
}

// =========================================================
// UNREGISTER FROM AN EVENT
// DELETE /api/attendees/registrations/{registration_id}
// =========================================================

export function unregisterAttendee(registrationId) {
  return apiRequest(
    `/attendees/registrations/${encodeURIComponent(
      registrationId
    )}`,
    {
      method: "DELETE",
    }
  );
}

// =========================================================
// VENDOR MANAGEMENT
// =========================================================

// POST /api/vendors/profile
export function createVendorProfile(vendor) {
  return apiRequest("/vendors/profile", {
    method: "POST",
    body: JSON.stringify(vendor),
  });
}

// GET /api/vendors/profile/me
export function getMyVendorProfile() {
  return apiRequest("/vendors/profile/me", {
    method: "GET",
  });
}

// PUT /api/vendors/profile/me
export function updateMyVendorProfile(vendor) {
  return apiRequest("/vendors/profile/me", {
    method: "PUT",
    body: JSON.stringify(vendor),
  });
}

// GET /api/vendors/
export function getApprovedVendors(params = {}) {
  const query = new URLSearchParams();

  if (params.category) {
    query.set("category", params.category);
  }

  if (params.city) {
    query.set("city", params.city);
  }

  if (params.search) {
    query.set("search", params.search);
  }

  if (params.skip !== undefined) {
    query.set("skip", String(params.skip));
  }

  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }

  const queryString = query.toString();

  return apiRequest(
    `/vendors/${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
    }
  );
}

// GET /api/vendors/{vendor_id}
export function getVendorDetails(vendorId) {
  return apiRequest(
    `/vendors/${encodeURIComponent(vendorId)}`,
    {
      method: "GET",
    }
  );
}

// =========================================================
// ADMIN VENDOR MANAGEMENT
// =========================================================

// GET /api/vendors/admin/applications
export function getVendors(params = {}) {
  const query = new URLSearchParams();

  if (params.status) {
    query.set("status", params.status);
  }

  if (params.skip !== undefined) {
    query.set("skip", String(params.skip));
  }

  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }

  const queryString = query.toString();

  return apiRequest(
    `/vendors/admin/applications${
      queryString ? `?${queryString}` : ""
    }`,
    {
      method: "GET",
    }
  );
}

// PUT /api/vendors/admin/{vendor_id}/approval
// Approve a vendor application.
export function approveVendor(vendorId) {
  return apiRequest(
    `/vendors/admin/${encodeURIComponent(vendorId)}/approval`,
    {
      method: "PUT",
      body: JSON.stringify({
        status: "Approved",
      }),
    }
  );
}

// PUT /api/vendors/admin/{vendor_id}/approval
// Reject a vendor application.
export function rejectVendor(vendorId) {
  return apiRequest(
    `/vendors/admin/${encodeURIComponent(vendorId)}/approval`,
    {
      method: "PUT",
      body: JSON.stringify({
        status: "Rejected",
      }),
    }
  );
}

// =========================================================
// SPONSORSHIPS
// =========================================================

// GET /api/sponsorships/
export function getSponsorships(params = {}) {
  const query = new URLSearchParams();

  if (params.event_id) {
    query.set("event_id", params.event_id);
  }

  if (params.status) {
    query.set("status", params.status);
  }

  if (params.search) {
    query.set("search", params.search);
  }

  const queryString = query.toString();

  return apiRequest(
    `/sponsorships/${queryString ? `?${queryString}` : ""}`
  );
}

// GET /api/sponsorships/event/{event_id}
export function getEventSponsorships(eventId) {
  return apiRequest(
    `/sponsorships/event/${encodeURIComponent(eventId)}`
  );
}

// GET /api/sponsorships/{id}
export function getSponsorship(id) {
  return apiRequest(
    `/sponsorships/${encodeURIComponent(id)}`
  );
}

// POST /api/sponsorships/
export function createSponsorship(data) {
  return apiRequest("/sponsorships/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// PUT /api/sponsorships/{id}
export function updateSponsorship(id, data) {
  return apiRequest(
    `/sponsorships/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
}

// =========================================================
// NOTIFICATIONS
// =========================================================

export function getNotifications(params = {}) {
  const query = new URLSearchParams();

  if (params.unread_only !== undefined) {
  query.set("unread_only", String(params.unread_only));
}

  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }

  if (params.skip !== undefined) {
    query.set("skip", String(params.skip));
  }

  const suffix = query.toString()
    ? `?${query.toString()}`
    : "";

  return apiRequest(`/notifications/${suffix}`);
}

export function getUnreadNotificationCount() {
  return apiRequest("/notifications/unread-count");
}

export function markNotificationRead(notificationId) {
  return apiRequest(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH" }
  );
}

export function markAllNotificationsRead() {
  return apiRequest("/notifications/read-all", {
    method: "PATCH",
  });
}

export function deleteNotification(notificationId) {
  return apiRequest(
    `/notifications/${encodeURIComponent(notificationId)}`,
    { method: "DELETE" }
  );
}

// DELETE /api/sponsorships/{id}
export function deleteSponsorship(id) {
  return apiRequest(
    `/sponsorships/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}
