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

// GET /api/admin/reports/orders
router.get("/orders", verifyToken, onlyAdmin, async (req, res) => {
  const { period = "7days", start, end } = req.query;

  const validPeriods = ["today", "7days", "30days", "all"];
  if (period && !validPeriods.includes(period)) {
    return res.status(400).json({ success: false, message: "Periode tidak valid" });
  }

  if ((start && !end) || (!start && end)) {
    return res.status(400).json({ success: false, message: "'start' dan 'end' harus diisi bersamaan" });
  }

  try {
    let whereClause = "WHERE o.status = 'PAID'";
    const values = [];

    if (period === "custom" && start && end) {
      whereClause += " AND o.created_at >= $1 AND o.created_at <= $2";
      values.push(new Date(start), new Date(end));
    } else {
      switch (period) {
        case "today":
          whereClause += " AND DATE(o.created_at) = CURRENT_DATE";
          break;
        case "7days":
          whereClause += " AND o.created_at >= NOW() - INTERVAL '7 days'";
          break;
        case "30days":
          whereClause += " AND o.created_at >= NOW() - INTERVAL '30 days'";
          break;
        // case "all": no additional clause
      }
    }

    const query = `
      SELECT 
        o.id,
        o.order_number,
        o.customer_name,
        o.table_number,
        o.status,
        o.payment_method,
        o.total::numeric, -- konversi ke numeric
        o.created_at,
        COALESCE(json_agg(json_build_object(
          'product_name', oi.product_name,
          'quantity', oi.qty,
          'price', oi.price::numeric,
          'subtotal', oi.subtotal::numeric
        )) FILTER (WHERE oi.product_name IS NOT NULL), '[]') as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC;
    `;

    const result = await pool.query(query, values);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("GET ORDERS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data" });
  }
});

export default router;
