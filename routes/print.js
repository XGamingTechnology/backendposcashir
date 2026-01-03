// backend/routes/print.js
import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/* =========================
   HELPER FUNCTIONS (WAJIB)
========================= */

// Format tanggal Indonesia
function formatDate(date) {
  return new Date(date).toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Format Rupiah (tanpa simbol aneh)
function formatRupiah(num) {
  return `Rp ${Number(num).toLocaleString("id-ID")}`;
}

// Bersihkan & potong teks agar tidak rusak printer
function sanitizeText(text, maxLength = 16) {
  if (!text) return "";
  return text
    .replace(/[^\x20-\x7E]/g, "") // hapus karakter aneh
    .substring(0, maxLength);
}

/* =========================
   ROUTE PRINT RECEIPT
========================= */

router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;
  console.log("[PRINT]", orderId);

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  /** ⚠️ ROOT HARUS ARRAY */
  const print = [];

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(orderId)) {
    print.push({
      type: 0,
      content: "ID ORDER TIDAK VALID",
      bold: 1,
      align: 1,
      format: 0,
    });
    return res.end(JSON.stringify(print));
  }

  try {
    /* ===== GET ORDER ===== */
    const orderRes = await pool.query(
      `
      SELECT order_number, customer_name, table_number, type_order,
             created_at, subtotal, discount, tax, total, payment_method
      FROM orders
      WHERE id = $1
      `,
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
      return res.end(JSON.stringify(print));
    }

    const order = orderRes.rows[0];

    /* ===== GET ITEMS ===== */
    const itemsRes = await pool.query(
      `
      SELECT product_name, qty, subtotal
      FROM order_items
      WHERE order_id = $1
      `,
      [orderId]
    );

    /* ===== HEADER ===== */
    print.push(
      { type: 0, content: "SOTO IBUK SENOPATI", bold: 1, align: 1, format: 2 },
      { type: 0, content: "Jl. Tulodong Atas 1 No 3A", align: 1 },
      { type: 0, content: "Kebayoran Baru, Jakarta", align: 1 },
      { type: 0, content: "--------------------------------" }
    );

    /* ===== INFO ===== */
    print.push(
      { type: 0, content: `Order : ${order.order_number}` },
      {
        type: 0,
        content: `Tipe  : ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}`,
      },
      { type: 0, content: formatDate(order.created_at) },
      { type: 0, content: "--------------------------------" }
    );

    /* ===== ITEMS ===== */
    itemsRes.rows.forEach((item) => {
      const name = sanitizeText(item.product_name, 16).padEnd(16);
      const qty = `${item.qty}x`.padStart(4);
      const price = formatRupiah(item.subtotal).padStart(10);

      print.push({
        type: 0,
        content: `${name}${qty} ${price}`,
      });
    });

    /* ===== TOTAL ===== */
    print.push(
      { type: 0, content: "--------------------------------" },
      {
        type: 0,
        content: `Subtotal ${formatRupiah(order.subtotal)}`,
        align: 2,
      }
    );

    if (order.discount > 0) {
      print.push({
        type: 0,
        content: `Diskon   ${formatRupiah(order.discount)}`,
        align: 2,
      });
    }

    if (order.tax > 0) {
      print.push({
        type: 0,
        content: `Pajak    ${formatRupiah(order.tax)}`,
        align: 2,
      });
    }

    print.push(
      {
        type: 0,
        content: `TOTAL ${formatRupiah(order.total)}`,
        bold: 1,
        align: 2,
        format: 1,
      },
      { type: 0, content: `Metode: ${order.payment_method}` },
      { type: 0, content: " " },
      { type: 0, content: "Terima kasih 🙏", bold: 1, align: 1 },
      { type: 0, content: " " }
    );

    return res.end(JSON.stringify(print));
  } catch (err) {
    console.error("[PRINT ERROR]", err);

    return res.end(
      JSON.stringify([
        {
          type: 0,
          content: "GAGAL CETAK STRUK",
          bold: 1,
          align: 1,
          format: 0,
        },
      ])
    );
  }
});

export default router;
