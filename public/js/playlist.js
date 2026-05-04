const nowPlayingTitle = document.getElementById("nowPlayingTitle");
const nowPlayingArtist = document.getElementById("nowPlayingArtist");
const playButton = document.getElementById("playButton");
const audioPlayer = document.getElementById("audioPlayer");
let selectedSongId = null
playButton.addEventListener("click", () => {
    console.log("click");
    playPlayList(songs);
});
function playPlayList(songs) {
    let currentIndex = 0;

    // "selectSong" method made by brandon
    function selectSong(songId) {
        const song = songs.find(s => s.song_id === songId);
        if (!song) return;

        selectedSongId = songId;
        // Highlight the selected row
        document.querySelectorAll(".song-row").forEach(row => {
            row.classList.remove("table-active");
        });
        const activeRow = document.querySelector(`.song-row[data-song-id="${songId}"]`);
        if (activeRow) activeRow.classList.add("table-active");
        audioPlayer.src = `/api/songs/stream/${songId}`;
        audioPlayer.load();
        audioPlayer.play().catch(err => {
            // Autoplay might be blocked by browser, that's OK,
            // the user can click the play button manually
            console.log("Autoplay blocked:", err.message);
        });
        // Update "Now Playing" bar
        nowPlayingTitle.textContent = song.title;
        nowPlayingArtist.textContent = song.artist;

    }
    function playNextSong() {
        if (currentIndex < songs.length) {
            const song = songs[currentIndex];
            selectSong(song.song_id);
            currentIndex++;
        }

    }
    audioPlayer.addEventListener("ended", () => {
        if (selectedSongId === null) return;
        playNextSong();
    });
    playNextSong();
}