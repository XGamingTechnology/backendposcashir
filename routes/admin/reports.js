// routes/admin/reports.js
import express from "express";
import { pool } from "../../config.js";
import { verifyToken } from "../../middlewares/auth.js";
import { onlyAdmin } from "../../middlewares/role.js";

const router = express.Router();

// Helper: validasi dan bangun kondisi tanggal dengan aman
function buildDateCondition(period, start, end) {
  const conditions = [];

  if (start && end) {
    // Gunakan parameterized query untuk hindari SQL injection
    conditions.push({ sql: "o.created_at >= $1", value: new Date(start) });
    conditions.push({ sql: "o.created_at <= $2", value: new Date(end) });
  } else {
    // Gunakan predefined period
    switch (period) {
      case "today":
        conditions.push({ sql: "DATE(o.created_at) = CURRENT_DATE", value: null });
        break;
      case "7days":
        conditions.push({ sql: "o.created_at >= NOW() - INTERVAL '7 days'", value: null });
        break;
      case "30days":
        conditions.push({ sql: "o.created_at >= NOW() - INTERVAL '30 days'", value: null });
        break;
      case "all":
        // Tidak ada kondisi
        break;
      default:
        throw new Error("Invalid period");
    }
  }

  return conditions;
}

// GET /api/admin/reports/top-products
router.get("/top-products", verifyToken, onlyAdmin, async (req, res) => {
  const { period = "7days", start, end } = req.query;

  // Validasi period
  const validPeriods = ["today", "7days", "30days", "all"];
  if (period && !validPeriods.includes(period)) {
    return res.status(400).json({ success: false, message: "Periode tidak valid. Gunakan: today, 7days, 30days, atau all" });
  }

  // Jika start/end ada, pastikan format valid
  if ((start && !end) || (!start && end)) {
    return res.status(400).json({ success: false, message: "Jika menggunakan rentang, 'start' dan 'end' harus diisi bersamaan (format ISO: YYYY-MM-DD)" });
  }

  try {
    // Bangun kondisi tanggal
    const dateConditions = buildDateCondition(period, start, end);
    const whereClauses = dateConditions.map((cond) => cond.sql).join(" AND ");
    const values = dateConditions.filter((cond) => cond.value !== null).map((cond) => cond.value);

    // Bangun query dengan parameterized values
    const baseQuery = `
      SELECT 
        oi.product_name,
        SUM(oi.qty) as total_qty,
        SUM(oi.subtotal) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'PAID'
    `;

    const groupQuery = `
      GROUP BY oi.product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `;

    let fullQuery = baseQuery;
    let queryValues = [];

    if (whereClauses) {
      fullQuery += ` AND ${whereClauses}`;
    }
    fullQuery += groupQuery;

    // Gabungkan nilai parameter (offset index sesuai jumlah kondisi)
    queryValues = values;

    const result = await pool.query(fullQuery, queryValues);

    const data = result.rows.map((row) => ({
      name: row.product_name,
      qty: parseInt(row.total_qty, 10),
      revenue: parseFloat(row.total_revenue),
    }));

    res.json({ success: true, data });
  } catch (err) {
    if (err.message === "Invalid period") {
      return res.status(400).json({ success: false, message: "Periode tidak valid" });
    }
    console.error("GET TOP PRODUCTS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data produk" });
  }
});

export default router;
