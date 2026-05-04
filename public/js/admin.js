// public/js/admin.js
// Admin panel logic — by Maeva Akpaca
//
// Fetch calls:
//   1. GET /api/admin/users        — load all registered users
//   2. DELETE /api/admin/users/:id — delete a user

// ============================================================
// HELPERS
// ============================================================

function showAlert(message, type = "success") {
    const el = document.getElementById("adminAlert");
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove("d-none");
    setTimeout(() => el.classList.add("d-none"), 4000);
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString();
}

// ============================================================
// LOAD USERS  (GET /api/admin/users)
// ============================================================

async function loadUsers() {
    try {
        const response = await fetch("/api/admin/users");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const users = await response.json();

        document.getElementById("userCount").textContent = users.length;

        const tbody = document.getElementById("userTableBody");

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(user => `
            <tr id="user-row-${user.user_id}">
                <td>${user.user_id}</td>
                <td><span class="fw-semibold">@${user.username}</span></td>
                <td>${user.display_name || "—"}</td>
                <td><span class="text-muted small">${user.email}</span></td>
                <td>${user.favorite_genre || "All"}</td>
                <td>${formatDate(user.created_at)}</td>
                <td>
                    <button
                        class="btn btn-sm btn-outline-danger delete-user-btn"
                        data-id="${user.user_id}"
                        data-name="${user.display_name || user.username}"
                    >
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `).join("");

        // Attach delete listeners
        document.querySelectorAll(".delete-user-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                deleteTargetId = btn.dataset.id;
                document.getElementById("deleteUserName").textContent = btn.dataset.name;
                const modal = new bootstrap.Modal(document.getElementById("deleteUserModal"));
                modal.show();
            });
        });

    } catch (err) {
        console.error("Failed to load users:", err);
        document.getElementById("userTableBody").innerHTML =
            `<tr><td colspan="7" class="text-center text-danger py-4">Failed to load users.</td></tr>`;
    }
}

// ============================================================
// DELETE USER  (DELETE /api/admin/users/:id)
// ============================================================

let deleteTargetId = null;

document.getElementById("confirmDeleteUserBtn").addEventListener("click", async () => {
    try {
        const response = await fetch(`/api/admin/users/${deleteTargetId}`, {
            method: "DELETE",
        });

        if (!response.ok) {
            const data = await response.json();
            showAlert(data.error || "Could not delete user.", "danger");
            return;
        }

        // Remove row from table
        const row = document.getElementById(`user-row-${deleteTargetId}`);
        if (row) row.remove();

        // Update count
        const countEl = document.getElementById("userCount");
        countEl.textContent = parseInt(countEl.textContent) - 1;

        bootstrap.Modal.getInstance(document.getElementById("deleteUserModal")).hide();
        showAlert("User deleted successfully.");

    } catch (err) {
        console.error("Delete user failed:", err);
        showAlert("Network error. Please try again.", "danger");
    }
});

// ============================================================
// INIT
// ============================================================
loadUsers();