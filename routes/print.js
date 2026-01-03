router.get("/receipt/:orderId", async (req, res) => {
  const { orderId } = req.params;
  console.log("[PRINT]", orderId);

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /** ⬇️ ROOT HARUS ARRAY */
  const print = [];

  if (!uuid.test(orderId)) {
    print.push({
      type: 0,
      content: "ID TIDAK VALID",
      bold: 1,
      align: 1,
      format: 0,
    });
    return res.end(JSON.stringify(print));
  }

  try {
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
      return res.end(JSON.stringify(print));
    }

    const order = orderRes.rows[0];

    const itemsRes = await pool.query(
      `SELECT product_name, qty, subtotal
         FROM order_items
         WHERE order_id = $1`,
      [orderId]
    );

    /* ===== HEADER ===== */
    print.push(
      { type: 0, content: "SOTO IBUK SENOPATI", bold: 1, align: 1, format: 2 },
      { type: 0, content: "Jl. Tulodong Atas 1 No 3A", align: 1 },
      { type: 0, content: "Kebayoran Baru Jakarta", align: 1 },
      { type: 0, content: "------------------------------" }
    );

    /* ===== INFO ===== */
    print.push(
      { type: 0, content: `Order : ${order.order_number}` },
      { type: 0, content: `Tipe  : ${order.type_order === "dine_in" ? "Dine In" : "Takeaway"}` },
      { type: 0, content: formatDate(order.created_at) },
      { type: 0, content: "------------------------------" }
    );

    /* ===== ITEMS ===== */
    itemsRes.rows.forEach((i) => {
      const name = sanitizeText(i.product_name, 16).padEnd(16);
      const qty = `${i.qty}x`.padStart(4);
      print.push({
        type: 0,
        content: `${name}${qty} ${formatRupiah(i.subtotal)}`,
      });
    });

    /* ===== TOTAL ===== */
    print.push(
      { type: 0, content: "------------------------------" },
      { type: 0, content: `Subtotal ${formatRupiah(order.subtotal)}`, align: 2 },
      { type: 0, content: `TOTAL ${formatRupiah(order.total)}`, bold: 1, align: 2, format: 1 },
      { type: 0, content: `Metode: ${order.payment_method}` },
      { type: 0, content: "Terima kasih", bold: 1, align: 1 },
      { type: 0, content: " " }
    );

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(print));
  } catch (err) {
    console.error("[PRINT ERROR]", err);
    res.end(
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
