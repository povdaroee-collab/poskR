// File: routes/mainRoutes.js
const express = require("express");
const router = express.Router();
// ទាញយក db និង admin ពី file config ដែលយើងទើបតែជួសជុល
const { db, admin } = require("../firebase-config");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const moment = require("moment");

// ==========================================
// 1. MIDDLEWARE
// ==========================================

const checkAuth = (req, res, next) => {
  const user = req.cookies.user_data;
  if (!user) {
    return res.redirect("/login");
  }
  res.locals.user = user;
  next();
};

const checkOwner = (req, res, next) => {
  const user = req.cookies.user_data;
  if (user && user.role === "owner") {
    next();
  } else {
    if (user) return res.redirect("/pos");
    res.redirect("/login");
  }
};

// ==========================================
// 2. AUTHENTICATION
// ==========================================

router.get("/login", (req, res) => {
  if (req.cookies.user_data) return res.redirect("/");
  res.render("login");
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // A. Login ជា Owner (កូដ hardcode ឬ env)
    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPass = process.env.OWNER_SECRET_CODE;

    if (email === ownerEmail && password === ownerPass) {
      const userData = { email, role: "owner", name: "ម្ចាស់ហាង (Owner)" };
      res.cookie("user_data", userData, { httpOnly: true, maxAge: 86400000 });
      return res.json({ success: true, redirectUrl: "/" });
    }

    // B. Login ជា Staff (Database)
    // ចំណាំ៖ ត្រូវប្រាកដថា user collection មានក្នុង database
    const snapshot = await db
      .collection("users")
      .where("email", "==", email)
      .where("password", "==", password)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const userDoc = snapshot.docs[0].data();
      const userData = {
        email: userDoc.email,
        role: "sale",
        name: userDoc.name || "Staff",
      };
      res.cookie("user_data", userData, { httpOnly: true, maxAge: 86400000 });
      return res.json({ success: true, redirectUrl: "/pos" });
    }

    return res
      .status(401)
      .json({ success: false, message: "អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ!" });
  } catch (error) {
    console.error("Login Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server Error: " + error.message });
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("user_data");
  res.redirect("/login");
});

// ==========================================
// 3. DASHBOARD (OWNER)
// ==========================================

router.get("/", checkAuth, checkOwner, async (req, res) => {
  try {
    // 1. Products
    const productsSnap = await db
      .collection("products")
      .orderBy("createdAt", "desc")
      .get();
    const products = productsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 2. Recent Sales
    const salesSnap = await db
      .collection("sales")
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();
    const recentSales = salesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // 3. Total Revenue Calculation (Optimized)
    let totalRevenue = 0;
    // ប្រសិនបើ Sales ច្រើនពេក ការហៅ .get() ទាំងអស់នឹងយឺត។
    // សម្រាប់ Project តូច អាចប្រើវិធីនេះបាន៖
    const allSalesSnap = await db.collection("sales").get();
    allSalesSnap.forEach((doc) => {
      const sale = doc.data();
      totalRevenue += parseFloat(sale.total) || 0;
    });

    res.render("dashboard", {
      products,
      recentSales,
      totalRevenue: totalRevenue.toFixed(2),
      productCount: products.length,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).send("Error loading dashboard: " + error.message);
  }
});

router.post("/product/add", checkAuth, checkOwner, async (req, res) => {
  try {
    const { name, price, stock, barcode, category } = req.body;
    await db.collection("products").add({
      name,
      price: parseFloat(price),
      stock: parseInt(stock),
      barcode,
      category,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error adding product");
  }
});

router.get("/product/delete/:id", checkAuth, checkOwner, async (req, res) => {
  try {
    await db.collection("products").doc(req.params.id).delete();
    res.redirect("/");
  } catch (error) {
    res.status(500).send("Error deleting product");
  }
});

// ==========================================
// 4. POS SYSTEM
// ==========================================

router.get("/pos", checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection("products").orderBy("name").get();
    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.render("pos", { products });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading POS");
  }
});

router.post("/checkout", checkAuth, async (req, res) => {
  const { cartItems, totalAmount, paymentMethod } = req.body;

  // Validation
  if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No items in cart" });
  }

  const batch = db.batch();

  try {
    // 1. Create Sale Record
    const saleRef = db.collection("sales").doc();
    batch.set(saleRef, {
      items: cartItems,
      total: parseFloat(totalAmount),
      paymentMethod: paymentMethod || "Cash",
      cashier: req.cookies.user_data.email,
      cashierName: req.cookies.user_data.name,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateString: moment().format("YYYY-MM-DD HH:mm:ss"),
    });

    // 2. Decrement Stock
    cartItems.forEach((item) => {
      if (item.id) {
        const productRef = db.collection("products").doc(item.id);
        batch.update(productRef, {
          stock: admin.firestore.FieldValue.increment(-parseInt(item.qty)),
        });
      }
    });

    // 3. Commit Transaction
    await batch.commit();

    res.json({
      success: true,
      message: "Payment Successful!",
      orderId: saleRef.id,
    });
  } catch (error) {
    console.error("Checkout Error:", error);
    res.status(500).json({
      success: false,
      message: "Transaction Failed: " + error.message,
    });
  }
});

// ==========================================
// 5. REPORTS
// ==========================================

router.get("/export/excel", checkAuth, checkOwner, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sales Data");

    worksheet.columns = [
      { header: "Order ID", key: "id", width: 25 },
      { header: "Date", key: "date", width: 20 },
      { header: "Cashier", key: "cashier", width: 20 },
      { header: "Total ($)", key: "total", width: 15 },
      { header: "Payment", key: "method", width: 15 },
    ];

    const sales = await db
      .collection("sales")
      .orderBy("createdAt", "desc")
      .get();
    sales.forEach((doc) => {
      const data = doc.data();
      worksheet.addRow({
        id: doc.id,
        date: data.dateString,
        cashier: data.cashierName || data.cashier,
        total: data.total,
        method: data.paymentMethod,
      });
    });

    // Header Styling
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Sales_Report.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error exporting Excel");
  }
});

router.get("/export/pdf", checkAuth, checkOwner, async (req, res) => {
  try {
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Sales_Report.pdf",
    );

    doc.pipe(res);

    doc
      .fillColor("#2563EB")
      .fontSize(20)
      .text("POS SALES REPORT", { align: "center" });
    doc.moveDown();
    doc
      .fillColor("#000000")
      .fontSize(10)
      .text(`Generated: ${moment().format("DD/MM/YYYY HH:mm")}`, {
        align: "right",
      });
    doc.moveDown();

    const tableTop = 150;
    const itemCodeX = 50,
      dateX = 200,
      priceX = 400;

    doc.font("Helvetica-Bold");
    doc.text("Order ID", itemCodeX, tableTop);
    doc.text("Date", dateX, tableTop);
    doc.text("Total", priceX, tableTop, { align: "right" });
    doc
      .moveTo(itemCodeX, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    const sales = await db
      .collection("sales")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    let y = tableTop + 30;

    doc.font("Helvetica");
    sales.forEach((snap) => {
      const data = snap.data();
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(snap.id.substring(0, 8) + "...", itemCodeX, y);
      doc.text(data.dateString || "-", dateX, y);
      doc.text(`$${parseFloat(data.total).toFixed(2)}`, priceX, y, {
        align: "right",
      });
      y += 20;
    });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Error exporting PDF");
  }
});

module.exports = router;
