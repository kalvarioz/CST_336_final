// config/db.js
// MySQL connection pool for JawsDB.
// JawsDB's free tier (Kitefin) limits concurrent connections,
// so we keep the pool small.
// Author: Brandon Calvario

const mysql = require("mysql2/promise");
require("dotenv").config();

// Parse the JAWSDB_URL connection string
// Format: mysql://USER:PASS@HOST:PORT/DATABASE
const pool = mysql.createPool({
    uri: process.env.JAWSDB_URL,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
});

// Quick connectivity check on startup
pool.getConnection()
    .then(conn => {
        console.log("[DB] Connected to JawsDB successfully");
        conn.release();
    })
    .catch(err => {
        console.error("[DB] Connection failed:", err.message);
    });

module.exports = pool;
