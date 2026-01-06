// routes/orders.js
import express from "express";
import { pool } from "../config.js";
import { verifyToken } from "../middlewares/auth.js";
import { adminOrCashier, onlyAdmin } from "../middlewares/role.js";

const router = express.Router();
const TAX_RATE = 0.1; // 10%

// ✅ Daftar metode pembayaran valid
const VALID_PAYMENT_METHODS = ["cash", "debit", "credit", "qris", "transfer"];

/**
 * Helper: normalisasi metode pembayaran ke lowercase
 */
const normalizePaymentMethod = (method) => {
  if (typeof method !== "string") return null;
  const normalized = method.toLowerCase().trim();
  return VALID_PAYMENT_METHODS.includes(normalized) ? normalized : null;
};

/**
 * Helper: dapatkan user ID integer dari UUID
 */
const getUserIdByUuid = async (uuid) => {
  const result = await pool.query(`SELECT id FROM users WHERE uuid_id = $1`, [uuid]);
  if (result.rows.length === 0) throw new Error("User tidak ditemukan");
  return result.rows[0].id; // integer
};

/**
 * Helper: Sanitasi duplikat berdasarkan product_id
 */
function sanitizeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.product_id || typeof item.product_id !== "string" || item.qty <= 0) {
      throw new Error("Item tidak valid");
    }
    if (map.has(item.product_id)) {
      map.get(item.product_id).qty += item.qty;
    } else {
      map.set(item.product_id, { ...item });
    }
  }
  return Array.from(map.values());
}

/**
 * Helper: Hitung subtotal, discount, tax, total
 */
function calculatePayment(subtotal, discount = 0, includeTax = false) {
  const finalSubtotal = Math.max(0, subtotal - discount);
  const tax = includeTax ? Math.round(finalSubtotal * TAX_RATE) : 0;
  const total = finalSubtotal + tax;
  return { subtotal, discount, tax, total };
}

/**
 * Helper: Normalisasi order
 */
function normalizeOrder(order) {
  return {
    ...order,
    subtotal: order.subtotal ? parseFloat(order.subtotal) : 0,
    discount: order.discount ? parseFloat(order.discount) : 0,
    tax: order.tax ? parseFloat(order.tax) : 0,
    total: order.total ? parseFloat(order.total) : 0,
    cash_received: order.cash_received ? parseFloat(order.cash_received) : null,
    change_amount: order.change_amount ? parseFloat(order.change_amount) : null,
    // ✅ Normalisasi saat baca dari DB
    payment_method: order.payment_method ? normalizePaymentMethod(order.payment_method) : null,
  };
}

// === GET /api/orders ===
router.get("/", verifyToken, adminOrCashier, async (req, res) => {
  const { page = "1", limit = "10", search = "", customer = "", table = "", dateRange = "all" } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const offset = (pageNum - 1) * limitNum;

  try {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      const term = `%${search}%`;
      conditions.push(`(order_number ILIKE $${paramIndex} OR customer_name ILIKE $${paramIndex} OR table_number ILIKE $${paramIndex})`);
      params.push(term);
      paramIndex++;
    }

    if (customer) {
      conditions.push(`customer_name ILIKE $${paramIndex}`);
      params.push(`%${customer}%`);
      paramIndex++;
    }

    if (table) {
      conditions.push(`table_number ILIKE $${paramIndex}`);
      params.push(`%${table}%`);
      paramIndex++;
    }

    const { status: statusFilter } = req.query;
    if (statusFilter && ["DRAFT", "PAID", "CANCELED"].includes(statusFilter)) {
      conditions.push(`status = $${paramIndex}`);
      params.push(statusFilter);
      paramIndex++;
    }

    if (dateRange !== "all") {
      let dateCondition = "";
      const now = new Date();

      if (dateRange === "today") {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        dateCondition = `created_at >= $${paramIndex}`;
        params.push(start);
        paramIndex++;
      } else if (dateRange === "yesterday") {
        const start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        dateCondition = `created_at >= $${paramIndex} AND created_at < $${paramIndex + 1}`;
        params.push(start, end);
        paramIndex += 2;
      } else if (dateRange === "7days") {
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        dateCondition = `created_at >= $${paramIndex}`;
        params.push(start);
        paramIndex++;
      } else if (dateRange === "30days") {
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        dateCondition = `created_at >= $${paramIndex}`;
        params.push(start);
        paramIndex++;
      }

      if (dateCondition) {
        conditions.push(dateCondition);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const countQuery = `SELECT COUNT(*) FROM orders ${whereClause}`;
    const dataQuery = `
      SELECT
        id,
        order_number,
        cashier_id,
        customer_name,
        table_number,
        type_order,
        status,
        subtotal,
        discount,
        tax,
        total,
        cash_received,
        change_amount,
        created_at,
        updated_at,
        paid_at,
        payment_method
      FROM orders
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const dataParams = [...params, limitNum, offset];
    const dataResult = await pool.query(dataQuery, dataParams);

    const normalizedOrders = dataResult.rows.map(normalizeOrder);

    res.json({
      success: true,
      data: normalizedOrders,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error("GET ORDERS WITH PAGINATION ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil daftar order" });
  }
});

// === GET /api/orders/:id ===
router.get("/:id", verifyToken, adminOrCashier, async (req, res) => {
  const { id } = req.params;
  if (!id || id === "undefined" || id === "null" || id.trim() === "") {
    return res.status(400).json({ success: false, message: "ID order tidak valid" });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: "Format ID order tidak valid" });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT
        id,
        order_number,
        cashier_id,
        customer_name,
        table_number,
        type_order,
        status,
        subtotal,
        discount,
        tax,
        total,
        cash_received,
        change_amount,
        created_at,
        updated_at,
        paid_at,
        payment_method
      FROM orders
      WHERE id = $1
      `,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
    }

    const order = normalizeOrder(orderResult.rows[0]);

    const itemsResult = await pool.query(
      `
      SELECT 
        product_id,
        product_name,
        price,
        SUM(qty) as qty,
        SUM(subtotal) as subtotal
      FROM order_items
      WHERE order_id = $1
      GROUP BY product_id, product_name, price
      `,
      [id]
    );

    const normalizedItems = itemsResult.rows.map((item) => ({
      ...item,
      qty: parseInt(item.qty, 10),
      price: parseFloat(item.price),
      subtotal: parseFloat(item.subtotal),
    }));

    res.json({
      success: true,
      data: {
        ...order,
        items: normalizedItems,
      },
    });
  } catch (err) {
    console.error("GET ORDER BY ID ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil detail order" });
  }
});

// === POST /api/orders ===
router.post("/", verifyToken, adminOrCashier, async (req, res) => {
  const { customer_name, table_number, type_order, items } = req.body;

  const validTypes = ["dine_in", "takeaway"];
  const orderType = type_order || "dine_in";
  if (!validTypes.includes(orderType)) {
    return res.status(400).json({ success: false, message: "Tipe order tidak valid" });
  }

  const tableNum = table_number?.trim() || null;
  if (orderType === "dine_in" && (!tableNum || tableNum === "-")) {
    return res.status(400).json({ success: false, message: "Nomor meja wajib diisi untuk makan di tempat" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Order harus memiliki minimal 1 item" });
  }

  let sanitizedItems;
  try {
    sanitizedItems = sanitizeItems(items);
  } catch (err) {
    return res.status(400).json({ success: false, message: "Item tidak valid" });
  }

  try {
    const cashierId = await getUserIdByUuid(req.user.id);

    const productIds = sanitizedItems.map((item) => item.product_id);
    const productResult = await pool.query(`SELECT id, name, price FROM products WHERE id = ANY($1) AND active = true`, [productIds]);

    const productMap = new Map();
    for (const p of productResult.rows) {
      productMap.set(p.id, { name: p.name, price: p.price });
    }

    for (const item of sanitizedItems) {
      if (!productMap.has(item.product_id)) {
        return res.status(400).json({ success: false, message: `Produk tidak ditemukan: ${item.product_id}` });
      }
    }

    let orderSubtotal = 0;
    for (const item of sanitizedItems) {
      orderSubtotal += productMap.get(item.product_id).price * item.qty;
    }

    const { subtotal, discount, tax, total } = calculatePayment(orderSubtotal, 0, false);
    const orderNumber = `ORD-${Date.now()}`;

    const orderResult = await pool.query(
      `
      INSERT INTO orders (
        order_number, cashier_id, customer_name, table_number, type_order, status, subtotal, discount, tax, total, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING id, order_number, type_order, table_number, subtotal, discount, tax, total, created_at, updated_at
      `,
      [orderNumber, cashierId, customer_name || "-", tableNum, orderType, "DRAFT", subtotal, discount, tax, total]
    );

    const orderId = orderResult.rows[0].id;

    if (sanitizedItems.length > 0) {
      const values = sanitizedItems.map((item) => {
        const product = productMap.get(item.product_id);
        const itemSubtotal = product.price * item.qty;
        return [orderId, product.name, product.price, item.product_id, item.qty, itemSubtotal];
      });

      const placeholders = values.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`).join(", ");
      await pool.query(`INSERT INTO order_items (order_id, product_name, price, product_id, qty, subtotal) VALUES ${placeholders}`, values.flat());
    }

    console.log(`[ORDERS] Order created by ${req.user.username}: ${orderNumber} (Type: ${orderType})`);
    res.status(201).json({ success: true, message: "Order berhasil dibuat", data: orderResult.rows[0] });
  } catch (err) {
    console.error("CREATE ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal membuat order" });
  }
});

// === PUT /api/orders/:id ===
router.put("/:id", verifyToken, adminOrCashier, async (req, res) => {
  const { id } = req.params;
  const { customer_name, table_number, type_order, items } = req.body;

  const validTypes = ["dine_in", "takeaway"];
  const orderType = type_order || "dine_in";
  if (!validTypes.includes(orderType)) {
    return res.status(400).json({ success: false, message: "Tipe order tidak valid" });
  }

  const tableNum = table_number?.trim() || null;
  if (orderType === "dine_in" && (!tableNum || tableNum === "-")) {
    return res.status(400).json({ success: false, message: "Nomor meja wajib diisi untuk makan di tempat" });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Order harus memiliki minimal 1 item" });
  }

  let sanitizedItems;
  try {
    sanitizedItems = sanitizeItems(items);
  } catch (err) {
    return res.status(400).json({ success: false, message: "Item tidak valid" });
  }

  try {
    const orderCheck = await pool.query(`SELECT id, status FROM orders WHERE id = $1`, [id]);
    if (orderCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
    if (orderCheck.rows[0].status !== "DRAFT") return res.status(400).json({ success: false, message: "Order hanya bisa diedit dalam status DRAFT" });

    const cashierId = await getUserIdByUuid(req.user.id);

    const productIds = sanitizedItems.map((item) => item.product_id);
    const productResult = await pool.query(`SELECT id, name, price FROM products WHERE id = ANY($1) AND active = true`, [productIds]);

    const productMap = new Map();
    for (const p of productResult.rows) {
      productMap.set(p.id, { name: p.name, price: p.price });
    }

    for (const item of sanitizedItems) {
      if (!productMap.has(item.product_id)) {
        return res.status(400).json({ success: false, message: `Produk tidak ditemukan: ${item.product_id}` });
      }
    }

    let orderSubtotal = 0;
    for (const item of sanitizedItems) {
      orderSubtotal += productMap.get(item.product_id).price * item.qty;
    }

    const { subtotal, discount, tax, total } = calculatePayment(orderSubtotal, 0, false);

    await pool.query(
      `UPDATE orders
       SET 
         customer_name = $1, 
         table_number = $2, 
         type_order = $3,
         cashier_id = $4, 
         subtotal = $5, 
         discount = $6, 
         tax = $7, 
         total = $8, 
         updated_at = NOW()
       WHERE id = $9`,
      [customer_name || "-", tableNum, orderType, cashierId, subtotal, discount, tax, total, id]
    );

    await pool.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);

    if (sanitizedItems.length > 0) {
      const values = sanitizedItems.map((item) => {
        const product = productMap.get(item.product_id);
        const itemSubtotal = product.price * item.qty;
        return [id, product.name, product.price, item.product_id, item.qty, itemSubtotal];
      });

      const placeholders = values.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`).join(", ");
      await pool.query(`INSERT INTO order_items (order_id, product_name, price, product_id, qty, subtotal) VALUES ${placeholders}`, values.flat());
    }

    console.log(`[ORDERS] Order edited by ${req.user.username}: ${id} (Type: ${orderType})`);
    res.json({ success: true, message: "Order berhasil diperbarui" });
  } catch (err) {
    console.error("UPDATE ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui order" });
  }
});

// === POST /api/orders/:id/pay ===
router.post("/:id/pay", verifyToken, adminOrCashier, async (req, res) => {
  const { id } = req.params;
  const { paymentMethod, includeTax = false, discount = 0, cashReceived = null } = req.body;

  if (!paymentMethod) {
    return res.status(400).json({ success: false, message: "Metode pembayaran wajib diisi" });
  }

  // ✅ Normalisasi dan validasi
  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  if (!normalizedPaymentMethod) {
    return res.status(400).json({ success: false, message: "Metode pembayaran tidak didukung" });
  }

  const discountValue = typeof discount === "number" ? Math.max(0, discount) : 0;

  try {
    const orderCheck = await pool.query(`SELECT id, status, subtotal FROM orders WHERE id = $1`, [id]);
    if (orderCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
    if (orderCheck.rows[0].status !== "DRAFT") return res.status(400).json({ success: false, message: "Order ini sudah dibayar atau dibatalkan" });

    const subtotal = parseFloat(orderCheck.rows[0].subtotal);
    const { discount: finalDiscount, tax, total } = calculatePayment(subtotal, discountValue, includeTax);

    let cashReceivedValue = null;
    let changeAmountValue = null;

    if (normalizedPaymentMethod === "cash") {
      if (typeof cashReceived !== "number" || cashReceived < total) {
        return res.status(400).json({
          success: false,
          message: "Nominal uang cash tidak valid atau kurang dari total tagihan",
        });
      }
      cashReceivedValue = cashReceived;
      changeAmountValue = cashReceived - total;
    }

    await pool.query(
      `
      UPDATE orders 
      SET 
        status = 'PAID', 
        payment_method = $1, 
        discount = $2,
        tax = $3, 
        total = $4,
        cash_received = $5,
        change_amount = $6,
        paid_at = NOW(), 
        updated_at = NOW()
      WHERE id = $7
      `,
      [normalizedPaymentMethod, finalDiscount, tax, total, cashReceivedValue, changeAmountValue, id]
    );

    console.log(`[ORDERS] Order paid by ${req.user.username}: ${id} via ${normalizedPaymentMethod}`);
    res.json({ success: true, message: "Pembayaran berhasil" });
  } catch (err) {
    console.error("PAY ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal memproses pembayaran" });
  }
});

// === PATCH /api/orders/:id/status ===
router.patch("/:id/status", verifyToken, adminOrCashier, async (req, res) => {
  const { id } = req.params;
  const { status, paymentMethod } = req.body;

  const validStatus = ["DRAFT", "PAID", "CANCELED"];
  if (!validStatus.includes(status)) {
    return res.status(400).json({ success: false, message: "Status tidak valid" });
  }

  try {
    let normalizedPaymentMethod = null;
    if (status === "PAID" && paymentMethod) {
      normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
      if (!normalizedPaymentMethod) {
        return res.status(400).json({ success: false, message: "Metode pembayaran tidak valid" });
      }
    }

    const updateFields = ["status = $1", "updated_at = NOW()"];
    const params = [status, id];
    let paramIndex = 2;

    if (status === "PAID") {
      const order = await pool.query(`SELECT subtotal FROM orders WHERE id = $1`, [id]);
      if (order.rows.length > 0) {
        const subtotal = parseFloat(order.rows[0].subtotal);
        const { discount, tax, total } = calculatePayment(subtotal, 0, true);
        
        updateFields.push(`discount = $${paramIndex++}`);
        params.splice(params.length - 1, 0, discount);

        updateFields.push(`tax = $${paramIndex++}`);
        params.splice(params.length - 1, 0, tax);

        updateFields.push(`total = $${paramIndex++}`);
        params.splice(params.length - 1, 0, total);

        updateFields.push(`paid_at = NOW()`);
        
        if (normalizedPaymentMethod) {
          updateFields.push(`payment_method = $${paramIndex++}`);
          params.splice(params.length - 1, 0, normalizedPaymentMethod);
        }
      }
    }

    const query = `UPDATE orders SET ${updateFields.join(", ")} WHERE id = $${paramIndex}`;
    const result = await pool.query(query, params);

    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });

    console.log(`[ORDERS] Status updated: order ${id} → ${status}`);
    res.json({ success: true, message: "Status order berhasil diubah" });
  } catch (err) {
    console.error("UPDATE ORDER STATUS ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengubah status order" });
  }
});

// === GET /api/orders/:id/public ===
router.get("/:id/public", async (req, res) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: "Format ID order tidak valid" });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT
        id,
        order_number,
        customer_name,
        table_number,
        type_order,
        status,
        subtotal,
        discount,
        tax,
        total,
        cash_received,
        change_amount,
        created_at,
        payment_method
      FROM orders
      WHERE id = $1 AND status = 'PAID'
      `,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order tidak ditemukan atau belum dibayar" });
    }

    const order = normalizeOrder(orderResult.rows[0]);

    const itemsResult = await pool.query(
      `
      SELECT 
        product_name,
        SUM(qty) as qty,
        SUM(subtotal) as subtotal
      FROM order_items
      WHERE order_id = $1
      GROUP BY product_name
      `,
      [id]
    );

    const normalizedItems = itemsResult.rows.map((item) => ({
      product_name: item.product_name,
      qty: parseInt(item.qty, 10),
      subtotal: parseFloat(item.subtotal),
    }));

    res.json({
      success: true,
      data: {
        ...order,
        items: normalizedItems,
      },
    });
  } catch (err) {
    console.error("GET PUBLIC ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data struk" });
  }
});

// === POST /api/orders/:id/cancel ===
router.post("/:id/cancel", verifyToken, adminOrCashier, async (req, res) => {
  const { id } = req.params;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: "Format ID order tidak valid" });
  }

  try {
    const orderCheck = await pool.query(`SELECT id, status FROM orders WHERE id = $1`, [id]);

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Order tidak ditemukan" });
    }

    const currentStatus = orderCheck.rows[0].status;
    if (currentStatus !== "DRAFT") {
      return res.status(400).json({
        success: false,
        message: "Order hanya bisa dibatalkan dalam status DRAFT",
      });
    }

    await pool.query(
      `UPDATE orders 
       SET status = 'CANCELED', updated_at = NOW() 
       WHERE id = $1`,
      [id]
    );

    console.log(`[ORDERS] Order canceled by ${req.user.username}: ${id}`);
    res.json({ success: true, message: "Order berhasil dibatalkan" });
  } catch (err) {
    console.error("CANCEL ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal membatalkan order" });
  }
});

// === DELETE /api/orders/:id ===
router.delete("/:id", verifyToken, onlyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);
    const result = await pool.query(`DELETE FROM orders WHERE id = $1`, [id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Order tidak ditemukan" });

    console.log(`[ORDERS] Order deleted: ${id}`);
    res.json({ success: true, message: "Order berhasil dihapus" });
  } catch (err) {
    console.error("DELETE ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Gagal menghapus order" });
  }
});

export default router;
