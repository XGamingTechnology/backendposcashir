// middlewares/auth.js
import jwt from "jsonwebtoken";

/**
 * Middleware untuk memverifikasi JWT access token
 * Meng-set req.user jika token valid
 */
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("[AUTH] Unauthorized: Missing or invalid Authorization header");
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Bearer token required",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log("[AUTH] Token verified for user:", decoded.username);
    next();
  } catch (err) {
    let message = "Token expired or invalid";
    if (err.name === "TokenExpiredError") {
      message = "Token expired";
    } else if (err.name === "JsonWebTokenError") {
      message = "Invalid token";
    }

    console.error("[AUTH] Token verification failed:", err.message);
    return res.status(401).json({
      success: false,
      message: message,
    });
  }
};

/**
 * Middleware: Hanya admin
 */
export const onlyAdmin = (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Akses admin saja",
    });
  }

  next();
};

/**
 * Middleware: Admin atau kasir
 */
export const adminOrCashier = (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  if (!["admin", "cashier"].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak",
    });
  }

  next();
};
