/**
 * server.mjs
 * SoundVault main entry point (ES Module version).
 * Config helpers are imported from /config/*.mjs.
 * Security notes:
 *   - Passwords are hashed with bcrypt (never stored in plain text)
 *   - Audio streams through our Express proxy, the browser
 *   - never sees the R2 URL or credentials
 *   - Session cookie is httpOnly (JS can't read it)
 *   - The requireLogin middleware gates protected routes
 * 
 * @author:Brandon Calvario
 */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import session from "express-session";
import path from "path";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";
import { GetObjectCommand } from "@aws-sdk/client-s3";

// Config imports (our own ESM modules)
import db from "./config/db.mjs";
import { r2Client, BUCKET_NAME } from "./config/r2.mjs";
import { getCoverArtUrl, searchRelease, lookupRelease }
    from "./config/musicbrainz.mjs";
import { requireLogin } from "./config/auth.mjs";

// __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//Express app
const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

// MIDDLEWARE
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true, // JS can't read the cookie
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
}));

// Make session user available to ALL EJS views
app.use((req, res, next) => {
    res.locals.user = req.session.user_id
        ? {
            id: req.session.user_id,
            username: req.session.username,
            displayName: req.session.display_name,
        }
        : null;
    next();
});


// PAGE ROUTES  (render EJS views)
// Landing, redirect to login or home
app.get("/", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.redirect("/login");
});

// Login page
app.get("/login", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.render("login", { title: "Login - SoundVault" });
});

// Signup page
app.get("/signup", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.render("signup", { title: "Sign Up - SoundVault" });
});

// Home / library page (protected)
app.get("/index", requireLogin, (req, res) => {
    res.render("index.ejs", { title: "Library - SoundVault" });
});

// Admin page (protected)
app.get("/admin", requireLogin, (req, res) => {
    res.render("admin", { title: "Admin - SoundVault" });
});


// AUTH API ROUTES  (/api/auth/*)
// authenticate an existing user
app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ errors: ["Username and password are required"] });
    }
    // Look up user
    const [rows] = await db.query(
        "SELECT user_id, username, display_name, password_hash FROM users WHERE username = ?",
        [username]
    );
    if (rows.length === 0) {
        return res.status(401).json({ errors: ["Invalid username or password"] });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return res.status(401).json({ errors: ["Invalid username or password"] });
    }
    req.session.user_id = user.user_id;
    req.session.username = user.username;
    req.session.display_name = user.display_name;
    res.redirect("/index");
});

// POST /api/auth/logout, destroy the session
app.post("/api/auth/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/api/auth/login");
});

// SONG API ROUTES  (/api/songs/*)
// GET /api/songs: list songs with optional search + genre filter
app.get("/api/songs", async (req, res) => {
    const { search, genre } = req.query;
    let sql = `SELECT song_id, title, artist, album, genre,
                duration_sec, mb_release_id
                FROM songs WHERE 1=1`;
    const params = [];
    if (search) {
        sql += " AND MATCH(title, artist, album) AGAINST(? IN NATURAL LANGUAGE MODE)";
        params.push(search);
    }
    if (genre && genre !== "All") {
        sql += " AND genre = ?";
        params.push(genre);
    }
    sql += " ORDER BY artist, album, title LIMIT 200";
    const [rows] = await db.query(sql, params);
    // Enrich each song with its cover art URL
    const enriched = rows.map(song => ({
        ...song,
        cover_art_url: getCoverArtUrl(song.mb_release_id),
    }));
    res.json(enriched);
});


// GET /api/songs/stream/:id - streaming proxy
// This is the heart of the security model:
//   1. requireLogin ensures only authenticated users can stream
//   2. We look up the cloud_key from our DB (never from the client)
//   3. We fetch the object from R2 using SERVER-SIDE credentials
//   4. We pipe the stream to the browser — it never sees the R2 URL
app.get("/api/songs/stream/:id", requireLogin, async (req, res) => {
    const songId = parseInt(req.params.id, 10);
    if (isNaN(songId)) {
        return res.status(400).send("Invalid song ID");
    }
    // Step 1. look up cloud_key from MySQL
    const [rows] = await db.query(
        "SELECT cloud_key FROM songs WHERE song_id = ?",
        [songId]
    );
    if (rows.length === 0) return res.status(404).send("Song not found");
    const cloudKey = rows[0].cloud_key;
    console.log("[STREAM] Fetching:", cloudKey);
    // Step 2. fetch from R2 (pass Range header for seeking)
    const getCmd = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: cloudKey,
        Range: req.headers.range,
    });
    const r2Response = await r2Client.send(getCmd);
    // Step 3. determine content type
    const ext = cloudKey.split(".").pop().toLowerCase();
    const mimeTypes = {
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        mp4: "audio/mp4",
        flac: "audio/flac",
        ogg: "audio/ogg",
        wav: "audio/wav",
    };
    const contentType = r2Response.ContentType
        || mimeTypes[ext]
        || "application/octet-stream";
    // Step 4, set response headers
    res.setHeader("Content-Type", contentType);
    if (r2Response.ContentLength) res.setHeader("Content-Length", r2Response.ContentLength);
    if (r2Response.ContentRange) {
        res.setHeader("Content-Range", r2Response.ContentRange);
        res.status(206); // Partial Content — enables seeking
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    // Step 5, pipe the R2 stream to the browser
    r2Response.Body.pipe(res);
    r2Response.Body.on("error", err => {
        console.error("[STREAM] R2 stream error:", err);
        if (!res.headersSent) res.status(500).end();
    });

});


// USER PROFILE API (/api/user/*)
// Rubric: UPDATE SQL with at least 3 fields, pre-filled form
// GET /api/user/profile: return the logged-in user's profile
app.get("/api/user/profile", requireLogin, async (req, res) => {
    const [rows] = await db.query(
        `SELECT user_id, username, email, display_name, favorite_genre
             FROM users WHERE user_id = ?`,
        [req.session.user_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
});

// PUT /api/user/profile: update profile (at least 3 fields)
app.put("/api/user/profile", requireLogin, async (req, res) => {
    const { display_name, email, favorite_genre } = req.body;
    const errors = [];
    if (!display_name || display_name.trim().length === 0) errors.push("Display name is required");
    if (!email || !email.includes("@")) errors.push("Valid email is required");
    if (errors.length > 0) return res.status(400).json({ errors });
    // UPDATE with 3 fields (meets rubric requirement)
    await db.query(
        `UPDATE users
             SET display_name = ?, email = ?, favorite_genre = ?
             WHERE user_id = ?`,
        [display_name.trim(), email.trim(), favorite_genre || "All", req.session.user_id]
    );
    // Keep session in sync
    req.session.display_name = display_name.trim();
    res.json({ message: "Profile updated" });
});

// MUSICBRAINZ LOOKUP  (external API: rubric: 2+ Web APIs)
// GET /api/musicbrainz/search?artist=...&album=...
app.get("/api/musicbrainz/search", async (req, res) => {
    const { artist, album } = req.query;
    if (!artist || !album) {
        return res.status(400).json({ error: "artist and album are required" });
    }
    const result = await searchRelease(artist, album);
    res.json(result || { message: "No results found" });
});
// GET /api/musicbrainz/release/:id
app.get("/api/musicbrainz/release/:id", async (req, res) => {
    const result = await lookupRelease(req.params.id);
    res.json(result || { message: "Release not found" });
});
// app.use((req, res) => {
//     res.status(404).send("Page not found");
// });

app.listen(PORT, () => {
    console.log(`[SERVER] SoundVault running at http://localhost:${PORT}`);
});
