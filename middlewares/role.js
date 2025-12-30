/**
 * ===========================
 * ROLE MIDDLEWARE
 * ===========================
 * Bergantung pada:
 * - verifyToken → set req.user
 * Role:
 * - admin
 * - cashier
 */

export const onlyAdmin = (req, res, next) => {
  // ⛔ belum login / token tidak valid
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // ⛔ bukan admin
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Akses admin saja" });
  }

  next();
};

export const adminOrCashier = (req, res, next) => {
  // ⛔ belum login / token tidak valid
  if (!req.user || !req.user.role) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // ⛔ role tidak sesuai
  if (!["admin", "cashier"].includes(req.user.role)) {
    return res.status(403).json({ message: "Akses ditolak" });
  }

  next();
};
