import express from "express";
import { pool } from "../../config.js";
import { verifyToken } from "../../middlewares/auth.js";
import { onlyAdmin } from "../../middlewares/role.js";

const router = express.Router();

/**
 * GET /api/admin/products
 * 📋 Ambil semua produk (untuk edit di admin)
 */
router.get("/", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, name, price, category, type, active, created_at, color
      FROM products
      ORDER BY name
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error("GET ADMIN PRODUCTS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data produk" });
  }
});

/**
 * GET /api/admin/products/categories-with-color
 * 🎨 Ambil daftar unik kategori beserta warna representatif (ambil dari produk pertama)
 */
router.get("/categories-with-color", verifyToken, onlyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (category)
        category AS name,
        color
      FROM products
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category, id
    `);

    const categories = result.rows.map((row) => ({
      name: row.name,
      color: row.color || "#808080",
    }));

    res.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (err) {
    console.error("GET CATEGORIES WITH COLOR ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil kategori dengan warna" });
  }
});

/**
 * POST /api/admin/products
 * ➕ Tambah produk baru
 */
router.post("/", verifyToken, onlyAdmin, async (req, res) => {
  const { name, price, category, code, type, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Nama produk wajib diisi" });
  }
  if (!price || isNaN(price) || parseInt(price) <= 0) {
    return res.status(400).json({ success: false, message: "Harga harus angka positif" });
  }

  // Warna default berdasarkan kategori
  const defaultColorMap = {
    Makanan: "#EF4444",
    Minuman: "#3B82F6",
    Katering: "#10B981",
    Tambahan: "#F59E0B",
  };

  const finalColor = color || defaultColorMap[category?.trim() || ""] || "#808080";

  try {
    await pool.query(
      `INSERT INTO products (name, price, category, code, type, active, color)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [name.trim(), parseInt(price), category?.trim() || null, code?.trim() || null, type?.trim() || null, finalColor]
    );

    console.log(`[ADMIN] Product created by ${req.user.username}: ${name}`);
    res.status(201).json({ success: true, message: "Produk berhasil ditambahkan" });
  } catch (err) {
    console.error("CREATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menambah produk" });
  }
});

/**
 * POST /api/admin/products/categories
 * ➕ Validasi dan siapkan kategori baru (tanpa insert ke tabel terpisah)
 */
router.post("/categories", verifyToken, onlyAdmin, async (req, res) => {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Nama kategori wajib diisi" });
  }

  // Validasi warna HEX
  if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
    return res.status(400).json({ success: false, message: "Format warna harus HEX, contoh: #EF4444" });
  }

  // Cek apakah kategori sudah ada
  const check = await pool.query(`SELECT 1 FROM products WHERE category = $1 LIMIT 1`, [name.trim()]);

  if (check.rows.length > 0) {
    return res.status(400).json({ success: false, message: "Kategori sudah ada" });
  }

  // Respons sukses — kategori siap digunakan saat produk pertama ditambahkan
  res.status(201).json({
    success: true,
    message: "Kategori siap digunakan",
    data: { name: name.trim(), color: color || "#808080" },
  });
});

/**
 * PUT /api/admin/products/:id
 * ✏️ Update produk
 */
router.put("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, price, category, code, type, active, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: "Nama produk wajib diisi" });
  }
  if (!price || isNaN(price) || parseInt(price) <= 0) {
    return res.status(400).json({ success: false, message: "Harga harus angka positif" });
  }

  // Jika color tidak dikirim, pertahankan yang lama
  let finalColor = color;
  if (color === undefined) {
    const current = await pool.query(`SELECT color FROM products WHERE id = $1`, [id]);
    if (current.rows.length > 0) {
      finalColor = current.rows[0].color;
    } else {
      return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET name = $1, price = $2, category = $3, code = $4, type = $5, active = $6, color = $7
       WHERE id = $8`,
      [name.trim(), parseInt(price), category?.trim() || null, code?.trim() || null, type?.trim() || null, active ?? true, finalColor, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
    }

    console.log(`[ADMIN] Product updated by ${req.user.username}: ID ${id}`);
    res.json({ success: true, message: "Produk berhasil diperbarui" });
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui produk" });
  }
});

/**
 * PUT /api/admin/products/bulk-update-category-color
 * 🎨 Update warna semua produk dalam satu kategori
 */
router.put("/bulk-update-category-color", verifyToken, onlyAdmin, async (req, res) => {
  const { category, color } = req.body;

  if (!category?.trim() || !color?.trim()) {
    return res.status(400).json({ success: false, message: "Kategori dan warna wajib diisi" });
  }

  if (!/^#[0-9A-F]{6}$/i.test(color)) {
    return res.status(400).json({ success: false, message: "Format warna harus HEX, contoh: #EF4444" });
  }

  try {
    const result = await pool.query(`UPDATE products SET color = $1 WHERE category = $2`, [color, category.trim()]);

    console.log(`[ADMIN] Updated color for category "${category}" to ${color} (${result.rowCount} products)`);
    res.json({
      success: true,
      message: `Warna kategori "${category}" berhasil diperbarui. ${result.rowCount} produk diperbarui.`,
    });
  } catch (err) {
    console.error("BULK UPDATE CATEGORY COLOR ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui warna kategori" });
  }
});

/**
 * PUT /api/admin/products/categories
 * ✏️ Rename kategori
 */
router.put("/categories", verifyToken, onlyAdmin, async (req, res) => {
  const { oldName, newName } = req.body;

  if (!oldName?.trim() || !newName?.trim()) {
    return res.status(400).json({ success: false, message: "Nama lama dan baru wajib diisi" });
  }
  if (oldName === newName) {
    return res.status(400).json({ success: false, message: "Nama baru harus berbeda" });
  }

  // Cek duplikat nama baru
  const exists = await pool.query(`SELECT 1 FROM products WHERE category = $1 LIMIT 1`, [newName.trim()]);
  if (exists.rows.length > 0) {
    return res.status(400).json({ success: false, message: "Nama kategori baru sudah digunakan" });
  }

  try {
    const result = await pool.query(`UPDATE products SET category = $1 WHERE category = $2`, [newName.trim(), oldName.trim()]);

    console.log(`[ADMIN] Updated ${result.rowCount} products: category "${oldName}" → "${newName}"`);
    res.json({ success: true, message: `Kategori diubah. ${result.rowCount} produk diperbarui.` });
  } catch (err) {
    console.error("RENAME CATEGORY ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui kategori" });
  }
});

/**
 * DELETE /api/admin/products/categories
 * 🗑️ Hapus kategori (set ke NULL) — terima via req.body
 */
router.delete("/categories", verifyToken, onlyAdmin, async (req, res) => {
  // ✅ Perbaikan utama: ambil dari req.body, bukan req.query
  const { name } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ success: false, message: "Nama kategori wajib diisi" });
  }

  try {
    const result = await pool.query(`UPDATE products SET category = NULL WHERE category = $1`, [name.trim()]);

    console.log(`[ADMIN] Removed category "${name}" from ${result.rowCount} products`);
    res.json({ success: true, message: `Kategori dihapus dari ${result.rowCount} produk.` });
  } catch (err) {
    console.error("DELETE CATEGORY ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menghapus kategori" });
  }
});

/**
 * DELETE /api/admin/products/:id
 * 🗑️ Hapus produk (hard delete — karena ini admin)
 */
router.delete("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const orderCheck = await pool.query(`SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1`, [id]);

    if (orderCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Tidak bisa dihapus: produk sudah pernah digunakan di order",
      });
    }

    const result = await pool.query(`DELETE FROM products WHERE id = $1`, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
    }

    console.log(`[ADMIN] Product deleted by ${req.user.username}: ID ${id}`);
    res.json({ success: true, message: "Produk berhasil dihapus" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menghapus produk" });
  }
});

export default router;
