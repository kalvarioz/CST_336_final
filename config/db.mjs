// config/db.mjs
// MySQL connection pool for JawsDB

// Brandon Calvario 

import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

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

export default pool;