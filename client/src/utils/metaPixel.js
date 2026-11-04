export const trackMetaPurchase = (order) => {
    const paymentStatus = String(order?.paymentDetails?.status || '').toUpperCase()
    const value = Number(order?.totalPrice)
    const orderId = order?._id ? String(order._id) : ''
    const items = Array.isArray(order?.items) ? order.items : []

    if (
        !orderId ||
        !['PAID', 'COMPLETED'].includes(paymentStatus) ||
        !Number.isFinite(value) ||
        value <= 0 ||
        typeof window.fbq !== 'function'
    ) {
        return false
    }

    const storageKey = `meta-purchase-tracked-${orderId}`
    try {
        if (window.localStorage.getItem(storageKey)) return false
    } catch (error) {
        console.error('Could not check whether the Meta Purchase event was already sent.', error)
    }

    window.fbq('track', 'Purchase', {
        value,
        currency: 'INR',
        order_id: orderId,
        content_type: 'product',
        content_ids: items.map(item => String(item.productId)),
        contents: items.map(item => ({
            id: String(item.productId),
            quantity: item.quantity,
            item_price: item.price
        }))
    })

    try {
        window.localStorage.setItem(storageKey, 'true')
    } catch (error) {
        console.error('Could not save Meta Purchase event deduplication state.', error)
    }

    return true
}
