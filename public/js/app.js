function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds < 0) return "0:00";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

console.log("SoundVault loaded");
