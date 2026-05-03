// public/js/profile.js
// Profile page logic — by Maeva Akpaca
//
// Fetch calls used (rubric: local Web API):
//   1. GET /api/user/profile  — loads current user data to pre-fill the form
//   2. PUT /api/user/profile  — saves updated profile fields to the database

// ============================================================
// HELPERS
// ============================================================

// Show an alert banner above the form
function showAlert(message, type = "success") {
    const alert = document.getElementById("profileAlert");
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.classList.remove("d-none");
    // Auto-hide after 4 seconds
    setTimeout(() => alert.classList.add("d-none"), 4000);
}

// Build initials from a display name (e.g. "Mae Akpaca" → "MA")
function getInitials(name) {
    if (!name) return "?";
    return name
        .trim()
        .split(/\s+/)
        .map(word => word[0].toUpperCase())
        .slice(0, 2)
        .join("");
}

// Update the avatar circle and the header text
function updateHeader(displayName, username) {
    document.getElementById("avatarCircle").textContent = getInitials(displayName);
    document.getElementById("headerDisplayName").textContent = displayName || "—";
    document.getElementById("headerUsername").textContent = username ? `@${username}` : "";
}

// ============================================================
// LOAD PROFILE  (GET /api/user/profile)
// Pre-fills all form fields with the user's current data.
// ============================================================
async function loadProfile() {
    try {
        const response = await fetch("/api/user/profile");

        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = "/login";
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const profile = await response.json();

        // Pre-fill form fields
        document.getElementById("display_name").value   = profile.display_name   || "";
        document.getElementById("email").value          = profile.email           || "";
        document.getElementById("favorite_genre").value = profile.favorite_genre  || "All";

        // Update the avatar / header section
        updateHeader(profile.display_name, profile.username);

    } catch (err) {
        console.error("Failed to load profile:", err);
        showAlert("Could not load your profile. Please refresh the page.", "danger");
    }
}

// ============================================================
// SAVE PROFILE  (PUT /api/user/profile)
// Reads the form, validates client-side, then sends the update.
// ============================================================
async function saveProfile(e) {
    e.preventDefault();

    const displayName    = document.getElementById("display_name").value.trim();
    const email          = document.getElementById("email").value.trim();
    const favoriteGenre  = document.getElementById("favorite_genre").value;

    // --- Client-side validation ---
    const errors = [];
    if (!displayName) errors.push("Display name is required.");
    if (!email || !email.includes("@") || !email.includes(".")) {
        errors.push("Please enter a valid email address.");
    }
    if (errors.length > 0) {
        showAlert(errors.join(" "), "warning");
        return;
    }

    // --- Show loading state ---
    const saveBtn    = document.getElementById("saveBtn");
    const btnText    = document.getElementById("saveBtnText");
    const btnSpinner = document.getElementById("saveBtnSpinner");
    saveBtn.disabled = true;
    btnText.textContent = "Saving…";
    btnSpinner.classList.remove("d-none");

    try {
        const response = await fetch("/api/user/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                display_name:   displayName,
                email:          email,
                favorite_genre: favoriteGenre,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            // Server returned validation errors
            const serverErrors = data.errors ? data.errors.join(" ") : "Update failed.";
            showAlert(serverErrors, "danger");
            return;
        }

        // Success — update the header to reflect the new display name
        updateHeader(displayName, null);
        showAlert("Profile updated successfully!");

    } catch (err) {
        console.error("Failed to save profile:", err);
        showAlert("Could not save changes. Please try again.", "danger");
    } finally {
        // Restore button state
        saveBtn.disabled = false;
        btnText.textContent = "Save Changes";
        btnSpinner.classList.add("d-none");
    }
}

const profileForm = document.getElementById("profileForm");
if (profileForm) {
    profileForm.addEventListener("submit", saveProfile);
}

loadProfile();
