// routes/products.js
import express from "express";
import { pool } from "../config.js";
import { verifyToken } from "../middlewares/auth.js";
import { onlyAdmin, adminOrCashier } from "../middlewares/role.js";

const router = express.Router();

/**
 * GET /api/products
 * 👥 Akses: admin & kasir
 */
router.get("/", verifyToken, adminOrCashier, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, price, category, active, created_at, color
      FROM products
      WHERE active = true
      ORDER BY category, name
    `);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil produk" });
  }
});

/**
 * POST /api/products
 * 👤 Akses: hanya admin
 */
router.post("/", verifyToken, onlyAdmin, async (req, res) => {
  const { name, price, category, color } = req.body;

  if (!name || !name.trim() || typeof price !== "number" || price < 0) {
    return res.status(400).json({
      success: false,
      message: "Nama harus diisi dan harga tidak boleh negatif",
    });
  }

  // Warna default berdasarkan kategori (JavaScript object biasa)
  const defaultColorMap = {
    Makanan: "#EF4444",
    Minuman: "#3B82F6",
    Katering: "#10B981",
    Tambahan: "#F59E0B",
  };

  const finalColor = color || defaultColorMap[category?.trim() || ""] || "#808080";

  try {
    await pool.query(`INSERT INTO products (name, price, category, active, color) VALUES ($1, $2, $3, true, $4)`, [name.trim(), price, category?.trim() || "", finalColor]);

    console.log(`[PRODUCTS] Product created by ${req.user.username}: ${name}`);
    res.status(201).json({ success: true, message: "Produk berhasil ditambahkan" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Produk dengan nama ini sudah ada" });
    }
    console.error("CREATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menambahkan produk" });
  }
});

/**
 * PUT /api/products/:id
 * 👤 Akses: hanya admin
 */
router.put("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, price, category, active, color } = req.body;

  if (!name || !name.trim() || typeof price !== "number" || price < 0) {
    return res.status(400).json({
      success: false,
      message: "Nama harus diisi dan harga tidak boleh negatif",
    });
  }

  // Warna default berdasarkan kategori
  const defaultColorMap = {
    Makanan: "#EF4444",
    Minuman: "#3B82F6",
    Katering: "#10B981",
    Tambahan: "#F59E0B",
  };

  const finalColor = color === undefined ? defaultColorMap[category?.trim() || ""] || "#808080" : color;

  try {
    const result = await pool.query(
      `UPDATE products 
       SET name = $1, price = $2, category = $3, active = $4, color = $5 
       WHERE id = $6`,
      [name.trim(), price, category?.trim() || "", active ?? true, finalColor, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
    }

    console.log(`[PRODUCTS] Product updated by ${req.user.username}: ${name}`);
    res.json({ success: true, message: "Produk berhasil diperbarui" });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Nama produk sudah digunakan" });
    }
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui produk" });
  }
});

/**
 * DELETE /api/products/:id (soft delete)
 * 👤 Akses: hanya admin
 */
router.delete("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`UPDATE products SET active = false WHERE id = $1`, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Produk tidak ditemukan" });
    }

    console.log(`[PRODUCTS] Product deactivated by ${req.user.username}: ID ${id}`);
    res.json({ success: true, message: "Produk berhasil dinonaktifkan" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menonaktifkan produk" });
  }
});

export default router;
