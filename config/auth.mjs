// ============================================================
// config/auth.mjs
// Authentication middleware (ES Module version).
//
// Usage in server.mjs:
//   import { requireLogin } from "./config/auth.mjs";
//   app.get("/dashboard", requireLogin, (req, res) => { ... });
// ============================================================

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


// ============================================================
// requireAdmin
// Use on any route that only admins should access.
// Must be placed AFTER requireLogin in the middleware chain.
//
// Usage:
//   app.get("/admin", requireLogin, requireAdmin, handler);
// ============================================================
// export function requireAdmin(req, res, next) {
//     if (req.session && req.session.is_admin) {
//         return next();
//     }
//     if (req.originalUrl.startsWith("/api")) {
//         return res.status(403).json({ error: "Admin access required" });
//     }
//     res.status(403).send("Access denied — admin only");
// }
