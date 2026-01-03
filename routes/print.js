// backend/routes/print.js
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
  const n = typeof num === "string" ? parseFloat(num) : num;
  return `Rp ${Math.round(n)}`;
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
 * Kirim JSON murni
 */
function sendJsonResponse(res, obj) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(JSON.stringify(obj, null, 2));
}

/**
 * GET /api/print/receipt/:orderId
 */
router.get("/receipt/:orderId", async (req, res) => {
  const orderId = req.params.orderId;

  console.log("[DEBUG] Step 0 - Request received:", orderId);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(orderId)) {
    console.log("[DEBUG] Step 1 - Invalid UUID");
    return sendJsonResponse(res, {
      success: "false",
      data: null,
      error: "ID TIDAK VALID",
    });
  }

  try {
    // ===== Step 2: Query orders =====
    console.log("[DEBUG] Step 2 - Querying orders table...");
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order,
              created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    console.log("[DEBUG] Step 2 - orderRes.rows:", orderRes.rows);

    if (orderRes.rows.length === 0) {
      console.log("[DEBUG] Step 3 - Order not found");
      return sendJsonResponse(res, {
        success: "false",
        data: null,
        error: "ORDER TIDAK DITEMUKAN",
      });
    }

    const order = orderRes.rows[0];

    // ===== Step 4: Query order_items =====
    console.log("[DEBUG] Step 4 - Querying order_items...");
    const itemsRes = await pool.query(
      `SELECT p.name AS product_name, oi.qty, oi.subtotal
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    console.log("[DEBUG] Step 4 - itemsRes.rows:", itemsRes.rows);

    // ===== Step 5: Build receipt =====
    const output = [];
    output.push({ step: 5, status: "info", message: "Starting receipt build" });

    // HEADER
    const headerLines = ["SOTO IBUK SENOPATI", "Jl.Tulodong Atas 1 no 3A", "Kebayoran Baru Jakarta", "------------------------------"];
    headerLines.forEach((line, idx) => output.push({ step: 5, status: "header", index: idx, content: line }));

    // INFO
    const infoLines = [
      `Order: ${order.order_number}`,
      order.customer_name && order.customer_name !== "Customer Umum" ? `Pelanggan: ${order.customer_name}` : null,
      order.table_number ? `Meja: ${order.table_number}` : null,
      `Tipe: ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}`,
      formatDate(order.created_at),
      "------------------------------",
    ].filter(Boolean);

    infoLines.forEach((line, idx) =>
      output.push({
        step: 5,
        status: "info",
        index: idx,
        content: sanitizeText(line),
      })
    );

    // ITEMS
    if (itemsRes.rows.length === 0) {
      console.log("[DEBUG] Step 6 - No items found");
      output.push({ step: 6, status: "warning", message: "BELUM ADA ITEM", bold: true });
    } else {
      itemsRes.rows.forEach((item, idx) => {
        const name = sanitizeText(item.product_name).padEnd(16);
        const qty = `${item.qty}x`.padStart(4);
        const price = formatRupiah(item.subtotal);
        const line = sanitizeText(`${name}${qty} ${price}`);
        output.push({ step: 6, status: "item", index: idx, content: line });
      });
    }

    output.push({ step: 6, status: "info", content: "------------------------------" });

    // TOTAL
    const totalLines = [
      `Subtotal ${formatRupiah(order.subtotal)}`,
      order.discount > 0 ? `Diskon   ${formatRupiah(order.discount)}` : null,
      order.tax > 0 ? `Pajak    ${formatRupiah(order.tax)}` : null,
      `TOTAL    ${formatRupiah(order.total)}`,
      "------------------------------",
      `Metode: ${order.payment_method}`,
      "Terima kasih",
    ].filter(Boolean);

    totalLines.forEach((line, idx) => output.push({ step: 7, status: "total", index: idx, content: sanitizeText(line) }));

    console.log("[DEBUG] Step 8 - Final receipt built");

    // ✅ Return JSON compatible dengan mobile / printer
    sendJsonResponse(res, { success: "true", data: output, error: null });
  } catch (err) {
    console.error("[DEBUG] PRINT ERROR:", err);
    sendJsonResponse(res, { success: "false", data: null, error: `GAGAL MUAT STRUK: ${err.message}` });
  }
});

export default router;
