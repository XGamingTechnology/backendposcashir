// backend/routes/print.js
import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/**
 * Sanitasi ketat thermal printer
 */
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
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * GET /api/print/receipt/:orderId
 * ⚠️ RESPONSE HARUS ARRAY JSON
 */
router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;

  console.log("[PRINT] Request:", orderId);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(orderId)) {
    return res.json([
      {
        type: 0,
        content: "ID TIDAK VALID",
        bold: 1,
        align: 1,
        format: 0,
      },
    ]);
  }

  try {
    // ===== ORDER =====
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order,
              created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return res.json([
        {
          type: 0,
          content: "ORDER TIDAK DITEMUKAN",
          bold: 1,
          align: 1,
          format: 0,
        },
      ]);
    }

    const order = orderRes.rows[0];

    // ===== ITEMS =====
    const itemsRes = await pool.query(
      `SELECT p.name AS product_name, oi.qty, oi.subtotal
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    // ===== BUILD RECEIPT =====
    const out = [];

    // HEADER
    out.push(
      {
        type: 0,
        content: "SOTO IBUK SENOPATI",
        bold: 1,
        align: 1,
        format: 2,
      },
      {
        type: 0,
        content: "Jl. Tulodong Atas 1 No 3A",
        bold: 0,
        align: 1,
        format: 0,
      },
      {
        type: 0,
        content: "Kebayoran Baru Jakarta",
        bold: 0,
        align: 1,
        format: 0,
      },
      {
        type: 0,
        content: "------------------------------",
        bold: 0,
        align: 0,
        format: 0,
      }
    );

    // INFO
    out.push(
      {
        type: 0,
        content: `Order : ${order.order_number}`,
        bold: 0,
        align: 0,
        format: 0,
      },
      order.customer_name && order.customer_name !== "-"
        ? {
            type: 0,
            content: `Pelanggan : ${sanitizeText(order.customer_name)}`,
            bold: 0,
            align: 0,
            format: 0,
          }
        : null,
      order.table_number
        ? {
            type: 0,
            content: `Meja : ${order.table_number}`,
            bold: 0,
            align: 0,
            format: 0,
          }
        : null,
      {
        type: 0,
        content: `Tipe : ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}`,
        bold: 0,
        align: 0,
        format: 0,
      },
      {
        type: 0,
        content: formatDate(order.created_at),
        bold: 0,
        align: 0,
        format: 0,
      },
      {
        type: 0,
        content: "------------------------------",
        bold: 0,
        align: 0,
        format: 0,
      }
    );

    // ITEMS
    if (itemsRes.rows.length === 0) {
      out.push({
        type: 0,
        content: "BELUM ADA ITEM",
        bold: 1,
        align: 1,
        format: 0,
      });
    } else {
      itemsRes.rows.forEach((item) => {
        const name = sanitizeText(item.product_name, 16).padEnd(16);
        const qty = `${item.qty}x`.padStart(4);
        const price = formatRupiah(item.subtotal);
        out.push({
          type: 0,
          content: `${name}${qty} ${price}`,
          bold: 0,
          align: 0,
          format: 0,
        });
      });
    }

    // TOTAL
    out.push(
      {
        type: 0,
        content: "------------------------------",
        bold: 0,
        align: 0,
        format: 0,
      },
      {
        type: 0,
        content: `Subtotal ${formatRupiah(order.subtotal)}`,
        bold: 0,
        align: 2,
        format: 0,
      },
      order.discount > 0
        ? {
            type: 0,
            content: `Diskon ${formatRupiah(order.discount)}`,
            bold: 0,
            align: 2,
            format: 0,
          }
        : null,
      order.tax > 0
        ? {
            type: 0,
            content: `Pajak ${formatRupiah(order.tax)}`,
            bold: 0,
            align: 2,
            format: 0,
          }
        : null,
      {
        type: 0,
        content: `TOTAL ${formatRupiah(order.total)}`,
        bold: 1,
        align: 2,
        format: 1,
      },
      {
        type: 0,
        content: `Metode: ${order.payment_method}`,
        bold: 0,
        align: 0,
        format: 0,
      },
      {
        type: 0,
        content: "Terima kasih",
        bold: 1,
        align: 1,
        format: 0,
      },
      {
        type: 0,
        content: " ",
        bold: 0,
        align: 0,
        format: 0,
      }
    );

    // FILTER NULL & SEND
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(out.filter(Boolean)));
  } catch (err) {
    console.error("[PRINT ERROR]", err);
    res.json([
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

export default router;
