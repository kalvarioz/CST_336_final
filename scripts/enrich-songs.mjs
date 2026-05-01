// ============================================================
// scripts/enrich-songs.mjs
//
// Enrich songs in the database with MusicBrainz data.
// Finds all songs with NULL mb_release_id, groups them by
// artist+album (so we only query MusicBrainz once per album),
// and updates the songs table with:
//   - mb_release_id  (enables cover art)
//   - genre          (mapped from MusicBrainz tags)
//
// Usage:
//   node scripts/enrich-songs.mjs
//
// Optional flags:
//   --all     Re-enrich ALL songs, even ones that already have data
//   --dry     Show what would be updated without writing to the DB
//
// MusicBrainz rate limit: 1 request/sec, so this script is
// intentionally slow. 14 songs from 1 album ≈ 4 seconds.
// 100 songs from 20 albums ≈ 60 seconds.
// ============================================================

import dotenv from "dotenv";
dotenv.config();

import mysql from "mysql2/promise";
import { enrichSong } from "../config/musicbrainz.mjs";

// --- Parse CLI flags ---
const args    = process.argv.slice(2);
const enrichAll = args.includes("--all");
const dryRun    = args.includes("--dry");

async function main() {
    console.log("==============================================");
    console.log("  SoundVault — MusicBrainz Enrichment");
    console.log("==============================================");
    if (dryRun) console.log("  *** DRY RUN — no database changes ***");
    console.log("");

    // --- Connect to DB ---
    const db = await mysql.createConnection(process.env.JAWSDB_URL);
    console.log("[DB] Connected\n");

    // --- Find songs that need enrichment ---
    let sql;
    if (enrichAll) {
        sql = "SELECT song_id, title, artist, album, genre, mb_release_id FROM songs ORDER BY artist, album, title";
        console.log("[1/3] Fetching ALL songs...");
    } else {
        sql = "SELECT song_id, title, artist, album, genre, mb_release_id FROM songs WHERE mb_release_id IS NULL ORDER BY artist, album, title";
        console.log("[1/3] Fetching songs with missing MusicBrainz data...");
    }

    const [songs] = await db.query(sql);
    console.log(`  Found ${songs.length} song(s) to enrich\n`);

    if (songs.length === 0) {
        console.log("Nothing to do. All songs already have MusicBrainz data.");
        console.log("Use --all to re-enrich everything.");
        await db.end();
        return;
    }

    // --- Group songs by artist + album ---
    // This way we only hit MusicBrainz once per unique album
    const albumGroups = new Map();

    for (const song of songs) {
        const key = `${song.artist}|||${song.album || ""}`;
        if (!albumGroups.has(key)) {
            albumGroups.set(key, {
                artist: song.artist,
                album:  song.album,
                songs:  [],
            });
        }
        albumGroups.get(key).songs.push(song);
    }

    console.log(`[2/3] ${albumGroups.size} unique album(s) to look up on MusicBrainz\n`);

    // --- Enrich each album group ---
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount  = 0;
    let groupIndex   = 0;

    for (const [key, group] of albumGroups) {
        groupIndex++;
        console.log(`[${groupIndex}/${albumGroups.size}] "${group.artist}" — "${group.album || "(no album)"}" (${group.songs.length} song(s))`);

        // Skip if no album name (can't search without it)
        if (!group.album) {
            console.log("  Skipping — no album name to search\n");
            skippedCount += group.songs.length;
            continue;
        }

        // Call the enrichSong function (hits MusicBrainz API)
        const enriched = await enrichSong(group.artist, group.album);

        if (!enriched) {
            console.log("  No MusicBrainz match found\n");
            failedCount += group.songs.length;
            continue;
        }

        console.log(`  Found: ${enriched.title} (${enriched.date || "no date"})`);
        console.log(`  Release ID: ${enriched.mb_release_id}`);
        console.log(`  MB Genres:  ${enriched.genres.join(", ") || "none"}`);
        console.log(`  Mapped to:  ${enriched.genre}`);

        // --- Update each song in this group ---
        for (const song of group.songs) {
            if (dryRun) {
                console.log(`  [DRY] Would update song_id ${song.song_id}: "${song.title}" → genre="${enriched.genre}", mb_release_id="${enriched.mb_release_id}"`);
            } else {
                await db.query(
                    `UPDATE songs
                     SET mb_release_id = ?, genre = ?
                     WHERE song_id = ?`,
                    [enriched.mb_release_id, enriched.genre, song.song_id]
                );
                console.log(`  Updated song_id ${song.song_id}: "${song.title}" → genre="${enriched.genre}"`);
            }
            updatedCount++;
        }

        console.log("");
    }

    // --- Summary ---
    console.log("==============================================");
    console.log("  Enrichment Complete");
    console.log("==============================================");
    console.log(`  Updated:  ${updatedCount} song(s)`);
    console.log(`  Skipped:  ${skippedCount} (no album name)`);
    console.log(`  Failed:   ${failedCount} (no MusicBrainz match)`);
    if (dryRun) console.log("\n  *** DRY RUN — nothing was written ***");
    console.log("==============================================");

    await db.end();
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
