// backend/routes/print.js
import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/* ================= UTIL ================= */

function sanitizeText(text, max = 32) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\n\r\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .substring(0, max);
}

function formatRupiah(num) {
  const n = typeof num === "string" ? parseFloat(num) : num;
  return `Rp ${Math.round(n)}`;
}

function formatDate(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ================= ROUTE ================= */

router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;
  console.log("[PRINT]", orderId);

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const response = { printData: [] };

  if (!uuid.test(orderId)) {
    response.printData.push({
      type: 0,
      content: "ID TIDAK VALID",
      bold: 1,
      align: 1,
      format: 0,
    });
    return res.json(response);
  }

  try {
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order,
              created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      response.printData.push({
        type: 0,
        content: "ORDER TIDAK DITEMUKAN",
        bold: 1,
        align: 1,
        format: 0,
      });
      return res.json(response);
    }

    const order = orderRes.rows[0];

    const itemsRes = await pool.query(
      `SELECT p.name AS product_name, oi.qty, oi.subtotal
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const p = response.printData;

    /* ===== HEADER ===== */
    p.push(
      { type: 0, content: "SOTO IBUK SENOPATI", bold: 1, align: 1, format: 2 },
      { type: 0, content: "Jl. Tulodong Atas 1 No 3A", align: 1 },
      { type: 0, content: "Kebayoran Baru Jakarta", align: 1 },
      { type: 0, content: "------------------------------" }
    );

    /* ===== INFO ===== */
    p.push(
      { type: 0, content: `Order : ${order.order_number}` },
      order.customer_name && order.customer_name !== "-" ? { type: 0, content: `Pelanggan : ${sanitizeText(order.customer_name)}` } : null,
      order.table_number ? { type: 0, content: `Meja : ${order.table_number}` } : null,
      {
        type: 0,
        content: `Tipe : ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}`,
      },
      { type: 0, content: formatDate(order.created_at) },
      { type: 0, content: "------------------------------" }
    );

    /* ===== ITEMS ===== */
    if (itemsRes.rows.length === 0) {
      p.push({ type: 0, content: "BELUM ADA ITEM", bold: 1, align: 1 });
    } else {
      itemsRes.rows.forEach((i) => {
        const name = sanitizeText(i.product_name, 16).padEnd(16);
        const qty = `${i.qty}x`.padStart(4);
        p.push({
          type: 0,
          content: `${name}${qty} ${formatRupiah(i.subtotal)}`,
        });
      });
    }

    /* ===== TOTAL ===== */
    p.push(
      { type: 0, content: "------------------------------" },
      {
        type: 0,
        content: `Subtotal ${formatRupiah(order.subtotal)}`,
        align: 2,
      },
      order.discount > 0
        ? {
            type: 0,
            content: `Diskon ${formatRupiah(order.discount)}`,
            align: 2,
          }
        : null,
      order.tax > 0
        ? {
            type: 0,
            content: `Pajak ${formatRupiah(order.tax)}`,
            align: 2,
          }
        : null,
      {
        type: 0,
        content: `TOTAL ${formatRupiah(order.total)}`,
        bold: 1,
        align: 2,
        format: 1,
      },
      { type: 0, content: `Metode: ${order.payment_method}` },
      { type: 0, content: "Terima kasih", bold: 1, align: 1 },
      { type: 0, content: " " }
    );

    response.printData = p.filter(Boolean);

    console.log("[PRINT JSON]", JSON.stringify(response, null, 2));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(response));
  } catch (e) {
    console.error("[PRINT ERROR]", e);
    res.json({
      printData: [
        {
          type: 0,
          content: "GAGAL CETAK STRUK",
          bold: 1,
          align: 1,
          format: 0,
        },
      ],
    });
  }
});

export default router;
