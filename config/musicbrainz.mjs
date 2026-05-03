// config/musicbrainz.mjs
// MusicBrainz Web Service v2 helpers
//
// Features:
//   1. searchRelease(): find a release by artist + album
//   2. lookupRelease(): get full details for a known release
//   3. enrichSong():full pipeline: search → lookup → genres
//
// Compatibility:
//   Uses Node's built-in https module instead of fetch(),
//   so it works on ALL Node versions (not just 18+).
//
// MusicBrainz requires a User-Agent header and enforces
// a rate limit of 1 request/sec per IP.

import https from "https";
const MB_BASE    = "https://musicbrainz.org/ws/2";
const USER_AGENT = "SoundVault/1.0 (student-project; CST336)";
// Preferred countries for release selection (in priority order)
const PREFERRED_COUNTRIES = ["US", "GB", "XW", "EU"];
// mbFetch(url)
// HTTP GET using Node's built-in https module.
// Returns parsed JSON. Works on ALL Node versions.
function mbFetch(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { "User-Agent": USER_AGENT },
        };
        https.get(url, options, (res) => {
            // Handle redirects (MusicBrainz sometimes 301s)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`[MB] Redirect ${res.statusCode} → ${res.headers.location}`);
                return mbFetch(res.headers.location).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                // Consume response to free up the socket
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => { body += chunk; });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        }).on("error", (err) => {
            reject(err);
        });
    });
}

// Rate limiter: at least 1100 ms between calls
let lastCallTime = 0;
async function rateLimit() {
    const now     = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < 1100) {
        await new Promise(r => setTimeout(r, 1100 - elapsed));
    }
    lastCallTime = Date.now();
}

// pickBestRelease(releases)
//
// MusicBrainz returns multiple releases for the same album
// (one per country/format). We pick the best one using a
// scoring system:
//   - Prefer US release, then GB, then worldwide (XW)
//   - Prefer releases with a date
//   - Prefer Official status
//   - Prefer higher MusicBrainz search score
//   - Prefer releases with more tracks (avoid singles)
function pickBestRelease(releases) {
    if (!releases || releases.length === 0) return null;
    if (releases.length === 1) return releases[0];
    // Score each release
    const scored = releases.map(r => {
        let score = 0;
        // Country preference (highest priority)
        const countryIndex = PREFERRED_COUNTRIES.indexOf(r.country);
        if (countryIndex === 0) score += 100;// US
        else if (countryIndex === 1) score += 80;// GB
        else if (countryIndex >= 2) score += 60;// XW, EU
        else if (r.country) score += 20;// Any other country
        // No country = 0 points
        // Has a release date
        if (r.date) score += 30;
        // Official status
        if (r.status === "Official") score += 25;
        // Track count (prefer albums over singles)
        const trackCount = r["track-count"] || r["media"]?.[0]?.["track-count"] || 0;
        if (trackCount >= 10) score += 20;
        else if (trackCount >= 5) score += 10;
        // MusicBrainz search confidence
        score += (r.score || 0) / 10;
        return { release: r, score };
    });
    // Sort by score descending and pick the best
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    console.log(`[MB] Picked release: "${best.release.title}" (${best.release.country || "no country"}, score=${best.score.toFixed(0)}) from ${releases.length} candidates`);
    return best.release;
}


// searchRelease(artist, album)
// Search MusicBrainz and return the best matching release.
export async function searchRelease(artist, album) {
    await rateLimit();
    const query = `artist:"${artist}" AND release:"${album}"`;
    // Trailing slash on /release/ is REQUIRED for search endpoints
    const url = `${MB_BASE}/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
    console.log(`[MB] Searching: artist="${artist}", album="${album}"`);
    try {
        const data = await mbFetch(url);
        if (!data.releases || data.releases.length === 0) {
            console.log("[MB] No releases found");
            return null;
        }
        console.log(`[MB] Found ${data.releases.length} release(s)`);
        // Pick the best release from all candidates
        const best = pickBestRelease(data.releases);
        if (!best) return null;
        return {
            mb_release_id: best.id,
            title: best.title,
            artist: best["artist-credit"]?.[0]?.name || artist,
            date: best.date || null,
            country: best.country || null,
            score: best.score,
        };
    } catch (err) {
        console.error("[MB] searchRelease error:", err.message);
        return null;
    }
}


// lookupRelease(mbReleaseId)
// Full lookup by ID: returns tracklist + release-group ID.
export async function lookupRelease(mbReleaseId) {
    await rateLimit();
    const url = `${MB_BASE}/release/${mbReleaseId}?inc=artist-credits+recordings+release-groups&fmt=json`;
    try {
        const data = await mbFetch(url);
        return {
            mb_release_id:    data.id,
            release_group_id: data["release-group"]?.id || null,
            title:data.title,
            artist:data["artist-credit"]?.[0]?.name || "Unknown",
            date:data.date || null,
            country:data.country || null,
            tracks: (data.media?.[0]?.tracks || []).map(t => ({
                position: t.position,
                title:t.title,
                length:t.length,
            })),
        };
    } catch (err) {
        console.error("[MB] lookupRelease error:", err.message);
        return null;
    }
}

// lookupReleaseGroupGenres(releaseGroupId)
// Fetch genre tags from the release-group level.
// MusicBrainz stores genres on release-groups (the "album"
// concept), not on individual releases.
export async function lookupReleaseGroupGenres(releaseGroupId) {
    if (!releaseGroupId) return [];
    await rateLimit();
    const url = `${MB_BASE}/release-group/${releaseGroupId}?inc=genres&fmt=json`;
    try {
        const data = await mbFetch(url);
        // Genres come as { name, count, id }: sort by popularity
        const genres = (data.genres || [])
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .map(g => g.name);
        return genres;
    } catch (err) {
        console.error("[MB] lookupReleaseGroupGenres error:", err.message);
        return [];
    }
}

// enrichSong(artist, album)
// Full pipeline: search → pick best → lookup → get genres.
// Returns everything the app needs in one object.
export async function enrichSong(artist, album) {
    // Step 1: clean the artist name for searching
    // Audio file tags often include featured artists in the artist field:
    //   "Daft Punk, Pharrell Williams"
    //   "Daft Punk feat. Julian Casablancas"
    // MusicBrainz credits albums to the PRIMARY artist only,
    // so we strip everything after common separators.
    const primaryArtist = cleanArtist(artist);
    // Step 2 — search for the release
    // Try the primary artist first; if that fails, try the original string
    let searchResult = await searchRelease(primaryArtist, album);
    if (!searchResult && primaryArtist !== artist) {
        console.log(`[MB] Retrying with full artist: "${artist}"`);
        searchResult = await searchRelease(artist, album);
    }
    if (!searchResult) return null;
    // Step 3:full release lookup (tracklist + release-group ID)
    const release = await lookupRelease(searchResult.mb_release_id);
    if (!release) return null;
    // Step 4: genre lookup from the release-group
    const genres = await lookupReleaseGroupGenres(release.release_group_id);
    // Map MusicBrainz genre names to our dropdown values
    const mappedGenre = mapGenre(genres);
    return {
        mb_release_id: release.mb_release_id,
        title:release.title,
        artist:release.artist,
        date:release.date,
        country:release.country,
        genres:genres,
        genre:mappedGenre,
        tracks:release.tracks,
    };
}

// cleanArtist(artist)
// Extract the primary artist from a tag string that may
// contain featured artist credits.
//
// Examples:
//   "Daft Punk, Pharrell Williams "Daft Punk"
//   "Daft Punk feat. Julian Casablancas"→ "Daft Punk"
//   "Daft Punk (feat. Panda Bear)"→ "Daft Punk"
//   "Tyler, the Creator"→ "Tyler, the Creator" (no split — see below)
//   "Daft Punk & Nile Rodgers"→ "Daft Punk"
//   "Daft Punk"→ "Daft Punk"
// The tricky part is distinguishing "Daft Punk, Pharrell Williams"
// (two artists) from "Tyler, the Creator" (one artist with a comma
// in the name). We handle this by splitting on patterns that
// clearly indicate a feature, not just any comma.
export function cleanArtist(artist) {
    if (!artist) return artist;
    // Remove parenthetical features: "(feat. ...)" or "(ft. ...)"
    let cleaned = artist.replace(/\s*\(feat\.?\s+[^)]+\)/gi, "");
    cleaned = cleaned.replace(/\s*\(ft\.?\s+[^)]+\)/gi, "");
    cleaned = cleaned.replace(/\s*\(featuring\s+[^)]+\)/gi, "");
    cleaned = cleaned.replace(/\s*\(with\s+[^)]+\)/gi, "");
    // Split on " feat. ", " ft. ", " featuring ", " with "
    // These unambiguously indicate a featured artist
    cleaned = cleaned.split(/\s+feat\.?\s+/i)[0];
    cleaned = cleaned.split(/\s+ft\.?\s+/i)[0];
    cleaned = cleaned.split(/\s+featuring\s+/i)[0];
    // Split on " & " or " and " (but only if there's also other text)
    // "Simon & Garfunkel" is one act, but "Daft Punk & Nile Rodgers" is two.
    // We can't perfectly distinguish these, so we only split on " & " if
    // the result before it looks like a known pattern (has spaces = likely a full name).
    // For safety, we split on ", " when followed by a capitalized name
    // (e.g., "Daft Punk, Pharrell Williams" but not "Tyler, the Creator")
    const commaMatch = cleaned.match(/^(.+?),\s+([A-Z])/);
    if (commaMatch) {
        cleaned = commaMatch[1];
    }

    return cleaned.trim();
}

// mapGenre(mbGenres)
// Maps fine-grained MusicBrainz tags to our app's dropdown values.
function mapGenre(mbGenres) {
    if (!mbGenres || mbGenres.length === 0) return "Other";

    const combined = mbGenres.join(" ").toLowerCase();

    if (combined.includes("hip-hop") || combined.includes("hip hop") || combined.includes("rap")|| combined.includes("trap") || combined.includes("west coast hip hop"))
        return "Hip-Hop";
    if (combined.includes("r&b") || combined.includes("rhythm and blues") || combined.includes("soul"))
        return "R&B";
    if (combined.includes("jazz"))
        return "Jazz";
    if (combined.includes("classical") || combined.includes("orchestra"))
        return "Classical";
    if (combined.includes("electronic") || combined.includes("edm") || combined.includes("techno") || combined.includes("house"))
        return "Electronic";
    if (combined.includes("country") || combined.includes("bluegrass"))
        return "Country";
    if (combined.includes("ambient"))
        return "Ambient";
    if (combined.includes("indie"))
        return "Indie";
    if (combined.includes("pop"))
        return "Pop";
    if (combined.includes("rock") || combined.includes("metal") || combined.includes("punk") || combined.includes("grunge"))
        return "Rock";

    return mbGenres[0].charAt(0).toUpperCase() + mbGenres[0].slice(1);
}

// getCoverArtUrl(mbReleaseId, size)
// Constructs the Cover Art Archive URL (no API call needed).
export function getCoverArtUrl(mbReleaseId, size = 250) {
    if (!mbReleaseId) return null;
    return `https://coverartarchive.org/release/${mbReleaseId}/front-${size}`;
}
