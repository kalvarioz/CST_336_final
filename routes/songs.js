// routes/songs.js
// Song library endpoints + the streaming proxy.
// Author: Brandon Calvario
//

const express = require("express");
const router = express.Router();
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const db = require("../config/db");
const { r2Client, BUCKET_NAME } = require("../config/r2");
const { getCoverArtUrl } = require("../config/musicbrainz");

// GET /api/songs
// List all songs (with optional search + genre filters)
router.get("/", async (req, res) => {
    try {
        const { search, genre } = req.query;
        let sql = "SELECT song_id, title, artist, album, genre, duration_sec, mb_release_id FROM songs WHERE 1=1";
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
        // Enrich each song with its cover art URL (client uses this directly)
        const enriched = rows.map(song => ({
            ...song,
            cover_art_url: getCoverArtUrl(song.mb_release_id),
        }));
        res.json(enriched);
    } catch (err) {
        console.error("[GET /songs]", err);
        res.status(500).json({ error: "Failed to load songs" });
    }
});

// GET /api/songs/stream/:id
// streaming proxy
//
// 1. Verify user is logged in (session check)
// 2. Look up the song's cloud_key in our database
// 3. Request the object from R2 using SERVER credentials
// 4. Pipe the stream directly to the browser response

router.get("/stream/:id", async (req, res) => {
    // Auth check (currently commented out for smoke testing)
    if (!req.session || !req.session.userId) {
        return res.status(401).send("Unauthorized");
    }
    const songId = parseInt(req.params.id, 10);
    if (isNaN(songId)) {
        return res.status(400).send("Invalid song ID");
    }
    try {
        // Step 1: Look up the cloud_key from MySQL
        const [rows] = await db.query(
            "SELECT cloud_key FROM songs WHERE song_id = ?",
            [songId]
        );
        if (rows.length === 0) {
            return res.status(404).send("Song not found");
        }
        const cloudKey = rows[0].cloud_key;
        // Step 2: Fetch the object from R2 (passing through Range header for seek support)
        const getCmd = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: cloudKey,
            Range: req.headers.range,
        });
        const r2Response = await r2Client.send(getCmd);
        // Step 3: Determine content type — prefer R2's metadata, fall back to extension
        const ext = cloudKey.split(".").pop().toLowerCase();
        const mimeTypes = {
            mp3:  "audio/mpeg",
            m4a:  "audio/mp4",
            mp4:  "audio/mp4",
            flac: "audio/flac",
            ogg:  "audio/ogg",
            wav:  "audio/wav",
        };
        const contentType = r2Response.ContentType || mimeTypes[ext] || "application/octet-stream";
        // Step 4: Set response headers
        res.setHeader("Content-Type", contentType);
        if (r2Response.ContentLength) {
            res.setHeader("Content-Length", r2Response.ContentLength);
        }
        if (r2Response.ContentRange) {
            res.setHeader("Content-Range", r2Response.ContentRange);
            res.status(206);
        }
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store");
        // Step 5: Pipe the R2 stream to the browser
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
module.exports = router;
