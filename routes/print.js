import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/* =======================
   HELPER FUNCTIONS
======================= */

function sanitizeText(text, max = 32) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\n\r\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "") // ASCII only
    .trim()
    .substring(0, max);
}

function formatRupiah(num) {
  const n = Number(num || 0);
  return `Rp ${n.toLocaleString("id-ID")}`;
}

function formatDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* =======================
   ROUTE PRINT
======================= */

router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;
  console.log("[PRINT]", orderId);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // ⚠️ PENTING: KITA KUMPULKAN KE ARRAY DULU
  const print = [];

  if (!uuidRegex.test(orderId)) {
    print.push({
      type: 0,
      content: "ID TIDAK VALID",
      bold: 1,
      align: 1,
      format: 0,
    });
    return sendThermer(res, print);
  }

  try {
    /* ===== ORDER ===== */
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order,
              created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      print.push({
        type: 0,
        content: "ORDER TIDAK DITEMUKAN",
        bold: 1,
        align: 1,
        format: 0,
      });
      return sendThermer(res, print);
    }

    const order = orderRes.rows[0];

    /* ===== ITEMS ===== */
    const itemsRes = await pool.query(
      `SELECT product_name, qty, subtotal
       FROM order_items
       WHERE order_id = $1`,
      [orderId]
    );

    /* ===== HEADER ===== */
    print.push(
      { type: 0, content: "SOTO IBUK SENOPATI", bold: 1, align: 1, format: 3 },
      { type: 0, content: "Jl. Tulodong Atas 1 No 3A", align: 1 },
      { type: 0, content: "Kebayoran Baru Jakarta", align: 1 },
      { type: 0, content: "--------------------------------" }
    );

    /* ===== INFO ===== */
    print.push(
      { type: 0, content: `Order : ${order.order_number}` },
      order.customer_name ? { type: 0, content: `Pelanggan : ${sanitizeText(order.customer_name)}` } : null,
      order.table_number ? { type: 0, content: `Meja : ${order.table_number}` } : null,
      {
        type: 0,
        content: `Tipe : ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}`,
      },
      { type: 0, content: formatDate(order.created_at) },
      { type: 0, content: "--------------------------------" }
    );

    /* ===== ITEMS ===== */
    if (itemsRes.rows.length === 0) {
      print.push({
        type: 0,
        content: "BELUM ADA ITEM",
        bold: 1,
        align: 1,
      });
    } else {
      itemsRes.rows.forEach((item) => {
        const name = sanitizeText(item.product_name, 16).padEnd(16);
        const qty = `${item.qty}x`.padStart(4);
        const price = formatRupiah(item.subtotal);
        print.push({
          type: 0,
          content: `${name}${qty} ${price}`,
        });
      });
    }

    /* ===== TOTAL ===== */
    print.push(
      { type: 0, content: "--------------------------------" },
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

    return sendThermer(res, print.filter(Boolean));
  } catch (err) {
    console.error("[PRINT ERROR]", err);
    return sendThermer(res, [
      {
        type: 0,
        content: "GAGAL CETAK STRUK",
        bold: 1,
        align: 1,
        format: 0,
      },
    ]);
  }
});

/* =======================
   🔥 PENTING UNTUK THERMER
   ARRAY ➜ OBJECT
======================= */

function sendThermer(res, arr) {
  const obj = {};
  arr.forEach((item, index) => {
    obj[index] = item;
  });

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

export default router;
