import { Router } from "express";
import { pool } from "../config.js";

const router = Router();

/**
 * GET /api/print/receipt/:orderId
 * 📄 Endpoint khusus untuk Bluetooth Print App
 * HARUS mengembalikan JSON MURNI, tanpa header/cache
 */
router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;

  // Validasi UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orderId)) {
    return res.status(400).json([{ type: 0, content: "ID tidak valid", align: 1 }]);
  }

  try {
    // Ambil order
    const orderRes = await pool.query(
      `SELECT order_number, customer_name, table_number, type_order, created_at, subtotal, discount, tax, total, payment_method
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json([{ type: 0, content: "Order tidak ditemukan", align: 1 }]);
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

    // === Bangun JSON sesuai format Bluetooth Print App ===
    const output = [];

    // Header
    output.push({ type: 0, content: "SOTO IBUK SENOPATI", align: 1, bold: 1 });
    output.push({ type: 0, content: "Jl.Tulodong Atas 1 no 3A", align: 1 });
    output.push({ type: 0, content: "Kebayoran Baru, Jakarta Selatan", align: 1 });
    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Info order
    output.push({ type: 0, content: `Order: ${order.order_number}`, align: 0 });
    if (order.customer_name && order.customer_name !== "Customer Umum") {
      output.push({ type: 0, content: `Pelanggan: ${order.customer_name}`, align: 0 });
    }
    if (order.table_number) {
      output.push({ type: 0, content: `Meja: ${order.table_number}`, align: 0 });
    }
    const orderType = order.type_order === "dine_in" ? "Dine In" : "Takeaway";
    output.push({ type: 0, content: `Tipe: ${orderType}`, align: 0 });
    const dateStr = new Date(order.created_at).toLocaleString("id-ID");
    output.push({ type: 0, content: dateStr, align: 0 });
    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Items
    itemsRes.rows.forEach((item) => {
      const name = item.product_name.length > 20 ? item.product_name.substring(0, 20) : item.product_name;
      const qty = `${item.qty}x`;
      const price = `Rp ${item.subtotal.toLocaleString("id-ID")}`;
      // Susun dalam 1 baris: "Nasi Goreng    x2   Rp 40.000"
      const line = `${name.padEnd(18)}${qty.padStart(4)} ${price}`;
      output.push({ type: 0, content: line, align: 0 });
    });

    output.push({ type: 0, content: "------------------------------", align: 0 });

    // Rincian
    output.push({ type: 0, content: `Subtotal     Rp ${order.subtotal.toLocaleString("id-ID")}`, align: 0 });
    if (order.discount > 0) {
      output.push({ type: 0, content: `Diskon       Rp ${order.discount.toLocaleString("id-ID")}`, align: 0 });
    }
    if (order.tax > 0) {
      output.push({ type: 0, content: `Pajak        Rp ${order.tax.toLocaleString("id-ID")}`, align: 0 });
    }

    // Total (bold)
    output.push({ type: 0, content: `TOTAL        Rp ${order.total.toLocaleString("id-ID")}`, align: 0, bold: 1 });

    output.push({ type: 0, content: "------------------------------", align: 0 });
    output.push({ type: 0, content: `Metode: ${order.payment_method}`, align: 1 });
    output.push({ type: 0, content: "Terima kasih 🙏", align: 1, bold: 1 });

    // ❗️PENTING: Kirim JSON MURNI, tanpa wrapper
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(output));
  } catch (err) {
    console.error("PRINT RECEIPT ERROR:", err);
    res.status(500).json([{ type: 0, content: "Gagal memuat struk", align: 1 }]);
  }
});

export default router;
