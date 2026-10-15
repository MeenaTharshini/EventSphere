
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Common API request handler
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem("token");

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(
      "Unable to connect to the server. Check that the backend is running."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logoutUser();
    window.dispatchEvent(new Event("auth:logout"));

    throw new Error(
      "Your session has expired. Please sign in again."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message || data.error || `Request failed (${response.status}).`
    );
  }

  return data;
}

// Register a new user
export function registerUser(user) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(user),
  });
}

// Log in and save authentication details
export async function loginUser(credentials) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });

  if (data.token) {
    localStorage.setItem("token", data.token);
  }

  if (data.user) {
    localStorage.setItem("user", JSON.stringify(data.user));
  }

  return data;
}

// Events
export function getEvents() {
  return apiRequest("/events");
}

export function createEvent(event) {
  return apiRequest("/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export function updateEvent(id, event) {
  return apiRequest(`/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(event),
  });
}

export function deleteEvent(id) {
  return apiRequest(`/events/${id}`, {
    method: "DELETE",
  });
}

// Venues
export function getVenues() {
  return apiRequest("/venues");
}

export function createVenue(venue) {
  return apiRequest("/venues", {
    method: "POST",
    body: JSON.stringify(venue),
  });
}

export function updateVenue(id, venue) {
  return apiRequest(`/venues/${id}`, {
    method: "PUT",
    body: JSON.stringify(venue),
  });
}

export function deleteVenue(id) {
  return apiRequest(`/venues/${id}`, {
    method: "DELETE",
  });
}

// Resources
export function getResources() {
  return apiRequest("/resources");
}

export function createResource(data) {
  return apiRequest("/resources", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateResource(id, data) {
  return apiRequest(`/resources/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteResource(id) {
  return apiRequest(`/resources/${id}`, {
    method: "DELETE",
  });
}

// Log out
export function logoutUser() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

// Backend health check
export async function checkBackendHealth() {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}/health`);
  } catch {
    throw new Error("Unable to connect to the backend.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Backend health check failed.");
  }

  return data;
}
