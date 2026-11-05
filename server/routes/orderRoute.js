const express = require("express")
const router = express.Router();
const { order, Allorders, CustomerOrders, SingleOrder, startUpiPaymentRequest, recordUpiPaymentEvent, expireUpiPaymentRequest, markUpiPaymentNotCompleted, updateOrderStatus, updatePaymentStatus } = require("../controllers/order-controller.js");
const auth = require("../middlewares/auth.js");
const adminAuth = require("../middlewares/adminAuth.js");

//New Order
router.post("/order", auth, order)

//All Order
router.get("/allorders", adminAuth, Allorders)

//Single Order
router.get("/singleOrder/:id", auth, SingleOrder)

//Customer Order
router.get("/customerorders", auth, CustomerOrders)

router.post("/order/:id/upi-payment-request", auth, startUpiPaymentRequest)
router.post("/order/:id/upi-payment-events", auth, recordUpiPaymentEvent)
router.post("/order/:id/upi-payment-expired", auth, expireUpiPaymentRequest)
router.post("/order/:id/upi-payment-not-completed", auth, markUpiPaymentNotCompleted)

//Update Order Status (Admin)
router.patch("/order/:id/status", adminAuth, updateOrderStatus)
router.patch("/admin/orders/:id/payment-status", adminAuth, updatePaymentStatus)

module.exports = router