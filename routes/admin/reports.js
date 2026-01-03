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
    conditions.push({ sql: "o.created_at >= $1", value: new Date(start) });
    conditions.push({ sql: "o.created_at <= $2", value: new Date(end) });
  } else {
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
        break;
      default:
        throw new Error("Invalid period");
    }
  }

  return conditions;
}

// ✅ DIPERBAIKI: GET /api/admin/reports/orders — pastikan semua angka jadi number
router.get("/orders", verifyToken, onlyAdmin, async (req, res) => {
  const { period = "7days", start, end } = req.query;

  const validPeriods = ["today", "7days", "30days", "all"];
  if (period && !validPeriods.includes(period)) {
    return res.status(400).json({ success: false, message: "Periode tidak valid. Gunakan: today, 7days, 30days, atau all" });
  }

  if ((start && !end) || (!start && end)) {
    return res.status(400).json({ success: false, message: "Jika menggunakan rentang, 'start' dan 'end' harus diisi bersamaan (format YYYY-MM-DD)" });
  }

  try {
    const dateConditions = buildDateCondition(period, start, end);
    const whereClauses = dateConditions.map((cond) => cond.sql).join(" AND ");
    const values = dateConditions.filter((cond) => cond.value !== null).map((cond) => cond.value);

    // ✅ Query utama dengan konversi eksplisit ke numeric
    const query = `
      SELECT 
        o.id,
        o.order_number,
        o.customer_name,
        o.table_number,
        o.status,
        o.payment_method,
        o.total::NUMERIC AS total,        -- ✅ Pastikan total jadi number
        o.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'product_name', oi.product_name,
              'quantity', oi.qty::INTEGER,          -- ✅ quantity jadi integer
              'price', oi.price::NUMERIC,           -- ✅ price jadi number
              'subtotal', oi.subtotal::NUMERIC      -- ✅ subtotal jadi number
            )
          ) FILTER (WHERE oi.product_name IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status = 'PAID'
      ${whereClauses ? `AND ${whereClauses}` : ""}
      GROUP BY o.id
      ORDER BY o.created_at DESC;
    `;

    const result = await pool.query(query, values);

    // ✅ Opsional: Pastikan di JavaScript juga number (jika PostgreSQL masih kirim string)
    const safeData = result.rows.map((row) => ({
      ...row,
      total: Number(row.total) || 0,
      items: (row.items || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity) || 0,
        price: Number(item.price) || 0,
        subtotal: Number(item.subtotal) || 0,
      })),
    }));

    res.json({ success: true, data: safeData });
  } catch (err) {
    console.error("GET ORDERS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data order" });
  }
});

export default router;
