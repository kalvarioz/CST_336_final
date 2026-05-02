// ============================================================
// api/authAPI.mjs
// Authentication service layer.
//
// This module handles ALL auth-related business logic:
//   - Password hashing & comparison
//   - User lookup & creation queries
//   - Input validation
//
// The route handlers in server.mjs call these functions
// instead of touching the database or bcrypt directly.
// This keeps routes thin and logic reusable/testable.
// ============================================================

import bcrypt from "bcrypt";
import db     from "../config/db.mjs";

const SALT_ROUNDS = 10;

// ------------------------------------------------------------
// validateSignup(body)
// Returns an array of error strings (empty = valid).
// ------------------------------------------------------------
export function validateSignup({ username, email, password, confirmPassword }) {
    const errors = [];
    if (!username || username.length < 3)                errors.push("Username must be at least 3 characters");
    if (!email || !email.includes("@"))                  errors.push("Valid email is required");
    if (!password || password.length < 6)                errors.push("Password must be at least 6 characters");
    if (password !== confirmPassword)                    errors.push("Passwords do not match");
    return errors;
}

// ------------------------------------------------------------
// validateLogin(body)
// Returns an array of error strings (empty = valid).
// ------------------------------------------------------------
export function validateLogin({ username, password }) {
    const errors = [];
    if (!username) errors.push("Username is required");
    if (!password) errors.push("Password is required");
    return errors;
}

// ------------------------------------------------------------
// findUserByUsername(username)
// Returns the user row or null.
// ------------------------------------------------------------
export async function findUserByUsername(username) {
    const [rows] = await db.query(
        "SELECT user_id, username, display_name, password_hash FROM users WHERE username = ?",
        [username]
    );
    return rows.length > 0 ? rows[0] : null;
}

// ------------------------------------------------------------
// checkDuplicate(username, email)
// Returns true if the username OR email already exists.
// ------------------------------------------------------------
export async function checkDuplicate(username, email) {
    const [rows] = await db.query(
        "SELECT user_id FROM users WHERE username = ? OR email = ?",
        [username, email]
    );
    return rows.length > 0;
}

// ------------------------------------------------------------
// createUser({ username, email, display_name, password, favorite_genre })
// Hashes the password, inserts the row, returns the new user_id.
// ------------------------------------------------------------
export async function createUser({ username, email, display_name, password, favorite_genre }) {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const displayName    = display_name || username;

    const [result] = await db.query(
        `INSERT INTO users (username, email, display_name, password_hash, favorite_genre, show_recent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, email, displayName, hashedPassword, favorite_genre || "All", 1]
    );

    return {
        user_id:      result.insertId,
        username,
        display_name: displayName,
    };
}

// ------------------------------------------------------------
// verifyPassword(plainText, hash)
// Returns true/false. Wraps bcrypt.compare.
// ------------------------------------------------------------
export async function verifyPassword(plainText, hash) {
    return bcrypt.compare(plainText, hash);
}

// ------------------------------------------------------------
// getUserProfile(userId)
// Returns the user's profile fields (no password_hash).
// ------------------------------------------------------------
export async function getUserProfile(userId) {
    const [rows] = await db.query(
        `SELECT user_id, username, email, display_name, favorite_genre, show_recent
         FROM users WHERE user_id = ?`,
        [userId]
    );
    return rows.length > 0 ? rows[0] : null;
}

// ------------------------------------------------------------
// updateUserProfile(userId, { display_name, email, favorite_genre })
// Updates 3+ fields. Returns true on success.
// ------------------------------------------------------------
export async function updateUserProfile(userId, { display_name, email, favorite_genre }) {
    const errors = [];
    if (!display_name || display_name.trim().length === 0) errors.push("Display name is required");
    if (!email || !email.includes("@"))                    errors.push("Valid email is required");
    if (errors.length > 0) return { success: false, errors };

    await db.query(
        `UPDATE users
         SET display_name = ?, email = ?, favorite_genre = ?
         WHERE user_id = ?`,
        [display_name.trim(), email.trim(), favorite_genre || "All", userId]
    );

    return { success: true, display_name: display_name.trim() };
}
