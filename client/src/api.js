
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
      "Unable to connect to the server. Please try again."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logoutUser();

    // Notify Auth.jsx to return to the login page
    window.dispatchEvent(new Event("auth:logout"));

    throw new Error(
      "Your session has expired. Please sign in again."
    );
  }

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong");
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

// Log in and save the authentication token and user
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

// Fetch all events
export function getEvents() {
  return apiRequest("/events");
}

// Create a new event
export function createEvent(event) {
  return apiRequest("/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

// Update an existing event
export function updateEvent(id, event) {
  return apiRequest(`/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(event),
  });
}

// Delete an event
export function deleteEvent(id) {
  return apiRequest(`/events/${id}`, {
    method: "DELETE",
  });
}

// Log out and remove saved session details
export function logoutUser() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export const getVenues = () => apiRequest("/venues");

export const createVenue = (venue) =>
  apiRequest("/venues", {
    method: "POST",
    body: JSON.stringify(venue),
  });

export const updateVenue = (id, venue) =>
  apiRequest(`/venues/${id}`, {
    method: "PUT",
    body: JSON.stringify(venue),
  });

export const deleteVenue = (id) =>
  apiRequest(`/venues/${id}`, {
    method: "DELETE",
  });
export async function getResources() {
  return apiRequest("/api/resources");
}

export async function createResource(data) {
  return apiRequest("/api/resources", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateResource(id, data) {
  return apiRequest(`/api/resources/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteResource(id) {
  return apiRequest(`/api/resources/${id}`, {
    method: "DELETE",
  });
}
