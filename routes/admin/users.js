import express from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../../config.js";
import { verifyToken } from "../../middlewares/auth.js";
import { onlyAdmin } from "../../middlewares/role.js";

const router = express.Router();

// Helper: validasi dan parse UUID
const parseUserUuid = (uuidStr) => {
  if (!uuidStr) throw new Error("UUID tidak boleh kosong");
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuidStr)) throw new Error("UUID tidak valid");
  return uuidStr;
};

// Rate limiter untuk reset password
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { success: false, message: "Terlalu banyak permintaan reset password. Coba lagi nanti." },
});

// Helper: dapatkan user ID integer dari UUID
const getUserIdByUuid = async (uuid) => {
  const result = await pool.query(`SELECT id FROM users WHERE uuid_id = $1`, [uuid]);
  if (result.rows.length === 0) throw new Error("User tidak ditemukan");
  return result.rows[0].id; // ← integer
};

// GET /admin/users — ambil semua user
router.get("/", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT uuid_id AS id, username, role, active, created_at, updated_at, created_by
      FROM users ORDER BY created_at DESC
    `);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    console.error("ADMIN GET USERS ERROR:", err.message);
    res.status(500).json({ success: false, message: "Gagal mengambil data pengguna" });
  }
});

// POST /admin/users — buat user baru ✅ DIPERBAIKI
router.post("/", verifyToken, onlyAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  const adminUuid = req.user.id; // UUID dari token

  try {
    // ✅ Dapatkan ID integer admin untuk created_by
    const adminId = await getUserIdByUuid(adminUuid); // ← integer

    if (!username?.trim()) return res.status(400).json({ success: false, message: "Username wajib diisi" });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: "Password minimal 6 karakter" });
    if (!["admin", "cashier"].includes(role)) return res.status(400).json({ success: false, message: "Role hanya boleh 'admin' atau 'cashier'" });

    const hashedPassword = await bcrypt.hash(password.trim(), 12);

    // ✅ Gunakan adminId (integer) untuk created_by
    const result = await pool.query(
      `INSERT INTO users (username, password, role, active, created_by) 
       VALUES ($1, $2, $3, true, $4) RETURNING uuid_id AS id, username, role, active`,
      [username.trim(), hashedPassword, role, adminId] // ← integer
    );

    console.log(`[ADMIN] User created by UUID ${adminUuid}: ${username} (${role})`);
    res.status(201).json({ success: true, message: "Pengguna berhasil ditambahkan", user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ success: false, message: "Username sudah terdaftar" });
    if (err.message === "User tidak ditemukan") return res.status(403).json({ success: false, message: "Admin tidak valid" });
    console.error("ADMIN CREATE USER ERROR:", err.message);
    res.status(500).json({ success: false, message: "Gagal menambahkan pengguna" });
  }
});

// PUT /admin/users/:uuid — update user
router.put("/:uuid", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const userUuid = parseUserUuid(req.params.uuid);
    const { username, role, active } = req.body;
    const adminUuid = req.user.id;
    const adminId = await getUserIdByUuid(adminUuid);
    const userId = await getUserIdByUuid(userUuid); // integer ID target

    if (userId === adminId) return res.status(400).json({ success: false, message: "Tidak bisa mengubah akun sendiri" });
    if (!username?.trim()) return res.status(400).json({ success: false, message: "Username wajib diisi" });
    if (role && !["admin", "cashier"].includes(role)) return res.status(400).json({ success: false, message: "Role tidak valid" });

    const isActive = active === true || active === "true" || active === 1;
    const result = await pool.query(
      `UPDATE users SET username = $1, role = $2, active = $3, updated_at = NOW() 
       WHERE id = $4 RETURNING uuid_id AS id, username, role, active`,
      [username.trim(), role || "cashier", isActive, userId] // ← gunakan id integer
    );

    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    console.log(`[ADMIN] User updated by UUID ${adminUuid}: target UUID ${userUuid} (ID: ${userId})`);
    res.json({ success: true, message: "Pengguna berhasil diperbarui", user: result.rows[0] });
  } catch (err) {
    if (err.message === "UUID tidak valid") return res.status(400).json({ success: false, message: "UUID tidak valid" });
    if (err.message === "User tidak ditemukan") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    if (err.code === "23505") return res.status(409).json({ success: false, message: "Username sudah digunakan" });
    console.error("ADMIN UPDATE USER ERROR:", err.message);
    res.status(500).json({ success: false, message: "Gagal memperbarui pengguna" });
  }
});

// POST /admin/users/:uuid/password — reset password
router.post("/:uuid/password", verifyToken, onlyAdmin, resetPasswordLimiter, async (req, res) => {
  try {
    const userUuid = parseUserUuid(req.params.uuid);
    const { newPassword } = req.body;
    const adminUuid = req.user.id;
    const adminId = await getUserIdByUuid(adminUuid);
    const userId = await getUserIdByUuid(userUuid);

    if (userId === adminId) return res.status(400).json({ success: false, message: "Tidak bisa reset password akun sendiri" });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: "Password baru minimal 6 karakter" });

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [hashedPassword, userId]);

    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    console.log(`[ADMIN] Password reset by UUID ${adminUuid} for user UUID ${userUuid} (ID: ${userId})`);
    res.json({ success: true, message: "Password berhasil diperbarui" });
  } catch (err) {
    if (err.message === "UUID tidak valid") return res.status(400).json({ success: false, message: "UUID tidak valid" });
    if (err.message === "User tidak ditemukan") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    console.error("ADMIN RESET PASSWORD ERROR:", err.message);
    res.status(500).json({ success: false, message: "Gagal memperbarui password" });
  }
});

// DELETE /admin/users/:uuid — hapus user
router.delete("/:uuid", verifyToken, onlyAdmin, async (req, res) => {
  console.log("🔥 [EXPRESS] DELETE UUID received:", req.params.uuid);
  try {
    const userUuid = parseUserUuid(req.params.uuid);
    const adminUuid = req.user.id;
    const adminId = await getUserIdByUuid(adminUuid);
    const userId = await getUserIdByUuid(userUuid);

    if (userId === adminId) return res.status(400).json({ success: false, message: "Tidak bisa menghapus akun sendiri" });

    const ordersCheck = await pool.query(`SELECT 1 FROM orders WHERE cashier_id = $1 LIMIT 1`, [userId]);
    if (ordersCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Tidak bisa dihapus: user ini pernah digunakan di order" });
    }

    const result = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });

    console.log(`[ADMIN] User deleted by UUID ${adminUuid}: UUID ${userUuid} (ID: ${userId})`);
    res.json({ success: true, message: "Pengguna berhasil dihapus" });
  } catch (err) {
    if (err.message === "UUID tidak valid") return res.status(400).json({ success: false, message: "UUID tidak valid" });
    if (err.message === "User tidak ditemukan") return res.status(404).json({ success: false, message: "Pengguna tidak ditemukan" });
    console.error("ADMIN DELETE USER ERROR:", err.message);
    res.status(500).json({ success: false, message: "Gagal menghapus pengguna" });
  }
});

export default router;
