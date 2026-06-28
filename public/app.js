let userLat = null;
let userLng = null;
let map = null;
let markers = [];
let selectedActivityMarker = null;

let socket = null;
let currentUser = null;
let selectedChatUserId = null;

function setDateLimits() {
  const timeInput = document.getElementById("timeInput");
  if (!timeInput) return;

  const now = new Date();
  const maxDate = new Date();
  maxDate.setFullYear(now.getFullYear() + 1);

  timeInput.min = now.toISOString().slice(0, 16);
  timeInput.max = maxDate.toISOString().slice(0, 16);
}

function validateActivityForm() {
  const timeInput = document.getElementById("timeInput");
  const lat = document.getElementById("latitudeInput")?.value;
  const lng = document.getElementById("longitudeInput")?.value;

  if (!lat || !lng) {
    alert("Please select a location on the map first.");
    return false;
  }

  const selectedDate = new Date(timeInput.value);
  const now = new Date();
  const maxDate = new Date();
  maxDate.setFullYear(now.getFullYear() + 1);

  if (selectedDate < now) {
    alert("Activity date and time cannot be in the past.");
    return false;
  }

  if (selectedDate > maxDate) {
    alert("Activity date cannot be more than 1 year in the future.");
    return false;
  }

  return true;
}

function getSportIcon(sportName) {
  const sport = sportName.toLowerCase();
  if (sport.includes("football")) return "⚽";
  if (sport.includes("basketball")) return "🏀";
  if (sport.includes("running") || sport.includes("run")) return "🏃";
  if (sport.includes("gym") || sport.includes("workout")) return "🏋️";
  if (sport.includes("tennis")) return "🎾";
  if (sport.includes("cricket")) return "🏏";
  if (sport.includes("cycling") || sport.includes("bike")) return "🚴";
  if (sport.includes("swim")) return "🏊";
  return "🔥";
}

function formatTime(time) {
  if (!time) return "Not specified";
  const date = new Date(time);
  if (isNaN(date)) return time;
  return date.toLocaleString();
}

function getTimeRemaining(time) {
  const now = new Date();
  const eventTime = new Date(time);
  const diff = eventTime - now;

  if (diff <= 0) return "Started / past";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day(s) left`;
  return `${hours} hour(s) left`;
}

function activityCard(activity, showJoinButton = true, showManageButtons = false) {
  const icon = getSportIcon(activity.sport);
  const playerText = `${activity.joinedCount || 0}/${activity.maxPlayers}`;
  const fullText = activity.isFull ? `<span class="badge">Full</span>` : "";

  return `
    <div class="activity-card-pro">
      <div class="activity-icon">${icon}</div>

      <div class="activity-info">
        <h3>${activity.sport} ${fullText}</h3>
        <p>📍 ${activity.location}</p>
        <p>👤 Created by: ${activity.creatorName || "Unknown"}</p>
        <p>🕒 ${formatTime(activity.time)}</p>
        <p>⏳ ${getTimeRemaining(activity.time)}</p>
        <p>👥 Players joined: ${playerText}</p>
        ${activity.distance ? `<p>📏 ${activity.distance} km away</p>` : ""}
      </div>

      <div class="activity-actions">
        ${
          showManageButtons
            ? `
              <button onclick="showEditForm(${activity.id})">Edit</button>
              <button onclick="deleteActivity(${activity.id})">Delete</button>
            `
            : activity.isOwner
              ? `<span class="badge">Created by you</span>`
              : activity.isFull
                ? `<span class="badge">Activity Full</span>`
                : showJoinButton
                  ? `<button onclick="requestJoin(${activity.id})">Request to Join</button>`
                  : ""
        }
      </div>
    </div>

    <div id="editForm-${activity.id}" class="card edit-form" style="display:none;">
      <h2>Edit Activity</h2>
      <input type="text" id="editSport-${activity.id}" value="${activity.sport}">
      <input type="text" id="editLocation-${activity.id}" value="${activity.location}">
      <input type="datetime-local" id="editTime-${activity.id}" value="${activity.time}">
      <input type="number" id="editMaxPlayers-${activity.id}" value="${activity.maxPlayers}" min="1" max="100">
      <button onclick="updateActivity(${activity.id})">Save Changes</button>
      <button onclick="hideEditForm(${activity.id})">Cancel</button>
    </div>
  `;
}

function requestCard(request) {
  const icon = getSportIcon(request.sport);

  return `
    <div class="activity-card-pro">
      <div class="activity-icon">${icon}</div>

      <div class="activity-info">
        <h3>${request.sport}</h3>
        <p>📍 ${request.location}</p>
        <p>🕒 ${formatTime(request.time)}</p>
        <p>🙋 Requested by: ${request.username}</p>
        <p>📌 Status: ${request.status}</p>
      </div>

      <div class="activity-actions">
        ${
          request.status === "pending"
            ? `
              <button onclick="updateRequest(${request.id}, 'approved')">Approve</button>
              <button onclick="updateRequest(${request.id}, 'rejected')">Reject</button>
            `
            : `<span class="badge">Decision completed</span>`
        }
      </div>
    </div>
  `;
}

function showEditForm(id) {
  const form = document.getElementById(`editForm-${id}`);
  if (form) form.style.display = "block";
}

function hideEditForm(id) {
  const form = document.getElementById(`editForm-${id}`);
  if (form) form.style.display = "none";
}

async function updateActivity(id) {
  const sport = document.getElementById(`editSport-${id}`).value;
  const location = document.getElementById(`editLocation-${id}`).value;
  const time = document.getElementById(`editTime-${id}`).value;
  const maxPlayers = document.getElementById(`editMaxPlayers-${id}`).value;

  const response = await fetch(`/api/activities/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sport, location, time, maxPlayers }),
  });

  alert(await response.text());
  loadActivities();
}

async function deleteActivity(id) {
  if (!confirm("Are you sure you want to delete this activity?")) return;

  const response = await fetch(`/api/activities/${id}`, { method: "DELETE" });
  alert(await response.text());
  loadActivities();
  loadDashboardStats();
  loadProfile();
}

function initMap() {
  const mapElement = document.getElementById("map");
  if (!mapElement) return;

  map = L.map("map").setView([51.5072, -0.1276], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  if (document.getElementById("latitudeInput") && document.getElementById("longitudeInput")) {
    map.on("click", async function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      document.getElementById("latitudeInput").value = lat;
      document.getElementById("longitudeInput").value = lng;

      const selectedText = document.getElementById("selectedLocationText");
      if (selectedText) {
        selectedText.innerText =
          `Selected location: ${lat.toFixed(5)}, ${lng.toFixed(5)}. Loading address...`;
      }

      if (selectedActivityMarker) map.removeLayer(selectedActivityMarker);

      selectedActivityMarker = L.marker([lat, lng])
        .addTo(map)
        .bindPopup("Selected activity location")
        .openPopup();

      await getAddressFromCoordinates(lat, lng);
    });
  }
}

async function getAddressFromCoordinates(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const response = await fetch(url);
    const data = await response.json();

    const address =
      data.display_name || `Map location (${lat.toFixed(3)}, ${lng.toFixed(3)})`;

    const locationInput = document.getElementById("locationInput");
    const selectedText = document.getElementById("selectedLocationText");

    if (locationInput) locationInput.value = address;
    if (selectedText) selectedText.innerText = `Selected location: ${address}`;
  } catch {
    const fallback = `Map location (${lat.toFixed(3)}, ${lng.toFixed(3)})`;

    const locationInput = document.getElementById("locationInput");
    const selectedText = document.getElementById("selectedLocationText");

    if (locationInput) locationInput.value = fallback;
    if (selectedText) selectedText.innerText = `Selected location: ${fallback}`;
  }
}

function getUserLocation() {
  if (!navigator.geolocation) {
    const locationStatus = document.getElementById("locationStatus");
    if (locationStatus) locationStatus.innerText = "Geolocation is not supported.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLat = position.coords.latitude;
      userLng = position.coords.longitude;

      const locationStatus = document.getElementById("locationStatus");
      if (locationStatus) {
        locationStatus.innerText =
          `Location set: ${userLat.toFixed(4)}, ${userLng.toFixed(4)}`;
      }

      if (map) {
        map.setView([userLat, userLng], 13);
        L.marker([userLat, userLng]).addTo(map).bindPopup("You are here").openPopup();
      }

      loadActivities();
    },
    () => {
      const locationStatus = document.getElementById("locationStatus");
      if (locationStatus) locationStatus.innerText = "Unable to retrieve location.";
    }
  );
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function clearMarkers() {
  if (!map) return;
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];
}

async function loadActivities() {
  const container = document.getElementById("activities");
  const myContainer = document.getElementById("myActivities");

  if (!container && !myContainer && !map) return;

  const response = await fetch("/api/activities");
  const activities = await response.json();

  clearMarkers();

  if (container) {
    container.innerHTML = "";

    const radiusFilter = document.getElementById("radiusFilter");
    const radius = radiusFilter ? Number(radiusFilter.value) : 999999;

    const searchInput = document.getElementById("searchInput");
    const sportFilter = document.getElementById("sportFilter");

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const selectedSport = sportFilter ? sportFilter.value.toLowerCase() : "";

    let filteredActivities = activities.filter((activity) => {
      const sport = activity.sport.toLowerCase();
      return sport.includes(searchTerm) && (selectedSport === "" || sport.includes(selectedSport));
    });

    if (userLat !== null && userLng !== null) {
      filteredActivities = filteredActivities.filter((activity) => {
        if (!activity.latitude || !activity.longitude) return false;

        const distance = calculateDistance(
          userLat,
          userLng,
          activity.latitude,
          activity.longitude
        );

        activity.distance = distance.toFixed(2);
        return distance <= radius;
      });
    }

    if (filteredActivities.length === 0) {
      container.innerHTML = "<p>No activities found.</p>";
    } else {
      filteredActivities.forEach((activity) => {
        container.innerHTML += activityCard(activity, true, false);
      });
    }
  }

  if (myContainer) {
    myContainer.innerHTML = "";

    const myActivities = activities.filter((activity) => activity.isOwner);

    if (myActivities.length === 0) {
      myContainer.innerHTML = "<p>You have not created any activities yet.</p>";
    } else {
      myActivities.forEach((activity) => {
        myContainer.innerHTML += activityCard(activity, false, true);
      });
    }
  }

  if (map) {
    activities.forEach((activity) => {
      if (activity.latitude && activity.longitude) {
        const icon = L.divIcon({
          className: "",
          html: `
            <div class="map-activity-icon">
              <span>${getSportIcon(activity.sport)}</span>
            </div>
          `,
          iconSize: [46, 46],
          iconAnchor: [23, 46],
        });

        const marker = L.marker([activity.latitude, activity.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <strong>${getSportIcon(activity.sport)} ${activity.sport}</strong><br>
            ${activity.joinedCount || 0}/${activity.maxPlayers} joined<br>
            ${activity.location}<br>
            ${formatTime(activity.time)}
          `);

        markers.push(marker);
      }
    });
  }
}

async function requestJoin(activityId) {
  const response = await fetch(`/api/request/${activityId}`, { method: "POST" });
  alert(await response.text());
  loadActivities();
  loadRequests();
}

async function loadRequests() {
  const container = document.getElementById("requests");
  if (!container) return;

  const response = await fetch("/api/requests");
  const requests = await response.json();

  container.innerHTML = "";

  if (requests.length === 0) {
    container.innerHTML = "<p>No join requests yet.</p>";
    return;
  }

  requests.forEach((request) => {
    container.innerHTML += requestCard(request);
  });
}

async function updateRequest(requestId, status) {
  const response = await fetch(`/api/requests/${requestId}/${status}`, {
    method: "POST",
  });

  alert(await response.text());
  loadRequests();
  loadActivities();
  loadDashboardStats();
  loadProfile();
}

async function loadDashboardStats() {
  const totalActivitiesElement = document.getElementById("totalActivities");
  if (!totalActivitiesElement) return;

  const activitiesResponse = await fetch("/api/activities");
  const activities = await activitiesResponse.json();

  const requestsResponse = await fetch("/api/requests");
  const requests = await requestsResponse.json();

  document.getElementById("totalActivities").innerText =
    activities.filter((a) => a.isOwner).length;
  document.getElementById("pendingRequests").innerText =
    requests.filter((r) => r.status === "pending").length;
  document.getElementById("approvedRequests").innerText =
    requests.filter((r) => r.status === "approved").length;
}

function setupCreateActivityForm() {
  const form = document.getElementById("createActivityForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateActivityForm()) return;

    const data = {
      sport: document.getElementById("sportInput").value,
      location: document.getElementById("locationInput").value,
      time: document.getElementById("timeInput").value,
      maxPlayers: document.getElementById("maxPlayersInput").value,
      latitude: document.getElementById("latitudeInput").value,
      longitude: document.getElementById("longitudeInput").value,
    };

    const response = await fetch("/api/activities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const text = await response.text();

    if (text.includes("Activity created")) {
      alert("Activity created successfully");
      window.location.href = "/dashboard.html";
    } else {
      alert(text);
    }
  });
}

function setSportFilter(sport) {
  const filter = document.getElementById("sportFilter");
  if (filter) {
    filter.value = sport;
    loadActivities();
  }
}

async function initLiveChat() {
  const userList = document.getElementById("userList");
  if (!userList) return;

  const response = await fetch("/api/current-user");
  currentUser = await response.json();

  socket = io();
  socket.emit("joinChat", currentUser.id);

  socket.on("newMessage", (message) => {
    if (
      selectedChatUserId &&
      (message.senderId === selectedChatUserId ||
        message.receiverId === selectedChatUserId)
    ) {
      appendMessage(message);
    }
  });

  loadUsers();
}

async function loadUsers() {
  const userList = document.getElementById("userList");
  if (!userList) return;

  const response = await fetch("/api/users");
  const users = await response.json();

  userList.innerHTML = "";

  if (users.length === 0) {
    userList.innerHTML = "<p>No other users found.</p>";
    return;
  }

  users.forEach((user) => {
    const div = document.createElement("div");
    div.className = "user-item";
    div.innerHTML = `👤 ${user.username}`;
    div.onclick = () => openChat(user.id, user.username);
    userList.appendChild(div);
  });
}

async function openChat(userId, username) {
  selectedChatUserId = userId;

  document.getElementById("chatTitle").innerText = `Chat with ${username}`;

  const response = await fetch(`/api/messages/${userId}`);
  const messages = await response.json();

  const messagesBox = document.getElementById("messages");
  messagesBox.innerHTML = "";

  messages.forEach((msg) => appendMessage(msg));
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function appendMessage(msg) {
  const messagesBox = document.getElementById("messages");
  if (!messagesBox) return;

  const div = document.createElement("div");
  div.className = "message";
  div.innerHTML = `<strong>${msg.senderName}:</strong> ${msg.message}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function sendLiveMessage() {
  const input = document.getElementById("messageInput");
  const message = input.value.trim();

  if (!selectedChatUserId) {
    alert("Please select a user first.");
    return;
  }

  if (!message) {
    alert("Please type a message.");
    return;
  }

  socket.emit("sendMessage", {
    senderId: currentUser.id,
    receiverId: selectedChatUserId,
    senderName: currentUser.username,
    message,
  });

  input.value = "";
}

async function loadProfile() {
  const usernameElement = document.getElementById("profileUsername");
  if (!usernameElement) return;

  const response = await fetch("/api/profile");
  const profile = await response.json();

  document.getElementById("profileUsername").innerText = profile.username;
  document.getElementById("profileBioText").innerText =
    profile.bio || "No bio added yet.";
  document.getElementById("profileSportText").innerText =
    profile.favouriteSport || "Not set";

  document.getElementById("bioInput").value = profile.bio || "";
  document.getElementById("favouriteSportInput").value = profile.favouriteSport || "";

  document.getElementById("profileCreatedCount").innerText = profile.createdCount;
  document.getElementById("profileJoinedCount").innerText = profile.joinedCount;
}

async function saveProfile() {
  const bio = document.getElementById("bioInput").value;
  const favouriteSport = document.getElementById("favouriteSportInput").value;

  const response = await fetch("/api/profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bio, favouriteSport }),
  });

  alert(await response.text());
  loadProfile();
}

document.addEventListener("DOMContentLoaded", () => {
  setDateLimits();
  initMap();
  loadActivities();
  loadRequests();
  loadDashboardStats();
  setupCreateActivityForm();
  initLiveChat();
  loadProfile();
});