// public/js/profile.js
// Profile page logic — by Maeva Akpaca
//
// Fetch calls:
//   1. GET /api/user/profile    — load and pre-fill the form
//   2. PUT /api/user/profile    — save updated profile
//   3. DELETE /api/user/profile — delete the user's own account

// ============================================================
// HELPERS
// ============================================================

function showAlert(message, type = "success") {
    const alert = document.getElementById("profileAlert");
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.classList.remove("d-none");
    setTimeout(() => alert.classList.add("d-none"), 4000);
}

function getInitials(name) {
    if (!name) return "?";
    return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join("");
}

function updateHeader(displayName, username) {
    document.getElementById("avatarCircle").textContent = getInitials(displayName);
    document.getElementById("headerDisplayName").textContent = displayName || "—";
    document.getElementById("headerUsername").textContent = username ? `@${username}` : "";
}

// ============================================================
// LOAD PROFILE  (GET /api/user/profile)
// ============================================================

async function loadProfile() {
    try {
        const response = await fetch("/api/user/profile");
        if (!response.ok) {
            if (response.status === 401) { window.location.href = "/login"; return; }
            throw new Error(`HTTP ${response.status}`);
        }
        const profile = await response.json();
        document.getElementById("display_name").value   = profile.display_name  || "";
        document.getElementById("email").value          = profile.email          || "";
        document.getElementById("favorite_genre").value = profile.favorite_genre || "All";
        updateHeader(profile.display_name, profile.username);
    } catch (err) {
        console.error("Failed to load profile:", err);
        showAlert("Could not load your profile. Please refresh the page.", "danger");
    }
}

// ============================================================
// SAVE PROFILE  (PUT /api/user/profile)
// ============================================================

async function saveProfile(e) {
    e.preventDefault();
    const displayName   = document.getElementById("display_name").value.trim();
    const email         = document.getElementById("email").value.trim();
    const favoriteGenre = document.getElementById("favorite_genre").value;

    const errors = [];
    if (!displayName) errors.push("Display name is required.");
    if (!email || !email.includes("@") || !email.includes(".")) errors.push("Please enter a valid email.");
    if (errors.length > 0) { showAlert(errors.join(" "), "warning"); return; }

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
            body: JSON.stringify({ display_name: displayName, email, favorite_genre: favoriteGenre }),
        });
        const data = await response.json();
        if (!response.ok) {
            showAlert(data.errors ? data.errors.join(" ") : "Update failed.", "danger");
            return;
        }
        updateHeader(displayName, null);
        showAlert("Profile updated successfully!");
    } catch (err) {
        console.error("Failed to save profile:", err);
        showAlert("Could not save changes. Please try again.", "danger");
    } finally {
        saveBtn.disabled = false;
        btnText.textContent = "Save Changes";
        btnSpinner.classList.add("d-none");
    }
}

// ============================================================
// DELETE ACCOUNT  (DELETE /api/user/profile)
// ============================================================

document.getElementById("deleteAccountBtn").addEventListener("click", () => {
    const modal = new bootstrap.Modal(document.getElementById("deleteAccountModal"));
    modal.show();
});

document.getElementById("confirmDeleteAccountBtn").addEventListener("click", async () => {
    try {
        const response = await fetch("/api/user/profile", { method: "DELETE" });
        if (!response.ok) {
            const data = await response.json();
            showAlert(data.error || "Could not delete account.", "danger");
            return;
        }
        // Account deleted — redirect to login
        window.location.href = "/login";
    } catch (err) {
        console.error("Delete account failed:", err);
        showAlert("Network error. Please try again.", "danger");
    }
});


document.getElementById("profileForm").addEventListener("submit", saveProfile);

loadProfile();