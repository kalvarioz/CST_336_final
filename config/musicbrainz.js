// config/musicbrainz.js
// Helper functions for the MusicBrainz Web Service (v2).
//
// Two main use cases:
// 1. searchRelease() - find a release ID by artist + album
// 2. lookupRelease() - get full details for a known release ID
//
// MusicBrainz REQUIRES a descriptive User-Agent header and
// enforces a rate limit of 1 request per second per IP.
// We handle both here.
// Author: Brandon Calvario

const MB_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "SoundVault/1.0 (student-project; CST336)";

// Simple rate limiter: ensures at least 1100ms between calls
let lastCallTime = 0;
async function rateLimit() {
    const now = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < 1100) {
        await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    lastCallTime = Date.now();
}

// searchRelease(artist, album)
// Search MusicBrainz for a release matching an artist + album.
// Returns a SIMPLIFIED object with just the fields we care about.
//
// This is where the "JSON parsing" happens, we pluck 3-4 fields
// out of the giant MusicBrainz response and ignore the rest.
async function searchRelease(artist, album) {
    await rateLimit();
    // Build the query string. MusicBrainz uses Lucene-style syntax.
    const query = `artist:"${artist}" AND release:"${album}"`;
    const url = `${MB_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT }
        });
        if (!response.ok) {
            console.error(`[MB] Search failed: ${response.status}`);
            return null;
        }
        const data = await response.json();

        // JSON parsing: extract only what we need
        // The raw response has a "releases" array with each entry
        // containing 50+ fields. We only want a handful.
        if (!data.releases || data.releases.length === 0) {
            return null;
        }
        // Take the top result and map it to our simplified shape
        const top = data.releases[0];
        return {
            mb_release_id: top.id,// The UUID we'll store in our DB
            title: top.title,
            artist:top["artist-credit"]?.[0]?.name || artist,
            date:top.date || null, // First-release date (YYYY or YYYY-MM-DD)
            country: top.country || null,
            score:top.score,// MB's confidence score (0-100)
        };
    } catch (err) {
        console.error("[MB] searchRelease error:", err.message);
        return null;
    }
}

// lookupRelease(mbReleaseId)
// Get full details for a known release ID.
// Use this when you already have an ID saved in your DB and
// want fresh metadata (e.g., to enrich a song listing).
async function lookupRelease(mbReleaseId) {
    await rateLimit();
    // inc=artist-credits+recordings tells MB to include the
    // artist info and the tracklist in the response
    const url = `${MB_BASE}/release/${mbReleaseId}?inc=artist-credits+recordings&fmt=json`;
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT }
        });

        if (!response.ok) {
            console.error(`[MB] Lookup failed: ${response.status}`);
            return null;
        }
        const data = await response.json();

        //JSON parsing: flatten the nested structure
        // The raw response is deeply nested. We return a clean,
        // flat object with just the fields our frontend uses.
        return {
            mb_release_id: data.id,
            title:data.title,
            artist:data["artist-credit"]?.[0]?.name || "Unknown",
            date:data.date || null,
            country:data.country || null,
            // Extract tracklist from media[0].tracks
            tracks: (data.media?.[0]?.tracks || []).map(t => ({
                position: t.position,
                title: t.title,
                length:t.length, // in milliseconds
            })),
        };
    } catch (err) {
        console.error("[MB] lookupRelease error:", err.message);
        return null;
    }
}

// getCoverArtUrl(mbReleaseId, size)
// Build the Cover Art Archive URL for a release.
// This doesn't actually hit the API, it just constructs the
// URL that the browser will use to load the image directly.
// size: 250, 500, or 1200 (pixels, square)
function getCoverArtUrl(mbReleaseId, size = 250) {
    if (!mbReleaseId) return null;
    return `https://coverartarchive.org/release/${mbReleaseId}/front-${size}`;
}
module.exports = {
    searchRelease,
    lookupRelease,
    getCoverArtUrl,
};
