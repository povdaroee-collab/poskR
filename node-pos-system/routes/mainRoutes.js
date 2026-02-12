const express = require("express");
const router = express.Router();
const { db } = require("../firebase-config");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

// Middleware ត្រួតពិនិត្យការ Login (សន្មតថាអ្នកបានធ្វើ Login Logic ហើយ)
const checkAuth = (req, res, next) => {
  // នេះគ្រាន់តែជាឧទាហរណ៍សាមញ្ញ។ ជាក់ស្តែងត្រូវប្រើ JWT ឬ Session
  // សន្មតថាមាន cookie ឈ្មោះ user_role
  const role = req.cookies.user_role;
  if (!role) return res.redirect("/login");
  next();
};

const checkOwner = (req, res, next) => {
  if (req.cookies.user_role !== "owner")
    return res.status(403).send("គ្មានសិទ្ធិទេ");
  next();
};

// 1. Dashboard (សម្រាប់ Owner និង Admin)
router.get("/", checkAuth, (req, res) => {
  res.render("dashboard", { role: req.cookies.user_role });
});

// 2. POS Interface (សម្រាប់ Sale)
router.get("/pos", checkAuth, (req, res) => {
  res.render("pos");
});

// 3. Export Excel (Report)
router.get("/export/sales-excel", checkOwner, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sales Data");

  worksheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Date", key: "date", width: 20 },
    { header: "Total", key: "total", width: 15 },
  ];

  // ទាញទិន្នន័យពី Firebase
  const snapshot = await db.collection("sales").get();
  snapshot.forEach((doc) => {
    worksheet.addRow({ id: doc.id, ...doc.data() });
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=" + "Sales_Report.xlsx",
  );

  await workbook.xlsx.write(res);
  res.end();
});

// 4. Export PDF (Report)
router.get("/export/sales-pdf", checkOwner, async (req, res) => {
  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=Sales_Report.pdf");

  doc.pipe(res);

  doc.fontSize(25).text("POS Sales Report", { align: "center" });
  doc.moveDown();

  // Logic ទាញទិន្នន័យពី DB មក Loop បញ្ចូលក្នុង PDF
  const snapshot = await db.collection("sales").get();
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    doc.fontSize(12).text(`Order ID: ${docSnap.id} - Total: $${data.total}`);
  });

  doc.end();
});

module.exports = router;
