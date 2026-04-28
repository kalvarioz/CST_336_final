// Brandon Calvario
export function requireLogin(req, res, next) {
    if (req.session && req.session.user_id) {
        return next(); // User is logged in — proceed
    }
    // API requests get a 401 JSON response
    if (req.originalUrl.startsWith("/api")) {
        return res.status(401).json({ error: "Login required" });
    }
    // Page requests get redirected to login
    res.redirect("/login");
}
