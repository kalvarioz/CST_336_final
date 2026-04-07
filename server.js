// server.js
// SoundVault main entry point.
//
// Author - Brandon Calvario
// 

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        // User session lasts 24 hours.
        maxAge: 1000 * 60 * 60 * 24,
    },
}));

// Routes
const songsRouter = require("./routes/songs");
const authRouter = require("./routes/auth");
app.use("/api/songs", songsRouter);
app.use("/api/auth", authRouter);
// Pages
app.get("/", (req, res) => {
    res.render("home", {
        title: "SoundVault",
        user: req.session.userId ? { id: req.session.userId } : null,
    });
});

app.get("/login", (req, res) => {
    res.render("login", { title: "Login - SoundVault" });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Start server
app.listen(PORT, () => {
    console.log(`[SERVER] SoundVault running at http://localhost:${PORT}`);
});
