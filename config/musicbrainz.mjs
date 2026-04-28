
// config/musicbrainz.mjs
// MusicBrainz Web Service v2 helpers (ES Module version).
//
// Two main use cases:
//   1. searchRelease()  – find a release ID by artist + album
//   2. lookupRelease()  – get full details for a known release ID
//
// MusicBrainz REQUIRES a descriptive User-Agent header and
// enforces a rate limit of 1 req/sec per IP.

// Brandon Calvario

const MB_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = "SoundVault/1.0 (student-project; CST336)";

// Simple rate limiter: at least 1100 ms between calls
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
export async function searchRelease(artist, album) {
    await rateLimit();
    const query = `artist:"${artist}" AND release:"${album}"`;
    const url = `${MB_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) {
            console.error(`[MB] Search failed: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (!data.releases || data.releases.length === 0) return null;
        const top = data.releases[0];
        return {
            mb_release_id: top.id,
            title: top.title,
            artist: top["artist-credit"]?.[0]?.name || artist,
            date: top.date || null,
            country: top.country || null,
            score: top.score,
        };
    } catch (err) {
        console.error("[MB] searchRelease error:", err.message);
        return null;
    }
}

// lookupRelease(mbReleaseId)
export async function lookupRelease(mbReleaseId) {
    await rateLimit();
    const url = `${MB_BASE}/release/${mbReleaseId}?inc=artist-credits+recordings&fmt=json`;
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) {
            console.error(`[MB] Lookup failed: ${response.status}`);
            return null;
        }
        const data = await response.json();
        return {
            mb_release_id: data.id,
            title: data.title,
            artist: data["artist-credit"]?.[0]?.name || "Unknown",
            date: data.date || null,
            country: data.country || null,
            tracks: (data.media?.[0]?.tracks || []).map(t => ({
                position: t.position,
                title: t.title,
                length: t.length,
            })),
        };
    } catch (err) {
        console.error("[MB] lookupRelease error:", err.message);
        return null;
    }
}

// getCoverArtUrl(mbReleaseId, size)
// Constructs the Cover Art Archive URL (no API call needed).
export function getCoverArtUrl(mbReleaseId, size = 250) {
    if (!mbReleaseId) return null;
    return `https://coverartarchive.org/release/${mbReleaseId}/front-${size}`;
}
