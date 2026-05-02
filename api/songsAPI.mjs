// ============================================================
// api/songsAPI.mjs
// Song service layer.
//
// Handles ALL song-related business logic:
//   - Listing/searching songs from the database
//   - Looking up cloud keys for streaming
//   - Cover art URL generation
//
// The streaming proxy in server.mjs calls these functions
// to get the cloud_key, then handles the R2 pipe itself
// (since that requires the Express req/res objects).
// ============================================================

import db                  from "../config/db.mjs";
import { getCoverArtUrl }  from "../config/musicbrainz.mjs";

// ------------------------------------------------------------
// getAllSongs({ search, genre })
// Returns an array of song objects enriched with cover_art_url.
// Supports optional full-text search and genre filtering.
// ------------------------------------------------------------
export async function getAllSongs({ search, genre } = {}) {
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
    return rows.map(song => ({
        ...song,
        cover_art_url: getCoverArtUrl(song.mb_release_id),
    }));
}

// ------------------------------------------------------------
// getCloudKey(songId)
// Returns the R2 object key for a given song_id, or null.
// This is the ONLY way the streaming proxy gets the key —
// the client never sees it.
// ------------------------------------------------------------
export async function getCloudKey(songId) {
    const id = parseInt(songId, 10);
    if (isNaN(id)) return null;

    const [rows] = await db.query(
        "SELECT cloud_key FROM songs WHERE song_id = ?",
        [id]
    );

    return rows.length > 0 ? rows[0].cloud_key : null;
}

// ------------------------------------------------------------
// getSongById(songId)
// Returns a single song's full metadata, or null.
// ------------------------------------------------------------
export async function getSongById(songId) {
    const id = parseInt(songId, 10);
    if (isNaN(id)) return null;

    const [rows] = await db.query(
        `SELECT song_id, title, artist, album, genre,
                duration_sec, mb_release_id
         FROM songs WHERE song_id = ?`,
        [id]
    );

    if (rows.length === 0) return null;

    return {
        ...rows[0],
        cover_art_url: getCoverArtUrl(rows[0].mb_release_id),
    };
}
