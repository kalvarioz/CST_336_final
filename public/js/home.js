// public/js/home.js
// Home page, featured album cover marquee + discover grid.
//
// Fetch calls:
// GET /api/songs/featured?limit=8, random enriched songs
//
// The marquee uses pure CSS animation (infinite scroll).
// We duplicate the covers so the loop is seamless.
// Brandon Calvario
const marqueeTrack = document.getElementById("marqueeTrack");
const featuredLoading = document.getElementById("featuredLoading");
const featuredEmpty = document.getElementById("featuredEmpty");
const featuredGrid = document.getElementById("featuredGrid");
const refreshBtn = document.getElementById("refreshFeatured");
const REFRESH_INTERVAL = 100000;
let refreshTimer = null;

// Builds the Cover Art Archive URL from a MusicBrainz release ID.
// Returns null if no ID is available.
function coverUrl(mbReleaseId, size = 250) {
    if (!mbReleaseId) return null;
    return `https://coverartarchive.org/release/${mbReleaseId}/front-${size}`;
}

// Calls your existing /api/songs/featured endpoint which
// returns random songs that have mb_release_id (enriched).
async function fetchFeatured(limit = 8) {
    try {
        const resp = await fetch(`/api/songs/featured?limit=${limit}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (err) {
        console.error("Failed to load featured songs:", err);
        return [];
    }
}


// Creates a horizontally scrolling strip of album covers.
// The trick: we render the covers TWICE back-to-back so that
// when the CSS animation scrolls past the first set, the
// second set is already in position, creating a seamless loop.
function buildMarquee(songs) {
    featuredLoading.classList.add("d-none");
    if (songs.length === 0) {
        featuredEmpty.classList.remove("d-none");
        marqueeTrack.innerHTML = "";
        return;
    }
    featuredEmpty.classList.add("d-none");
    // Deduplicate by album (same album = same cover)
    const seen = new Set();
    const unique = songs.filter(s => {
        if (seen.has(s.mb_release_id)) return false;
        seen.add(s.mb_release_id);
        return true;
    });
    // Build cover HTML, one card per unique album
    const coversHtml = unique.map(song => {
        const url = coverUrl(song.mb_release_id);
        return `
            <a href="/library" class="marquee-card" title="${escapeAttr(song.artist)} — ${escapeAttr(song.album)}">
                <img
                    src="${url}"
                    alt="${escapeAttr(song.album)}"
                    class="marquee-img"
                    onerror="this.parentElement.style.display='none'"
                >
                <div class="marquee-label">${escapeHtml(song.album)}</div>
            </a>
        `;
    }).join("");
    // Duplicate the covers for seamless looping
    marqueeTrack.innerHTML = coversHtml + coversHtml;
    // Set animation duration based on number of covers
    // More covers = slower scroll to keep the speed consistent
    const duration = unique.length * 4;
    marqueeTrack.style.animationDuration = `${duration}s`;
}

// Shows 4 random songs as clickable cards with cover art,
// title, artist, album, and genre.
function buildGrid(songs) {
    if (!featuredGrid) return;
    if (songs.length === 0) {
        featuredGrid.innerHTML = `
            <div class="col-12 text-center text-muted py-3">
                No enriched songs available yet.
            </div>`;
        return;
    }
    // Pick up to 4 for the grid
    const gridSongs = songs.slice(0, 4);
    featuredGrid.innerHTML = gridSongs.map(song => {
        const url = coverUrl(song.mb_release_id);
        return `
            <div class="col-md-3 col-6">
                <a href="/library" class="card text-decoration-none h-100 featured-card">
                    <div class="card-img-top-wrapper">
                        <img
                            src="${url}"
                            alt="${escapeAttr(song.album)}"
                            class="card-img-top"
                            onerror="this.src='/img/placeholder.svg'; this.onerror=null;"
                        >
                    </div>
                    <div class="card-body p-2">
                        <h6 class="card-title mb-1 text-truncate">${escapeHtml(song.title)}</h6>
                        <p class="card-text text-muted small mb-0 text-truncate">
                            ${escapeHtml(song.artist)}
                        </p>
                        <p class="card-text small mb-0 text-truncate">
                            <span class="badge bg-secondary">${escapeHtml(song.genre || "")}</span>
                        </p>
                    </div>
                </a>
            </div>
        `;
    }).join("");
}

async function loadFeatured() {
    const songs = await fetchFeatured(8);
    buildMarquee(songs);
    buildGrid(songs);
}

// Swap in new random covers every 30 seconds.
// Pauses when the tab is not visible (saves API calls).
function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        loadFeatured();
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// Pause when tab is hidden, resume when visible
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        loadFeatured();
        startAutoRefresh();
    }
});

if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
        loadFeatured();
    });
}

function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function escapeAttr(str) {
    if (!str) return "";
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
loadFeatured();
startAutoRefresh();