import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/**
 * Sanitasi ketat untuk thermal printer
 * - ASCII only
 * - max 32 char
 */
function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\n\r\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .substring(0, 32);
}

/**
 * Formatter angka TANPA locale
 */
function formatRupiah(num) {
  return `Rp ${Math.round(num)}`;
}

/**
 * Formatter tanggal MANUAL
 */
function formatDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Helper kirim JSON murni
 */
function sendJsonResponse(res, data) {
  const jsonStr = JSON.stringify(data);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(jsonStr);
}

/**
 * GET /api/print/receipt/:orderId
 */
router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(orderId)) {
    return sendJsonResponse(res, [{ type: 0, content: "ID TIDAK VALID", align: 1, bold: 1 }]);
  }

  try {
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order,
              created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return sendJsonResponse(res, [{ type: 0, content: "ORDER TIDAK DITEMUKAN", align: 1, bold: 1 }]);
    }

    const order = orderRes.rows[0];

    const itemsRes = await pool.query(
      `SELECT p.name AS product_name, oi.qty, oi.subtotal
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const output = [];

    // ===== HEADER =====
    output.push({ type: 0, content: "SOTO IBUK SENOPATI", align: 1, bold: 1 });
    output.push({ type: 0, content: "Jl.Tulodong Atas 1 no 3A", align: 1 });
    output.push({ type: 0, content: "Kebayoran Baru Jakarta", align: 1 });
    output.push({ type: 0, content: "------------------------------", align: 0 });

    // ===== INFO =====
    output.push({ type: 0, content: sanitizeText(`Order: ${order.order_number}`), align: 0 });

    if (order.customer_name && order.customer_name !== "Customer Umum") {
      output.push({ type: 0, content: sanitizeText(`Pelanggan: ${order.customer_name}`), align: 0 });
    }

    if (order.table_number) {
      output.push({ type: 0, content: sanitizeText(`Meja: ${order.table_number}`), align: 0 });
    }

    const typeOrder = order.type_order === "dine_in" ? "Dine In" : "Takeaway";
    output.push({ type: 0, content: sanitizeText(`Tipe: ${typeOrder}`), align: 0 });
    output.push({ type: 0, content: formatDate(order.created_at), align: 0 });

    output.push({ type: 0, content: "------------------------------", align: 0 });

    // ===== ITEMS =====
    itemsRes.rows.forEach((item) => {
      const name = sanitizeText(item.product_name).padEnd(16);
      const qty = `${item.qty}x`.padStart(4);
      const price = formatRupiah(item.subtotal);
      const line = sanitizeText(`${name}${qty} ${price}`);
      output.push({ type: 0, content: line, align: 0 });
    });

    output.push({ type: 0, content: "------------------------------", align: 0 });

    // ===== TOTAL =====
    output.push({ type: 0, content: sanitizeText(`Subtotal ${formatRupiah(order.subtotal)}`), align: 0 });

    if (order.discount > 0) {
      output.push({ type: 0, content: sanitizeText(`Diskon   ${formatRupiah(order.discount)}`), align: 0 });
    }

    if (order.tax > 0) {
      output.push({ type: 0, content: sanitizeText(`Pajak    ${formatRupiah(order.tax)}`), align: 0 });
    }

    output.push({
      type: 0,
      content: sanitizeText(`TOTAL    ${formatRupiah(order.total)}`),
      align: 0,
      bold: 1,
    });

    output.push({ type: 0, content: "------------------------------", align: 0 });
    output.push({ type: 0, content: sanitizeText(`Metode: ${order.payment_method}`), align: 1 });
    output.push({ type: 0, content: "Terima kasih", align: 1, bold: 1 });

    sendJsonResponse(res, output);
  } catch (err) {
    console.error("PRINT ERROR:", err);
    sendJsonResponse(res, [{ type: 0, content: "GAGAL MUAT STRUK", align: 1, bold: 1 }]);
  }
});

export default router;
