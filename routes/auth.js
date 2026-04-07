// routes/auth.js
// Signup, login, logout endpoints.
// Author: Brandon Calvario

const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../config/db");

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
    // TODO: validate input, hash password, INSERT into users
    res.status(501).json({ error: "Not yet implemented" });
});

// POST /api/auth/
router.post("/login", async (req, res) => {
    // TODO: look up user, bcrypt.compare, set session
    res.status(501).json({ error: "Not yet implemented" });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

module.exports = router;