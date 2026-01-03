// routes/print.js
import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/**
 * Membersihkan teks agar aman untuk JSON dan printer thermal
 */
function sanitizeText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\n\r\t]/g, " ") // ganti line break/tab dengan spasi
    .replace(/"/g, '\\"') // escape tanda kutip
    .replace(/[^\x20-\x7E]/g, "") // hanya izinkan karakter ASCII printable (32–126)
    .trim();
}

/**
 * GET /api/print/receipt/:orderId
 * Endpoint publik untuk Bluetooth Print App
 * HARUS mengembalikan JSON array murni, tanpa wrapper, tanpa HTML, tanpa cache
 */
router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;

  // Validasi UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orderId)) {
    const fallback = [{ type: 0, content: "ID TIDAK VALID", align: 1, bold: 1 }];
    return sendJsonResponse(res, fallback);
  }

  try {
    // Ambil order
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order, created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      const fallback = [{ type: 0, content: "ORDER TIDAK DITEMUKAN", align: 1, bold: 1 }];
      return sendJsonResponse(res, fallback);
    }

    const order = orderRes.rows[0];

    // Ambil item
    const itemsRes = await pool.query(
      `SELECT p.name AS product_name, oi.qty, oi.subtotal
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    // Bangun output sesuai spesifikasi Bluetooth Print App
    const output = [];

    // Header
    output.push({ type: 0, content: sanitizeText("SOTO IBUK SENOPATI"), align: 1, bold: 1 });
    output.push({ type: 0, content: sanitizeText("Jl.Tulodong Atas 1 no 3A"), align: 1 });
    output.push({ type: 0, content: sanitizeText("Kebayoran Baru, Jakarta Selatan"), align: 1 });
    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Info order
    output.push({ type: 0, content: sanitizeText(`Order: ${order.order_number}`), align: 0 });
    if (order.customer_name && order.customer_name !== "Customer Umum") {
      output.push({ type: 0, content: sanitizeText(`Pelanggan: ${order.customer_name}`), align: 0 });
    }
    if (order.table_number) {
      output.push({ type: 0, content: sanitizeText(`Meja: ${order.table_number}`), align: 0 });
    }
    const orderType = order.type_order === "dine_in" ? "Dine In" : "Takeaway";
    output.push({ type: 0, content: sanitizeText(`Tipe: ${orderType}`), align: 0 });
    const dateStr = new Date(order.created_at).toLocaleString("id-ID");
    output.push({ type: 0, content: sanitizeText(dateStr), align: 0 });
    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Items
    itemsRes.rows.forEach((item) => {
      const name = sanitizeText(item.product_name).substring(0, 18).padEnd(18);
      const qty = `${item.qty}x`.padStart(4).substring(0, 4);
      const price = `Rp ${item.subtotal.toLocaleString("id-ID")}`;
      const line = `${name}${qty} ${price}`;
      output.push({ type: 0, content: line, align: 0 });
    });

    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Rincian
    output.push({ type: 0, content: sanitizeText(`Subtotal     Rp ${order.subtotal.toLocaleString("id-ID")}`), align: 0 });
    if (order.discount > 0) {
      output.push({ type: 0, content: sanitizeText(`Diskon       Rp ${order.discount.toLocaleString("id-ID")}`), align: 0 });
    }
    if (order.tax > 0) {
      output.push({ type: 0, content: sanitizeText(`Pajak        Rp ${order.tax.toLocaleString("id-ID")}`), align: 0 });
    }
    output.push({ type: 0, content: sanitizeText(`TOTAL        Rp ${order.total.toLocaleString("id-ID")}`), align: 0, bold: 1 });

    output.push({ type: 0, content: "------------------------------", align: 0 });
    output.push({ type: 0, content: sanitizeText(`Metode: ${order.payment_method}`), align: 1 });
    output.push({ type: 0, content: sanitizeText("Terima kasih"), align: 1, bold: 1 });

    // Kirim respons
    sendJsonResponse(res, output);
  } catch (err) {
    console.error("PRINT ERROR:", err);
    const fallback = [{ type: 0, content: "GAGAL MUAT STRUK", align: 1, bold: 1 }];
    sendJsonResponse(res, fallback);
  }
});

/**
 * Fungsi helper untuk mengirim JSON yang benar-benar bersih
 */
function sendJsonResponse(res, data) {
  try {
    const jsonStr = JSON.stringify(data);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    // Kirim MURNI — pastikan tidak ada byte tambahan
    res.end(jsonStr);
  } catch (e) {
    console.error("JSON SEND ERROR:", e);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify([{ type: 0, content: "INTERNAL ERROR", align: 1, bold: 1 }]));
  }
}

export default router;
