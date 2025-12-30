// routes/users.js
import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../config.js";
import { verifyToken } from "../middlewares/auth.js";
import { onlyAdmin } from "../middlewares/role.js";

const router = express.Router();

/**
 * GET /api/users
 * 👤 Ambil daftar semua user
 * 🔒 Hanya admin
 */
router.get("/", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, role, active, created_at
      FROM users
      ORDER BY username
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data pengguna" });
  }
});

/**
 * POST /api/users
 * 👤 Tambah user baru
 * 🔒 Hanya admin
 */
router.post("/", verifyToken, onlyAdmin, async (req, res) => {
  const { username, password, role } = req.body;

  // ✅ Validasi input
  if (!username || !username.trim() || !password || password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Username harus diisi dan password minimal 6 karakter",
    });
  }

  if (!["admin", "cashier"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role hanya boleh 'admin' atau 'cashier'",
    });
  }

  try {
    // 🔒 Hash password
    const hashedPassword = await bcrypt.hash(password.trim(), 12);

    await pool.query(
      `INSERT INTO users (id, username, password, role, active) 
       VALUES (gen_random_uuid(), $1, $2, $3, true)`,
      [username.trim(), hashedPassword, role]
    );

    console.log(`[USERS] User created by ${req.user.username}: ${username} (${role})`);
    res.status(201).json({
      success: true,
      message: "Pengguna berhasil ditambahkan",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Username sudah terdaftar",
      });
    }
    console.error("CREATE USER ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Gagal menambahkan pengguna",
    });
  }
});

/**
 * PUT /api/users/:id
 * 👤 Update user (tanpa password)
 * 🔒 Hanya admin
 * ⚠️ Password tidak bisa diupdate di sini (buat endpoint khusus jika perlu)
 */
router.put("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;
  const { username, role, active } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({
      success: false,
      message: "Username harus diisi",
    });
  }

  if (role && !["admin", "cashier"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role tidak valid",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users 
       SET username = $1, role = $2, active = $3, updated_at = NOW() 
       WHERE id = $4`,
      [username.trim(), role || "cashier", active ?? true, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pengguna tidak ditemukan",
      });
    }

    console.log(`[USERS] User updated by ${req.user.username}: ID ${id}`);
    res.json({
      success: true,
      message: "Pengguna berhasil diperbarui",
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Username sudah digunakan",
      });
    }
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Gagal memperbarui pengguna",
    });
  }
});

/**
 * POST /api/users/:id/password
 * 👤 Update password user
 * 🔒 Hanya admin
 */
router.post("/:id/password", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password baru minimal 6 karakter",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [hashedPassword, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pengguna tidak ditemukan",
      });
    }

    console.log(`[USERS] Password updated by ${req.user.username} for user ID ${id}`);
    res.json({
      success: true,
      message: "Password berhasil diperbarui",
    });
  } catch (err) {
    console.error("UPDATE PASSWORD ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Gagal memperbarui password",
    });
  }
});

export default router;
