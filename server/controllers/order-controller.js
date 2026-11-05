const Order = require("../models/order")
const User = require("../models/user")
const PaymentSettings = require("../models/paymentSettings")
const wrapAsync = require("../utils/wrapAsync")
const UPI_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,29}$/i
const {
    canAppendUpiPaymentEvent,
    validateTransactionReference,
    validateUpiEventPayload
} = require("../service/upiPaymentEvents")

//Place New Order
module.exports.order = wrapAsync(async (req, res) => {
    const { cartItems, totalPrice, addressId } = req.body
    const userId = req.user._id;
    const user = await User.findById(userId)
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." })
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0 || !Number.isFinite(Number(totalPrice))) {
        return res.status(400).json({ success: false, message: "Order items and a valid total price are required." })
    }
    const deliveryAddress = addressId
        ? user.addresses.id(addressId)
        : user.addresses.id(user.selectedAddressId)
    if (!deliveryAddress) {
        return res.status(400).json({ success: false, message: "Please add and select a delivery address before placing your order." })
    }
    const mobile = deliveryAddress.phone?.trim() || user.phone?.trim()
    if (!mobile) {
        return res.status(400).json({ success: false, message: "A mobile number is required for the delivery address." })
    }
    if (String(user.selectedAddressId) !== String(deliveryAddress._id)) {
        user.selectedAddressId = deliveryAddress._id
        await user.save()
    }
    const formattedItems = cartItems.map(item => ({
        productName: item.title.shortTitle,
        productImg: item.detailUrl,
        productId: item._id,
        quantity: item.quantity,
        price: item.price.cost,
    }))

    const userDetail = {
        name: user.name,
        email: user.email,
        mobile,
        address: {
            fullName: deliveryAddress.fullName,
            phone: deliveryAddress.phone,
            alternatePhone: deliveryAddress.alternatePhone,
            flat: deliveryAddress.flat,
            area: deliveryAddress.area,
            city: deliveryAddress.city,
            state: deliveryAddress.state,
            pincode: deliveryAddress.pincode,
            type: deliveryAddress.type
        }
    }

    const order = new Order({
        userId: userId,
        user: userDetail,
        items: formattedItems,
        totalPrice: totalPrice
    })

    const savedOrder = await order.save();

    res.status(200).json({ success: true, message: "order created successfully", orderId: savedOrder._id })
})


// Get all orders
module.exports.Allorders = wrapAsync(async (req, res) => {
    const { page, limit, search } = req.query;
    const currentPage = Number(page);
    const pageLimit = Number(limit);

    const skip = (currentPage - 1) * pageLimit;

    let filter = {};
    if (typeof search === "string" && search.trim()) {
        const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const searchRegex = new RegExp(escapedSearch, "i");
        filter = {
            $or: [
                { "user.name": searchRegex },
                { "user.email": searchRegex },
                { status: searchRegex }
            ]
        };
        if (/^[a-f\d]{24}$/i.test(search.trim())) filter.$or.push({ _id: search.trim() });
    }

    let query = Order.find(filter).sort({ createdAt: -1 });

    query = query.skip(skip).limit(pageLimit);
    const allOrders = await query;

    const totalOrders = await Order.countDocuments(filter);

    res.status(200).json({
        message: "Orders Are Fetched",
        allOrders,
        page,
        totalPages: Math.ceil(totalOrders / pageLimit),
        totalOrders
    })
})

// Get customer Orders
module.exports.CustomerOrders = wrapAsync(async (req, res) => {
    const id = req.user._id;
    const orders = await Order.find({ userId: id })
    res.status(200).json({ success: true, orders })
})

// Single Order
module.exports.SingleOrder = wrapAsync(async (req, res) => {
    const { id } = req.params
    const order = await Order.findOne({ _id: id, userId: req.user._id })
    if (!order) {
        return res.status(404).json({ success: false, message: "order not found" })
    }
    res.status(200).json({ success: true, order })
})

module.exports.startUpiPaymentRequest = wrapAsync(async (req, res) => {
    const { id } = req.params
    const { optionId, customUpiId } = req.body || {}
    const order = await Order.findOne({ _id: id, userId: req.user._id })
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." })
    }
    if (order.paymentDetails?.status === "PAID") {
        return res.status(409).json({ success: false, message: "This order is already paid." })
    }

    const existingRequest = order.upiPaymentRequest
    if (existingRequest?.status === "ACTIVE") {
        if (existingRequest.expiresAt > new Date()) {
            return res.status(200).json({ success: true, paymentRequest: existingRequest })
        }
        return res.status(409).json({ success: false, message: "The payment timer ended. Confirm whether the payment was completed before starting another request." })
    }
    if (existingRequest?.status === "AWAITING_REVIEW") {
        return res.status(409).json({ success: false, message: "Payment request is already with the store for review." })
    }
    if (!canAppendUpiPaymentEvent(order.upiPaymentEvents)) {
        return res.status(409).json({ success: false, message: "UPI payment activity history is full for this order." })
    }

    let selectedOption
    if (optionId) {
        const settings = await PaymentSettings.findOne({ key: "upi" })
        selectedOption = settings?.upiOptions.id(optionId)
        if (!selectedOption || !selectedOption.enabled) {
            return res.status(400).json({ success: false, message: "Choose an enabled UPI app." })
        }
    } else if (typeof customUpiId === "string" && UPI_ID_PATTERN.test(customUpiId.trim())) {
        selectedOption = { provider: "custom", label: "UPI app", upiId: customUpiId.trim().toLowerCase() }
    } else {
        return res.status(400).json({ success: false, message: "Choose a UPI app or enter a valid UPI ID." })
    }

    const requestedAt = new Date()
    const paymentRequest = {
        provider: selectedOption.provider,
        label: selectedOption.label,
        upiId: selectedOption.upiId,
        status: "ACTIVE",
        requestedAt,
        expiresAt: new Date(requestedAt.getTime() + 5 * 60 * 1000),
        placedAt: null
    }

    order.upiPaymentRequest = paymentRequest
    order.upiPaymentEvents.push({
        type: "REQUEST_CREATED",
        occurredAt: requestedAt,
        provider: paymentRequest.provider
    })
    order.paymentDetails.method = "UPI"
    order.paymentDetails.status = "PENDING"
    order.status = "PAYMENT_REQUESTED"
    await order.save()

    return res.status(201).json({ success: true, paymentRequest })
})

module.exports.recordUpiPaymentEvent = wrapAsync(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id })
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." })
    }
    if (!order.upiPaymentRequest?.requestedAt) {
        return res.status(400).json({ success: false, message: "This order has no UPI payment request." })
    }

    const result = validateUpiEventPayload(req.body)
    if (result.error) {
        return res.status(400).json({ success: false, message: result.error })
    }
    if (!canAppendUpiPaymentEvent(order.upiPaymentEvents)) {
        return res.status(409).json({ success: false, message: "UPI payment activity history is full for this order." })
    }

    order.upiPaymentEvents.push({
        ...result.value,
        callbackData: result.value.callbackData,
        provider: order.upiPaymentRequest.provider,
        userAgent: String(req.get("user-agent") || "").slice(0, 300),
        occurredAt: new Date()
    })
    await order.save()

    return res.status(201).json({ success: true })
})

module.exports.expireUpiPaymentRequest = wrapAsync(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id })
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." })
    }

    const paymentRequest = order.upiPaymentRequest
    if (!paymentRequest?.expiresAt) {
        return res.status(400).json({ success: false, message: "No UPI payment request exists for this order." })
    }
    const referenceResult = validateTransactionReference(req.body?.transactionReference)
    if (referenceResult.error) {
        return res.status(400).json({ success: false, message: referenceResult.error })
    }
    if (paymentRequest.status === "ACTIVE") {
        if (!canAppendUpiPaymentEvent(order.upiPaymentEvents)) {
            return res.status(409).json({ success: false, message: "UPI payment activity history is full for this order." })
        }
        paymentRequest.status = "AWAITING_REVIEW"
        paymentRequest.placedAt = new Date()
        paymentRequest.transactionReference = referenceResult.value
        order.upiPaymentEvents.push({
            type: "CUSTOMER_REPORTED_PAID",
            provider: paymentRequest.provider,
            transactionReference: referenceResult.value,
            userAgent: String(req.get("user-agent") || "").slice(0, 300),
            occurredAt: paymentRequest.placedAt
        })
        if (!["DELIVERED", "REJECTED", "PAYMENT_FAILED"].includes(order.status)) order.status = "PLACED"
        await order.save()
    }

    return res.status(200).json({
        success: true,
        orderId: order._id,
        orderStatus: order.status,
        paymentStatus: order.paymentDetails.status,
        paymentRequestStatus: paymentRequest.status
    })
})

module.exports.markUpiPaymentNotCompleted = wrapAsync(async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user._id })
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." })
    }

    const paymentRequest = order.upiPaymentRequest
    if (!paymentRequest?.expiresAt) {
        return res.status(400).json({ success: false, message: "No UPI payment request exists for this order." })
    }
    if (paymentRequest.status === "AWAITING_REVIEW" || paymentRequest.status === "CONFIRMED") {
        return res.status(409).json({ success: false, message: "This payment has already been submitted for verification." })
    }
    if (paymentRequest.status === "FAILED") {
        return res.status(200).json({ success: true, orderId: order._id, paymentRequestStatus: paymentRequest.status })
    }
    if (paymentRequest.status !== "ACTIVE") {
        return res.status(409).json({ success: false, message: "This UPI payment request is no longer active." })
    }
    if (!canAppendUpiPaymentEvent(order.upiPaymentEvents)) {
        return res.status(409).json({ success: false, message: "UPI payment activity history is full for this order." })
    }
    paymentRequest.status = "FAILED"
    order.paymentDetails.status = "FAILED"
    order.status = "PAYMENT_FAILED"
    order.upiPaymentEvents.push({
        type: "CUSTOMER_REPORTED_NOT_PAID",
        provider: paymentRequest.provider,
        userAgent: String(req.get("user-agent") || "").slice(0, 300),
        occurredAt: new Date()
    })
    await order.save()

    return res.status(200).json({
        success: true,
        orderId: order._id,
        orderStatus: order.status,
        paymentStatus: order.paymentDetails.status,
        paymentRequestStatus: paymentRequest.status
    })
})

// Update Order Status
module.exports.updateOrderStatus = wrapAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["DELIVERED", "REJECTED"];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const order = await Order.findByIdAndUpdate(
        id,
        { status },
        { new: true }
    );

    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.status(200).json({ success: true, message: "Order status updated", order });
})

module.exports.updatePaymentStatus = wrapAsync(async (req, res) => {
    const { status } = req.body || {}
    if (!["PAID", "FAILED"].includes(status)) {
        return res.status(400).json({ success: false, message: "Payment status must be PAID or FAILED." })
    }

    const order = await Order.findById(req.params.id)
    if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." })
    }
    if (!order.upiPaymentRequest?.requestedAt) {
        return res.status(400).json({ success: false, message: "This order has no UPI payment request." })
    }

    order.paymentDetails.status = status
    order.upiPaymentRequest.status = status === "PAID" ? "CONFIRMED" : "FAILED"
    if (!canAppendUpiPaymentEvent(order.upiPaymentEvents)) {
        return res.status(409).json({ success: false, message: "UPI payment activity history is full for this order." })
    }
    order.upiPaymentEvents.push({
        type: status === "PAID" ? "ADMIN_CONFIRMED" : "ADMIN_REJECTED",
        provider: order.upiPaymentRequest.provider,
        actorId: req.user._id,
        occurredAt: new Date()
    })
    if (status === "FAILED") order.status = "PAYMENT_FAILED"
    else if (order.status !== "DELIVERED") order.status = "PLACED"
    await order.save()

    return res.status(200).json({ success: true, message: "Payment status updated.", order })
})