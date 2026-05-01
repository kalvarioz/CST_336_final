
// ============================================================
// scripts/bulk-import.js
//
// Bulk import audio files into SoundVault.
// Scans a folder, reads metadata from each audio file,
// uploads to R2 (with multipart for large files), and
// inserts a row into the songs table.
//
// Usage:
//   node scripts/bulk-import.js /path/to/your/music/folder
//
// Supports: .flac, .m4a, .mp3, .ogg, .wav
//
// Requirements (install once):
//   npm install music-metadata @aws-sdk/lib-storage
// ============================================================
 
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parseFile } = require("music-metadata");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const mysql = require("mysql2/promise");
 
// --- Configuration ---
const SUPPORTED_EXTENSIONS = [".flac", ".m4a", ".mp3", ".ogg", ".wav"];
const R2_MUSIC_PREFIX = "music/"; // All files stored under music/ in the bucket
 
// --- R2 Client ---
const r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
const BUCKET = process.env.R2_BUCKET_NAME;
 
// --- MIME type map ---
const MIME_TYPES = {
    ".flac": "audio/flac",
    ".m4a":  "audio/mp4",
    ".mp3":  "audio/mpeg",
    ".ogg":  "audio/ogg",
    ".wav":  "audio/wav",
};
 
// ============================================================
// scanFolder(folderPath)
// Recursively find all supported audio files in a directory.
// ============================================================
function scanFolder(folderPath) {
    const results = [];
 
    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (SUPPORTED_EXTENSIONS.includes(ext)) {
                    results.push(fullPath);
                }
            }
        }
    }
 
    walk(folderPath);
    return results;
}
 
// ============================================================
// readMetadata(filePath)
// Extract title, artist, album, genre, and duration from
// the audio file's embedded tags (ID3, Vorbis, etc.).
// ============================================================
async function readMetadata(filePath) {
    try {
        const metadata = await parseFile(filePath);
        const { common, format } = metadata;
 
        return {
            title:    common.title   || path.basename(filePath, path.extname(filePath)),
            artist:   common.artist  || "Unknown Artist",
            album:    common.album   || null,
            genre:    common.genre?.[0] || "Other",
            duration: Math.round(format.duration || 0),  // seconds
        };
    } catch (err) {
        console.warn(`  [WARN] Could not read metadata from ${path.basename(filePath)}: ${err.message}`);
        // Fall back to filename-based info
        return {
            title:    path.basename(filePath, path.extname(filePath)),
            artist:   "Unknown Artist",
            album:    null,
            genre:    "Other",
            duration: 0,
        };
    }
}
 
// ============================================================
// uploadToR2(filePath, cloudKey)
// Upload a file to Cloudflare R2 using multipart upload.
// The @aws-sdk/lib-storage Upload class automatically splits
// large files into chunks (default 5MB each) and uploads
// them in parallel. This is what makes 300MB+ files work
// without hitting memory or timeout limits.
// ============================================================
async function uploadToR2(filePath, cloudKey) {
    const ext = path.extname(filePath).toLowerCase();
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;
 
    const upload = new Upload({
        client: r2Client,
        params: {
            Bucket: BUCKET,
            Key: cloudKey,
            Body: fileStream,
            ContentType: MIME_TYPES[ext] || "application/octet-stream",
        },
        // Multipart config for large files
        queueSize: 4,              // 4 parallel chunk uploads
        partSize: 10 * 1024 * 1024, // 10MB per chunk (good for large FLAC files)
        leavePartsOnError: false,   // Clean up failed uploads
    });
 
    // Progress tracking
    upload.on("httpUploadProgress", (progress) => {
        if (progress.loaded && fileSize > 0) {
            const pct = Math.round((progress.loaded / fileSize) * 100);
            process.stdout.write(`\r    Uploading: ${pct}%`);
        }
    });
 
    await upload.done();
    process.stdout.write(`\r    Uploading: 100% - Done\n`);
}
 
// ============================================================
// insertIntoDb(db, metadata, cloudKey)
// Insert a song record into the MySQL songs table.
// Skips if a song with the same cloud_key already exists
// (prevents duplicates on re-runs).
// ============================================================
async function insertIntoDb(db, metadata, cloudKey) {
    // Check for existing entry (idempotent re-runs)
    const [existing] = await db.query(
        "SELECT song_id FROM songs WHERE cloud_key = ?",
        [cloudKey]
    );
 
    if (existing.length > 0) {
        console.log(`    DB: Already exists (song_id ${existing[0].song_id}), skipping`);
        return existing[0].song_id;
    }
 
    const [result] = await db.query(
        `INSERT INTO songs (title, artist, album, genre, duration_sec, cloud_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [metadata.title, metadata.artist, metadata.album, metadata.genre, metadata.duration, cloudKey]
    );
 
    console.log(`    DB: Inserted as song_id ${result.insertId}`);
    return result.insertId;
}
 
// ============================================================
// formatFileSize(bytes)
// Human-readable file size.
// ============================================================
function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
 
// ============================================================
// main()
// ============================================================
async function main() {
    const folderPath = process.argv[2];
 
    if (!folderPath) {
        console.error("Usage: node scripts/bulk-import.js /path/to/music/folder");
        console.error("");
        console.error("Example:");
        console.error("  node scripts/bulk-import.js ~/Music/MyLibrary");
        console.error("  node scripts/bulk-import.js ./test-songs");
        process.exit(1);
    }
 
    // Resolve to absolute path
    const resolvedPath = path.resolve(folderPath);
 
    if (!fs.existsSync(resolvedPath)) {
        console.error(`Error: folder not found: ${resolvedPath}`);
        process.exit(1);
    }
 
    console.log("==============================================");
    console.log("  SoundVault Bulk Import");
    console.log("==============================================");
    console.log(`Source folder: ${resolvedPath}`);
    console.log(`R2 bucket:    ${BUCKET}`);
    console.log("");
 
    // Step 1: Scan for audio files
    console.log("[1/4] Scanning for audio files...");
    const files = scanFolder(resolvedPath);
    console.log(`  Found ${files.length} audio file(s)\n`);
 
    if (files.length === 0) {
        console.log("No supported audio files found. Exiting.");
        process.exit(0);
    }
 
    // Show what we found
    let totalSize = 0;
    for (const f of files) {
        const size = fs.statSync(f).size;
        totalSize += size;
        console.log(`  ${path.basename(f)} (${formatFileSize(size)})`);
    }
    console.log(`\n  Total: ${formatFileSize(totalSize)}\n`);
 
    // Step 2: Connect to database
    console.log("[2/4] Connecting to JawsDB...");
    const db = await mysql.createConnection(process.env.JAWSDB_URL);
    console.log("  Connected\n");
 
    // Step 3 & 4: Process each file
    console.log("[3/4] Processing files...\n");
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
 
    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase();
 
        console.log(`[${i + 1}/${files.length}] ${fileName}`);
 
        try {
            // Read metadata from the file
            const metadata = await readMetadata(filePath);
            console.log(`    Title:    ${metadata.title}`);
            console.log(`    Artist:   ${metadata.artist}`);
            console.log(`    Album:    ${metadata.album || "(none)"}`);
            console.log(`    Genre:    ${metadata.genre}`);
            console.log(`    Duration: ${Math.floor(metadata.duration / 60)}:${(metadata.duration % 60).toString().padStart(2, "0")}`);
 
            // Build the cloud key
            // Sanitize filename: replace spaces with hyphens, remove special chars
            const sanitized = fileName
                .replace(/\s+/g, "-")
                .replace(/[^a-zA-Z0-9._-]/g, "")
                .toLowerCase();
            const cloudKey = `${R2_MUSIC_PREFIX}${sanitized}`;
            console.log(`    Cloud key: ${cloudKey}`);
 
            // Check if already in DB (skip upload if so)
            const [existing] = await db.query(
                "SELECT song_id FROM songs WHERE cloud_key = ?",
                [cloudKey]
            );
 
            if (existing.length > 0) {
                console.log(`    Skipping (already imported as song_id ${existing[0].song_id})\n`);
                skipCount++;
                continue;
            }
 
            // Upload to R2
            await uploadToR2(filePath, cloudKey);
 
            // Insert into database
            await insertIntoDb(db, metadata, cloudKey);
            successCount++;
 
        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            errorCount++;
        }
 
        console.log("");
    }
 
    // Summary
    console.log("==============================================");
    console.log("  Import Complete");
    console.log("==============================================");
    console.log(`  Imported:  ${successCount}`);
    console.log(`  Skipped:   ${skipCount} (already in DB)`);
    console.log(`  Errors:    ${errorCount}`);
    console.log("==============================================");
 
    await db.end();
    process.exit(0);
}
 
main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
