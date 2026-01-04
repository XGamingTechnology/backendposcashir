// routes/api/admin/product-categories.js
import express from "express";
import { pool } from "../../config.js";
import { verifyToken } from "../../middlewares/auth.js";
import { onlyAdmin } from "../../middlewares/role.js";

const router = express.Router();

const DEFAULT_COLOR_MAP = {
  Makanan: "#EF4444",
  Minuman: "#3B82F6",
  Katering: "#10B981",
  Tambahan: "#F59E0B",
};

/**
 * GET /api/admin/product-categories
 * 📋 Ambil semua kategori
 */
router.get("/", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT name, color, created_at
      FROM product_categories
      ORDER BY name
    `);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    console.error("GET CATEGORIES ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil daftar kategori" });
  }
});

/**
 * POST /api/admin/product-categories
 * ➕ Tambah kategori baru
 */
router.post("/", verifyToken, onlyAdmin, async (req, res) => {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Nama kategori wajib diisi" });
  }

  const categoryName = name.trim();
  const finalColor = color && /^#[0-9A-F]{6}$/i.test(color) ? color : DEFAULT_COLOR_MAP[categoryName] || "#808080";

  try {
    const result = await pool.query(
      `INSERT INTO product_categories (name, color)
       VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [categoryName, finalColor]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Kategori sudah ada" });
    }

    console.log(`[ADMIN] Category created by ${req.user.username}: ${categoryName}`);
    res.status(201).json({ success: true, message: "Kategori berhasil ditambahkan", data: result.rows[0] });
  } catch (err) {
    console.error("CREATE CATEGORY ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menambah kategori" });
  }
});

/**
 * PUT /api/admin/product-categories/:name
 * ✏️ Ubah nama atau warna kategori
 */
router.put("/:name", verifyToken, onlyAdmin, async (req, res) => {
  const oldName = req.params.name;
  const { newName, color } = req.body;

  if (!oldName?.trim()) {
    return res.status(400).json({ success: false, message: "Nama lama tidak valid" });
  }

  let finalNewName = newName?.trim() || oldName.trim();
  const finalColor = color && /^#[0-9A-F]{6}$/i.test(color) ? color : null;

  if (finalNewName === oldName && !finalColor) {
    return res.status(400).json({ success: false, message: "Tidak ada perubahan" });
  }

  try {
    // Cek duplikat jika ganti nama
    if (finalNewName !== oldName) {
      const exists = await pool.query("SELECT 1 FROM product_categories WHERE name = $1", [finalNewName]);
      if (exists.rows.length > 0) {
        return res.status(400).json({ success: false, message: "Nama kategori baru sudah digunakan" });
      }
    }

    // Update di tabel kategori
    let query = "UPDATE product_categories SET ";
    const params = [];
    let setParts = [];
    let paramIndex = 1;

    if (finalNewName !== oldName) {
      setParts.push(`name = $${paramIndex}`);
      params.push(finalNewName);
      paramIndex++;
    }
    if (finalColor) {
      setParts.push(`color = $${paramIndex}`);
      params.push(finalColor);
      paramIndex++;
    }

    if (setParts.length === 0) {
      return res.status(400).json({ success: false, message: "Tidak ada data untuk diperbarui" });
    }

    query += setParts.join(", ") + ` WHERE name = $${paramIndex}`;
    params.push(oldName);

    const catResult = await pool.query(query, params);

    if (catResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Kategori tidak ditemukan" });
    }

    // Jika nama berubah, update semua produk yang pakai kategori lama
    if (finalNewName !== oldName) {
      await pool.query("UPDATE products SET category = $1 WHERE category = $2", [finalNewName, oldName]);
    }

    res.json({ success: true, message: "Kategori berhasil diperbarui" });
  } catch (err) {
    console.error("UPDATE CATEGORY ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui kategori" });
  }
});

/**
 * DELETE /api/admin/product-categories/:name
 * 🗑️ Hapus kategori (hanya jika tidak dipakai)
 */
router.delete("/:name", verifyToken, onlyAdmin, async (req, res) => {
  const { name } = req.params;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Nama kategori wajib diisi" });
  }

  try {
    // Cek apakah masih dipakai di products
    const used = await pool.query("SELECT 1 FROM products WHERE category = $1 LIMIT 1", [name.trim()]);
    if (used.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Tidak bisa dihapus: kategori masih digunakan oleh produk",
      });
    }

    const result = await pool.query("DELETE FROM product_categories WHERE name = $1", [name.trim()]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Kategori tidak ditemukan" });
    }

    console.log(`[ADMIN] Category deleted by ${req.user.username}: ${name}`);
    res.json({ success: true, message: "Kategori berhasil dihapus" });
  } catch (err) {
    console.error("DELETE CATEGORY ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menghapus kategori" });
  }
});

export default router;
