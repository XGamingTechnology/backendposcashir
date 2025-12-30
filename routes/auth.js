// routes/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { pool } from "../config.js";

const router = express.Router();
router.use(cookieParser()); // untuk baca cookie

/* =========================================================
   LOGIN
   ========================================================= */
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("[LOGIN] Attempt:", username);

  if (!username || !password) {
    console.log("[LOGIN] Missing username/password");
    return res.status(400).json({ success: false, message: "Username dan password wajib diisi" });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        uuid_id AS id,
        username,
        password,
        role
      FROM users
      WHERE username = $1
        AND active = true
      LIMIT 1
      `,
      [username]
    );

    if (!result.rows.length) {
      console.log("[LOGIN] User not found");
      return res.status(401).json({ success: false, message: "Username atau password salah" });
    }

    const user = result.rows[0];
    console.log("[LOGIN] User found:", user.username);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("[LOGIN] Password mismatch");
      return res.status(401).json({ success: false, message: "Username atau password salah" });
    }

    // ===== BUAT ACCESS TOKEN =====
    const accessToken = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
    console.log("[LOGIN] Access token created");

    // ===== BUAT REFRESH TOKEN =====
    const refreshToken = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
    console.log("[LOGIN] Refresh token created");

    // ===== SIMPAN REFRESH TOKEN DI DATABASE =====
    await pool.query(`INSERT INTO refresh_tokens(user_id, token) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET token = $2`, [user.id, refreshToken]);
    console.log("[LOGIN] Refresh token saved to DB");

    // ===== SET COOKIES =====
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    console.log("[LOGIN] Cookies set");

    return res.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("[LOGIN ERROR]:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   LOGOUT
   ========================================================= */
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  console.log("[LOGOUT] Refresh token from cookie:", refreshToken);

  if (refreshToken) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
    console.log("[LOGOUT] Refresh token deleted from DB");
  }

  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  console.log("[LOGOUT] Cookies cleared");

  return res.json({ success: true, message: "Logout berhasil" });
});

/* =========================================================
   REFRESH TOKEN
   ========================================================= */
router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.cookies;
  console.log("[REFRESH] Refresh token from cookie:", refreshToken);

  if (!refreshToken) return res.status(401).json({ message: "Refresh token missing" });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    console.log("[REFRESH] Refresh token payload:", payload);

    // cek di DB
    const result = await pool.query(`SELECT token FROM refresh_tokens WHERE user_id = $1`, [payload.id]);
    if (!result.rows.length || result.rows[0].token !== refreshToken) {
      console.log("[REFRESH] Invalid refresh token in DB");
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    // buat access token baru
    const newAccessToken = jwt.sign({ id: payload.id, username: payload.username, role: payload.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
    console.log("[REFRESH] New access token created");

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    return res.json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    console.error("[REFRESH ERROR]:", err);
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

/* =========================================================
   MIDDLEWARE VERIFY TOKEN
   ========================================================= */
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("[VERIFY TOKEN] Authorization header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("[VERIFY TOKEN] Missing or invalid header");
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log("[VERIFY TOKEN] Decoded payload:", decoded);
    next();
  } catch (err) {
    console.error("[VERIFY TOKEN ERROR]:", err);
    return res.status(401).json({ message: "Token expired or invalid" });
  }
};

export default router;
