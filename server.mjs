
// server.mjs
// SoundVault main entry point
// ARCHITECTURE:
//   server.mjs: routes only (thin handlers)
//   api/*.mjs: business logic (queries, validation, hashing)
//   config/*.mjs: infrastructure (DB pool, R2 client, etc.)
//
// Each route handler follows the same pattern:
//   1. Parse the request (params, body, session)
//   2. Call an API function (all logic lives there)
//   3. Send the response
//
// Security notes:
//   - Passwords are hashed with bcrypt inside authAPI.mjs
//   - Audio streams through our Express proxy, the browser
//     never sees the R2 URL or credentials
//   - Session cookie is httpOnly (JS can't read it)
//   - The requireLogin middleware gates protected routes

/** 
 * @authors: Brandon Calvario, Matthew Barrett
*/

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import db from "./config/db.mjs";
import { r2Client, BUCKET_NAME } from "./config/r2.mjs";
import { requireLogin } from "./config/auth.mjs";
import { searchRelease, lookupRelease, enrichSong } from "./config/musicbrainz.mjs";
//API imports (business logic)
import {
    validateSignup,
    validateLogin,
    findUserByUsername,
    checkDuplicate,
    createUser,
    verifyPassword,
    getUserProfile,
    updateUserProfile,
} from "./api/authAPI.mjs";
import {
    getAllSongs,
    getCloudKey,
} from "./api/songsAPI.mjs";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: process.env.SESSION_SECRET || "taco",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge:   1000 * 60 * 60 * 24,   // 24 hours
    },
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user_id
        ? {
              id:req.session.user_id,
              username:  req.session.username,
              displayName: req.session.display_name,
          }
        : null;
    next();
}); 
app.get("/", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.redirect("/login");
});

app.get("/login", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.render("login", { title: "Login - SoundVault", errors: [] });
});

app.get("/signup", (req, res) => {
    if (req.session.user_id) return res.redirect("/index");
    res.render("signup", { title: "Sign Up - SoundVault", errors: [] });
});

app.get("/index", requireLogin, (req, res) => {
    res.render("index", { title: "Library - SoundVault" });
});

app.get("/admin", requireLogin, (req, res) => {
    res.render("admin", { title: "Admin - SoundVault" });
});

app.get("/profile", requireLogin, (req, res) => {
    res.render("profile", { title: "My Profile – SoundVault" });
});
 
app.get("/library",requireLogin, (req, res) => {
    res.render("library", { title: "Your Library - Soundvault" });
});

// AUTH ROUTES  (/api/auth/*)
//
// These use traditional form submission (not fetch/JSON).
// On success: res.redirect()
// On failure:  res.render() with error messages
// POST /api/auth/signup
app.post("/api/auth/signup", async (req, res) => {
    try {
        // 1. Validate input
        const errors = validateSignup(req.body);
        if (errors.length > 0) {
            return res.render("signup", { title: "Sign Up - SoundVault", errors });
        }
        // 2. Check for duplicate username/email
        const { username, email, display_name, password, favorite_genre } = req.body;
        const isDuplicate = await checkDuplicate(username, email);
        if (isDuplicate) {
            return res.render("signup", {
                title: "Sign Up - SoundVault",
                errors: ["Username or email already taken"],
            });
        }
        // 3. Create the user (hashing happens inside the API)
        const newUser = await createUser({ username, email, display_name, password, favorite_genre });
        // 4. Auto-login: set session
        req.session.user_id = newUser.user_id;
        req.session.username = newUser.username;
        req.session.display_name = newUser.display_name;
        // 5. Redirect to home page
        res.redirect("/index");
    } catch (err) {
        console.error("[SIGNUP]", err);
        res.render("signup", {
            title: "Sign Up - SoundVault",
            errors: ["Server error during signup. Please try again."],
        });
    }
});


// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
    try {
        // 1. Validate input
        const errors = validateLogin(req.body);
        if (errors.length > 0) {
            return res.render("login", { title: "Login - SoundVault", errors });
        }
        // 2. Find user by username
        const { username, password } = req.body;
        const user = await findUserByUsername(username);
        if (!user) {
            return res.render("login", {
                title: "Login - SoundVault",
                errors: ["Invalid username or password"],
            });
        }
        // 3. Verify password against hash
        const match = await verifyPassword(password, user.password_hash);
        if (!match) {
            return res.render("login", {
                title: "Login - SoundVault",
                errors: ["Invalid username or password"],
            });
        }
        // 4. Set session
        req.session.user_id = user.user_id;
        req.session.username = user.username;
        req.session.display_name = user.display_name;
        // 5. Redirect to home page
        res.redirect("/index");
    } catch (err) {
        console.error("[LOGIN]", err);
        res.render("login", {
            title: "Login - SoundVault",
            errors: ["Server error during login. Please try again."],
        });
    }
});

// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) console.error("[LOGOUT]", err);
        res.redirect("/login");
    });
});

// SONG API ROUTES  (/api/songs/*)
// GET /api/songs, list/search songs
app.get("/api/songs", async (req, res) => {
    try {
        const songs = await getAllSongs(req.query);
        res.json(songs);
    } catch (err) {
        console.error("[GET /api/songs]", err);
        res.status(500).json({ error: "Failed to load songs" });
    }
});


// GET /api/songs/stream/:id — streaming proxy (PROTECTED)
//
// The R2 pipe must stay here because it needs req/res,
// but the cloud_key lookup is delegated to songsAPI.
app.get("/api/songs/stream/:id", requireLogin, async (req, res) => {
    try {
        // 1. Get the cloud key from the API (never from the client)
        const cloudKey = await getCloudKey(req.params.id);
        if (!cloudKey) return res.status(404).send("Song not found");
        console.log("[STREAM] Fetching:", cloudKey);
        // 2. Fetch from R2 (pass Range header for seeking)
        const getCmd = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key:cloudKey,
            Range:req.headers.range,
        });
        const r2Response = await r2Client.send(getCmd);

        // 3. Determine content type
        const ext = cloudKey.split(".").pop().toLowerCase();
        const mimeTypes = {
            mp3:"audio/mpeg",
            m4a:"audio/mp4",
            mp4:"audio/mp4",
            flac:"audio/flac",
            ogg:"audio/ogg",
            wav:"audio/wav",
        };
        const contentType = r2Response.ContentType
            || mimeTypes[ext]
            || "application/octet-stream";

        // 4. Set response headers
        res.setHeader("Content-Type", contentType);
        if (r2Response.ContentLength) res.setHeader("Content-Length", r2Response.ContentLength);
        if (r2Response.ContentRange) {
            res.setHeader("Content-Range", r2Response.ContentRange);
            res.status(206);
        }
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store");
        // 5. Pipe the R2 stream to the browser
        r2Response.Body.pipe(res);
        r2Response.Body.on("error", err => {
            console.error("[STREAM] R2 stream error:", err);
            if (!res.headersSent) res.status(500).end();
        });
    } catch (err) {
        console.error("[STREAM] Error:", err);
        if (!res.headersSent) res.status(500).send("Stream failed");
    }
});


// USER PROFILE API  (/api/user/*)
// Rubric: UPDATE SQL with at least 3 fields, pre-filled form
// GET /api/user/profile
app.get("/api/user/profile", requireLogin, async (req, res) => {
    try {
        const profile = await getUserProfile(req.session.user_id);
        if (!profile) return res.status(404).json({ error: "User not found" });
        res.json(profile);
    } catch (err) {
        console.error("[GET /api/user/profile]", err);
        res.status(500).json({ error: "Failed to load profile" });
    }
});
// PUT /api/user/profile
app.put("/api/user/profile", requireLogin, async (req, res) => {
    try {
        const result = await updateUserProfile(req.session.user_id, req.body);
        if (!result.success) {
            return res.status(400).json({ errors: result.errors });
        }
        // Keep session in sync
        req.session.display_name = result.display_name;
        res.json({ message: "Profile updated" });
    } catch (err) {
        console.error("[PUT /api/user/profile]", err);
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// MUSICBRAINZ API  (/api/musicbrainz/*)
// Rubric: 2+ external Web APIs
app.get("/api/musicbrainz/search", async (req, res) => {
    const { artist, album } = req.query;
    if (!artist || !album) {
        return res.status(400).json({ error: "artist and album are required" });
    }
    const result = await searchRelease(artist, album);
    res.json(result || { message: "No results found" });
});

app.get("/api/musicbrainz/release/:id", async (req, res) => {
    const result = await lookupRelease(req.params.id);
    res.json(result || { message: "Release not found" });
});


// SONG ENRICHMENT  (/api/songs/enrich/*)
//
// Auto-complete missing MusicBrainz data for songs in the DB.
// When a user selects a song, the client calls this endpoint
// to fill in mb_release_id and genre from MusicBrainz.
// This only updates songs that have NULL mb_release_id.

// POST /api/songs/enrich/:id, enrich a single song
app.post("/api/songs/enrich/:id", requireLogin, async (req, res) => {
    const songId = parseInt(req.params.id, 10);
    if (isNaN(songId)) return res.status(400).json({ error: "Invalid song ID" });
    try {
        // 1. Look up the song
        const [rows] = await db.query(
            "SELECT song_id, title, artist, album, genre, mb_release_id FROM songs WHERE song_id = ?",
            [songId]
        );
        if (rows.length === 0) return res.status(404).json({ error: "Song not found" });
        const song = rows[0];
        // 2. Skip if already enriched
        if (song.mb_release_id) {
            return res.json({
                message: "Already enriched",
                mb_release_id: song.mb_release_id,
                genre: song.genre,
            });
        }
        // 3. Skip if no album to search
        if (!song.album) {
            return res.json({ message: "No album name, cannot search MusicBrainz" });
        }
        // 4. Call the enrichSong function (searches + looks up + gets genres)
        const enriched = await enrichSong(song.artist, song.album);
        if (!enriched) {
            return res.json({ message: "No MusicBrainz match found" });
        }
        // 5. Update the database
        await db.query(
            "UPDATE songs SET mb_release_id = ?, genre = ? WHERE song_id = ?",
            [enriched.mb_release_id, enriched.genre, songId]
        );
        console.log(`[ENRICH] song_id ${songId}: "${song.title}": genre="${enriched.genre}", mb_release_id="${enriched.mb_release_id}"`);
        // 6. Return the enriched data to the client
        res.json({
            message:"Enriched successfully",
            mb_release_id: enriched.mb_release_id,
            genre:enriched.genre,
            genres:enriched.genres,
            date:enriched.date,
            country:enriched.country,
            tracks:enriched.tracks,
        });
    } catch (err) {
        console.error("[ENRICH]", err);
        res.status(500).json({ error: "Enrichment failed" });
    }
});

// POST /api/songs/enrich-all, enrich all songs with missing data (admin)
app.post("/api/songs/enrich-all", requireLogin, async (req, res) => {
    try {
        // Find all songs missing mb_release_id
        const [songs] = await db.query(
            "SELECT song_id, title, artist, album FROM songs WHERE mb_release_id IS NULL AND album IS NOT NULL"
        );
        if (songs.length === 0) {
            return res.json({ message: "All songs already enriched", updated: 0 });
        }
        // Group by artist+album to minimize API calls
        const albumMap = new Map();
        for (const song of songs) {
            const key = `${song.artist}|||${song.album}`;
            if (!albumMap.has(key)) {
                albumMap.set(key, { artist: song.artist, album: song.album, songIds: [] });
            }
            albumMap.get(key).songIds.push(song.song_id);
        }
        let updated = 0;
        let failed  = 0;
        for (const [, group] of albumMap) {
            const enriched = await enrichSong(group.artist, group.album);
            if (!enriched) {
                failed += group.songIds.length;
                continue;
            }
            // Batch update all songs in this album group
            await db.query(
                "UPDATE songs SET mb_release_id = ?, genre = ? WHERE song_id IN (?)",
                [enriched.mb_release_id, enriched.genre, group.songIds]
            );
            updated += group.songIds.length;
            console.log(`[ENRICH-ALL] "${group.artist} – ${group.album}":  ${group.songIds.length} song(s) updated`);
        }
        res.json({
            message: "Enrichment complete",
            updated,
            failed,
            albums_searched: albumMap.size,
        });

    } catch (err) {
        console.error("[ENRICH-ALL]", err);
        res.status(500).json({ error: "Bulk enrichment failed" });
    }
});

// START SERVER
app.listen(PORT, () => {
    console.log(`[SERVER] SoundVault running at http://localhost:${PORT}`);
});
// Playlist features by Matthew Barrett
// Generate Playlist
//TODO:
//1. Allow users to edit playlist name/description (DONE)
//2. Allow users to delete playlists
//3. Allow users to add songs to playlist when inside playlist.ejs route
//4. Allow users to add songs to playlist when insdie library.ejs route
//5. Allow users to create accounts
//6. Make it not look like shit

app.post('/api/playlist', requireLogin, async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.session.user_id;
        if (name == null || name == undefined) {
            return res.send("Playlist must have a name");
        }
        let trimmedName = name.trim();
        if (trimmedName.length <= 3) {
            return res.send("Playlist name must be longer than three characters");
        }
        const [rows] = await db.query(`
            INSERT INTO playlists (name, description, user_id)
            VALUES (?,?,?)`, [trimmedName, description || null, userId]
        );
        res.redirect('/playlists');
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Playlist failed" });
        // not 100% sure what this does but it was in every other try catch and i dont wanna cause problems
    }
}); 
// Get playlists

app.get('/playlists', requireLogin, async (req, res) => {
    const userId = req.session.user_id;
    const [playlists] = await db.query
    (` SELECT *
       FROM playlists
       WHERE user_id = ?`, [userId]
    );
    res.render('playlists', { playlists });
});

// View Playlist
app.get('/playlist/:id', requireLogin, async (req,res) => {
    const userId = req.session.user_id;
    const playlistId = req.params.id;
    const [rows] = await db.query
    (`SELECT *
      FROM playlists
      WHERE playlist_id = ?
      AND user_id = ?        
     `,[playlistId, userId]);
    if (rows.length == 0) {
        return res.render('playlists');
    }
    res.render('playlist', {playlist: rows[0]});
});

// Create new playlist
app.get('/newPlaylist', requireLogin, async (req, res) => {
    res.render('newPlaylist.ejs');
});

//Edit existing Playlist
app.get('/editPlaylist/:id', requireLogin, async (req, res) => {
    const playlistId = req.params.id;
    const userId = req.session.user_id;
    const [rows] = await db.query
    (`SELECT *
      FROM playlists
      WHERE playlist_id = ?
      AND user_id = ?        
     `,[playlistId, userId]);
    if (rows.length == 0) {
        return res.render('playlists');
    }
    res.render('editPlaylist', {playlist: rows[0]});
});

app.post('/api/editPlaylist', requireLogin, async (req, res) => {
    try {
        const { name, description, playlistId } = req.body;
        const userId = req.session.user_id;
        if (name == null || name == undefined) {
            return res.send("Playlist must have a name");
        }
        let trimmedName = name.trim();
        if (trimmedName.length <= 3) {
            return res.send("Playlist name must be longer than three characters");
        }
        const [rows] = await db.query(`
            UPDATE playlists
            SET name = ?, description = ?
            WHERE playlist_id = ?
            `, [trimmedName, description || null, playlistId]);
        res.redirect('/playlists');
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Edit Playlist failed" });
    }
}); 

//Delete playlist
app.post('/api/deletePlaylist', requireLogin, async (req, res) => {
    try {
        const { playlistId } = req.body;
        const userId = req.session.user_id;
        const [rows] = await db.query(`
            DELETE FROM playlists
            WHERE playlist_id = ? AND user_id = ?
            `, [playlistId, userId]);
        res.redirect('/playlists');
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Delete Playlist failed" });
    }
}); 

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
    res.status(404).send("Page not found");
});