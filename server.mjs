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
// ============================================================
// server.mjs
// SoundVault main entry point (ES Module version).
//
// ARCHITECTURE:
//   server.mjs    → routes only (thin handlers)
//   api/*.mjs     → business logic (queries, validation, hashing)
//   config/*.mjs  → infrastructure (DB pool, R2 client, etc.)
//
// Each route handler follows the same pattern:
//   1. Parse the request (params, body, session)
//   2. Call an API function (all logic lives there)
//   3. Send the response
//
// Security notes:
//   - Passwords are hashed with bcrypt inside authAPI.mjs
//   - Audio streams through our Express proxy — the browser
//     never sees the R2 URL or credentials
//   - Session cookie is httpOnly (JS can't read it)
//   - The requireLogin middleware gates protected routes
// ============================================================

// import dotenv       from "dotenv";
// dotenv.config();

// import express      from "express";
// import session      from "express-session";
// import path         from "path";
// import { fileURLToPath }    from "url";
// import { GetObjectCommand } from "@aws-sdk/client-s3";

// // --- Config imports (infrastructure) ---
// import db                        from "./config/db.mjs";
// import { r2Client, BUCKET_NAME } from "./config/r2.mjs";
// import { requireLogin }          from "./config/auth.mjs";
// import { searchRelease, lookupRelease, enrichSong } from "./config/musicbrainz.mjs";

// // --- API imports (business logic) ---
// import {
//     validateSignup,
//     validateLogin,
//     findUserByUsername,
//     checkDuplicate,
//     createUser,
//     verifyPassword,
//     getUserProfile,
//     updateUserProfile,
// } from "./api/authAPI.mjs";

// import {
//     getAllSongs,
//     getCloudKey,
// } from "./api/songsAPI.mjs";

// // --- __dirname equivalent for ESM ---
// const __filename = fileURLToPath(import.meta.url);
// const __dirname  = path.dirname(__filename);

// // --- Express app ---
// const app  = express();
// const PORT = process.env.PORT || 3000;


// // ============================================================
// // MIDDLEWARE
// // ============================================================

// app.set("view engine", "ejs");
// app.set("views", path.join(__dirname, "views"));

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(express.static(path.join(__dirname, "public")));

// // --- Sessions ---
// app.use(session({
//     secret: process.env.SESSION_SECRET || "taco",
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         httpOnly: true,
//         maxAge:   1000 * 60 * 60 * 24,   // 24 hours
//     },
// }));

// // --- Make session user available to ALL EJS views ---
// app.use((req, res, next) => {
//     res.locals.user = req.session.user_id
//         ? {
//               id:          req.session.user_id,
//               username:    req.session.username,
//               displayName: req.session.display_name,
//           }
//         : null;
//     next();
// });


// // ============================================================
// // PAGE ROUTES  (render EJS views)
// // ============================================================

// app.get("/", (req, res) => {
//     if (req.session.user_id) return res.redirect("/index");
//     res.redirect("/login");
// });

// app.get("/login", (req, res) => {
//     if (req.session.user_id) return res.redirect("/index");
//     res.render("login", { title: "Login – SoundVault" });
// });

// app.get("/signup", (req, res) => {
//     if (req.session.user_id) return res.redirect("/index");
//     res.render("signup", { title: "Sign Up – SoundVault" });
// });

// app.get("/index", requireLogin, (req, res) => {
//     res.render("index", { title: "Library – SoundVault" });
// });

// app.get("/admin", requireLogin, (req, res) => {
//     res.render("admin", { title: "Admin – SoundVault" });
// });


// // ============================================================
// // AUTH API ROUTES  (/api/auth/*)
// //
// // These routes are thin — they parse the request, call an
// // authAPI function, and send the result. No SQL or bcrypt here.
// // ============================================================

// // POST /api/auth/signup
// app.post("/api/auth/signup", async (req, res) => {
//     try {
//         // 1. Validate input
//         const errors = validateSignup(req.body);
//         if (errors.length > 0) return res.status(400).json({ errors });

//         // 2. Check for duplicate username/email
//         const { username, email, display_name, password, favorite_genre } = req.body;
//         const isDuplicate = await checkDuplicate(username, email);
//         if (isDuplicate) {
//             return res.status(409).json({ errors: ["Username or email already taken"] });
//         }

//         // 3. Create the user (hashing happens inside the API)
//         const newUser = await createUser({ username, email, display_name, password, favorite_genre });

//         // 4. Auto-login: set session
//         req.session.user_id      = newUser.user_id;
//         req.session.username     = newUser.username;
//         req.session.display_name = newUser.display_name;

//         res.status(201).json({ redirect: "/index" });

//     } catch (err) {
//         console.error("[SIGNUP]", err);
//         res.status(500).json({ errors: ["Server error during signup"] });
//     }
// });


// // POST /api/auth/login
// app.post("/api/auth/login", async (req, res) => {
//     try {
//         // 1. Validate input
//         const errors = validateLogin(req.body);
//         if (errors.length > 0) return res.status(400).json({ errors });

//         // 2. Find user by username
//         const { username, password } = req.body;
//         const user = await findUserByUsername(username);
//         if (!user) {
//             return res.status(401).json({ errors: ["Invalid username or password"] });
//         }

//         // 3. Verify password against hash
//         const match = await verifyPassword(password, user.password_hash);
//         if (!match) {
//             return res.status(401).json({ errors: ["Invalid username or password"] });
//         }

//         // 4. Set session
//         req.session.user_id      = user.user_id;
//         req.session.username     = user.username;
//         req.session.display_name = user.display_name;

//         res.render('index.ejs');

//     } catch (err) {
//         console.error("[LOGIN]", err);
//         res.status(500).json({ errors: ["Server error during login"] });
//     }
// });


// // POST /api/auth/logout
// app.post("/api/auth/logout", (req, res) => {
//     req.session.destroy(err => {
//         if (err) console.error("[LOGOUT]", err);
//         res.json({ redirect: "/login" });
//     });
// });


// // ============================================================
// // SONG API ROUTES  (/api/songs/*)
// // ============================================================

// // GET /api/songs — list/search songs
// app.get("/api/songs", async (req, res) => {
//     try {
//         const songs = await getAllSongs(req.query);
//         res.json(songs);
//     } catch (err) {
//         console.error("[GET /api/songs]", err);
//         res.status(500).json({ error: "Failed to load songs" });
//     }
// });


// // GET /api/songs/stream/:id — streaming proxy (PROTECTED)
// //
// // The R2 pipe must stay here because it needs req/res,
// // but the cloud_key lookup is delegated to songsAPI.
// app.get("/api/songs/stream/:id", requireLogin, async (req, res) => {
//     try {
//         // 1. Get the cloud key from the API (never from the client)
//         const cloudKey = await getCloudKey(req.params.id);
//         if (!cloudKey) return res.status(404).send("Song not found");

//         console.log("[STREAM] Fetching:", cloudKey);

//         // 2. Fetch from R2 (pass Range header for seeking)
//         const getCmd = new GetObjectCommand({
//             Bucket: BUCKET_NAME,
//             Key:    cloudKey,
//             Range:  req.headers.range,
//         });
//         const r2Response = await r2Client.send(getCmd);

//         // 3. Determine content type
//         const ext = cloudKey.split(".").pop().toLowerCase();
//         const mimeTypes = {
//             mp3:  "audio/mpeg",
//             m4a:  "audio/mp4",
//             mp4:  "audio/mp4",
//             flac: "audio/flac",
//             ogg:  "audio/ogg",
//             wav:  "audio/wav",
//         };
//         const contentType = r2Response.ContentType
//             || mimeTypes[ext]
//             || "application/octet-stream";

//         // 4. Set response headers
//         res.setHeader("Content-Type", contentType);
//         if (r2Response.ContentLength) res.setHeader("Content-Length", r2Response.ContentLength);
//         if (r2Response.ContentRange) {
//             res.setHeader("Content-Range", r2Response.ContentRange);
//             res.status(206);
//         }
//         res.setHeader("Accept-Ranges", "bytes");
//         res.setHeader("Cache-Control", "no-store");

//         // 5. Pipe the R2 stream to the browser
//         r2Response.Body.pipe(res);
//         r2Response.Body.on("error", err => {
//             console.error("[STREAM] R2 stream error:", err);
//             if (!res.headersSent) res.status(500).end();
//         });

//     } catch (err) {
//         console.error("[STREAM] Error:", err);
//         if (!res.headersSent) res.status(500).send("Stream failed");
//     }
// });


// // ============================================================
// // USER PROFILE API  (/api/user/*)
// // Rubric: UPDATE SQL with at least 3 fields, pre-filled form
// // ============================================================

// // GET /api/user/profile
// app.get("/api/user/profile", requireLogin, async (req, res) => {
//     try {
//         const profile = await getUserProfile(req.session.user_id);
//         if (!profile) return res.status(404).json({ error: "User not found" });
//         res.json(profile);
//     } catch (err) {
//         console.error("[GET /api/user/profile]", err);
//         res.status(500).json({ error: "Failed to load profile" });
//     }
// });

// // PUT /api/user/profile
// app.put("/api/user/profile", requireLogin, async (req, res) => {
//     try {
//         const result = await updateUserProfile(req.session.user_id, req.body);

//         if (!result.success) {
//             return res.status(400).json({ errors: result.errors });
//         }

//         // Keep session in sync
//         req.session.display_name = result.display_name;
//         res.json({ message: "Profile updated" });

//     } catch (err) {
//         console.error("[PUT /api/user/profile]", err);
//         res.status(500).json({ error: "Failed to update profile" });
//     }
// });


// // ============================================================
// // MUSICBRAINZ API  (/api/musicbrainz/*)
// // Rubric: 2+ external Web APIs
// // ============================================================

// app.get("/api/musicbrainz/search", async (req, res) => {
//     const { artist, album } = req.query;
//     if (!artist || !album) {
//         return res.status(400).json({ error: "artist and album are required" });
//     }
//     const result = await searchRelease(artist, album);
//     res.json(result || { message: "No results found" });
// });

// app.get("/api/musicbrainz/release/:id", async (req, res) => {
//     const result = await lookupRelease(req.params.id);
//     res.json(result || { message: "Release not found" });
// });


// // ============================================================
// // SONG ENRICHMENT  (/api/songs/enrich/*)
// //
// // Auto-complete missing MusicBrainz data for songs in the DB.
// // When a user selects a song, the client calls this endpoint
// // to fill in mb_release_id and genre from MusicBrainz.
// // This only updates songs that have NULL mb_release_id.
// // ============================================================

// // POST /api/songs/enrich/:id — enrich a single song
// app.post("/api/songs/enrich/:id", requireLogin, async (req, res) => {
//     const songId = parseInt(req.params.id, 10);
//     if (isNaN(songId)) return res.status(400).json({ error: "Invalid song ID" });

//     try {
//         // 1. Look up the song
//         const [rows] = await db.query(
//             "SELECT song_id, title, artist, album, genre, mb_release_id FROM songs WHERE song_id = ?",
//             [songId]
//         );
//         if (rows.length === 0) return res.status(404).json({ error: "Song not found" });

//         const song = rows[0];

//         // 2. Skip if already enriched
//         if (song.mb_release_id) {
//             return res.json({
//                 message: "Already enriched",
//                 mb_release_id: song.mb_release_id,
//                 genre: song.genre,
//             });
//         }

//         // 3. Skip if no album to search
//         if (!song.album) {
//             return res.json({ message: "No album name — cannot search MusicBrainz" });
//         }

//         // 4. Call the enrichSong function (searches + looks up + gets genres)
//         const enriched = await enrichSong(song.artist, song.album);
//         if (!enriched) {
//             return res.json({ message: "No MusicBrainz match found" });
//         }

//         // 5. Update the database
//         await db.query(
//             "UPDATE songs SET mb_release_id = ?, genre = ? WHERE song_id = ?",
//             [enriched.mb_release_id, enriched.genre, songId]
//         );

//         console.log(`[ENRICH] song_id ${songId}: "${song.title}" → genre="${enriched.genre}", mb_release_id="${enriched.mb_release_id}"`);

//         // 6. Return the enriched data to the client
//         res.json({
//             message:       "Enriched successfully",
//             mb_release_id: enriched.mb_release_id,
//             genre:         enriched.genre,
//             genres:        enriched.genres,
//             date:          enriched.date,
//             country:       enriched.country,
//             tracks:        enriched.tracks,
//         });

//     } catch (err) {
//         console.error("[ENRICH]", err);
//         res.status(500).json({ error: "Enrichment failed" });
//     }
// });

// // POST /api/songs/enrich-all — enrich all songs with missing data (admin)
// app.post("/api/songs/enrich-all", requireLogin, async (req, res) => {
//     try {
//         // Find all songs missing mb_release_id
//         const [songs] = await db.query(
//             "SELECT song_id, title, artist, album FROM songs WHERE mb_release_id IS NULL AND album IS NOT NULL"
//         );

//         if (songs.length === 0) {
//             return res.json({ message: "All songs already enriched", updated: 0 });
//         }

//         // Group by artist+album to minimize API calls
//         const albumMap = new Map();
//         for (const song of songs) {
//             const key = `${song.artist}|||${song.album}`;
//             if (!albumMap.has(key)) {
//                 albumMap.set(key, { artist: song.artist, album: song.album, songIds: [] });
//             }
//             albumMap.get(key).songIds.push(song.song_id);
//         }

//         let updated = 0;
//         let failed  = 0;

//         for (const [, group] of albumMap) {
//             const enriched = await enrichSong(group.artist, group.album);
//             if (!enriched) {
//                 failed += group.songIds.length;
//                 continue;
//             }

//             // Batch update all songs in this album group
//             await db.query(
//                 "UPDATE songs SET mb_release_id = ?, genre = ? WHERE song_id IN (?)",
//                 [enriched.mb_release_id, enriched.genre, group.songIds]
//             );
//             updated += group.songIds.length;

//             console.log(`[ENRICH-ALL] "${group.artist} – ${group.album}" → ${group.songIds.length} song(s) updated`);
//         }

//         res.json({
//             message: "Enrichment complete",
//             updated,
//             failed,
//             albums_searched: albumMap.size,
//         });

//     } catch (err) {
//         console.error("[ENRICH-ALL]", err);
//         res.status(500).json({ error: "Bulk enrichment failed" });
//     }
// });


// // ============================================================
// // 404 HANDLER
// // ============================================================
// app.use((req, res) => {
//     res.status(404).send("Page not found");
// });


// // ============================================================
// // START SERVER
// // ============================================================
// app.listen(PORT, () => {
//     console.log(`[SERVER] SoundVault running at http://localhost:${PORT}`);
// });
