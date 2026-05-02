function showClientErrors(containerId, errors) {
    // Remove any existing client-side error box
    const existing = document.getElementById(containerId);
    if (existing) existing.remove();
    if (errors.length === 0) return;
    // Create the error box
    const div = document.createElement("div");
    div.id = containerId;
    div.className = "alert alert-warning";
    div.role = "alert";
    div.innerHTML = errors.map(e => `<div>${e}</div>`).join("");
    // Insert it before the form
    const form = document.querySelector("form");
    if (form) form.parentNode.insertBefore(div, form);
}
// Clear the client-side error box
function clearClientErrors(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.remove();
}

// LOGIN FORM VALIDATION
const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
        clearClientErrors("clientErrors");
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        // Client-side validation
        const errors = [];
        if (!username) errors.push("Username is required");
        if (!password) errors.push("Password is required");
        if (errors.length > 0) {
            // Block submission and show errors
            e.preventDefault();
            showClientErrors("clientErrors", errors);
            return;
        }
        // No errors form submits normally to the server
        // (no e.preventDefault(), so the browser POSTs to action URL)
    });
}

// SIGNUP FORM VALIDATION
const signupForm = document.getElementById("signupForm");
if (signupForm) {
    signupForm.addEventListener("submit", (e) => {
        clearClientErrors("clientErrors");
        const username = document.getElementById("username").value.trim();
        const email= document.getElementById("email").value.trim();
        const password= document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        // Client-side validation
        const errors = [];
        if (!username || username.length < 3) {
            errors.push("Username must be at least 3 characters");
        }
        if (!email || !email.includes("@") || !email.includes(".")) {
            errors.push("Please enter a valid email address");
        }
        if (!password || password.length < 6) {
            errors.push("Password must be at least 6 characters");
        }
        if (password !== confirmPassword) {
            errors.push("Passwords do not match");
        }
        if (errors.length > 0) {
            // Block submission and show errors
            e.preventDefault();
            showClientErrors("clientErrors", errors);
            return;
        }

        // No errorsform submits normally to the server
    });
}
