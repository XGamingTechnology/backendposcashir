import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import productsRoutes from "./routes/products.js";
import ordersRoutes from "./routes/orders.js";
import usersRoutes from "./routes/users.js";
import authRoutes from "./routes/auth.js";

import adminUsersRouter from "./routes/admin/users.js";
import adminProductsRouter from "./routes/admin/products.js";

import reportsRouter from "./routes/admin/reports.js";
const app = express();

/* ================= MIDDLEWARE ================= */

// ⬅️ WAJIB: supaya cookie JWT bisa dibaca
app.use(cookieParser());

app.use(express.urlencoded({ extended: true })); // ← BARIS BARU

// ⬅️ WAJIB: allow cookie dari frontend
app.use(
  cors({
    origin: ["http://localhost:3000", "https://06ns6l3d-3000.asse.devtunnels.ms"],
  })
);

app.use(express.json());

/* ================= ROUTES ================= */

app.use("/api/auth", authRoutes); // login / logout
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/users", usersRoutes);

app.use("/api/admin/users", adminUsersRouter);
app.use("/api/admin/products", adminProductsRouter);
app.use("/api/admin/reports", reportsRouter);
/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.json({ status: "POS Backend Running 🚀" });
});

/* ================= SERVER ================= */

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
