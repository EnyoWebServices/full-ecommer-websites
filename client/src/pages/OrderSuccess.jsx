import React, { useEffect, useState } from 'react'
import "./css/orderSuccess.css"
import Header from '../components/Header/Header'
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SingleOrderApi } from '../service/Api'

const OrderSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams()
    const orderId = searchParams.get('orderId')
    const [order, setOrder] = useState(null)

    useEffect(() => {
        if (!orderId) return
        let cancelled = false
        SingleOrderApi(orderId).then(savedOrder => {
            if (!cancelled) setOrder(savedOrder)
        }).catch(() => {})
        return () => { cancelled = true }
    }, [orderId])

    useEffect(() => {
        const paymentStatus = String(order?.paymentDetails?.status || '').toUpperCase()
        const value = Number(order?.totalPrice)
        if (!orderId || !['PAID', 'COMPLETED'].includes(paymentStatus) || !Number.isFinite(value) || value <= 0 || typeof window.fbq !== 'function') {
            return
        }

        const storageKey = `meta-purchase-tracked-${orderId}`
        try {
            if (window.localStorage.getItem(storageKey)) return
        } catch (error) {
            console.error('Could not check whether the Meta Purchase event was already sent.', error)
            return
        }

        window.fbq('track', 'Purchase', {
            value,
            currency: 'INR',
            order_id: orderId,
            content_type: 'product',
            content_ids: order.items.map(item => String(item.productId)),
            contents: order.items.map(item => ({
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
    }, [order, orderId])

    const paymentStatus = order?.paymentDetails?.status || 'PENDING'
    const failed = order?.status === 'PAYMENT_FAILED' || paymentStatus === 'FAILED'
    return (
        <>
            <Header />
            <div className="success-wrapper">
                <div className="success-card">
                    <div className="success-icon">
                        <img src="https://cdn-icons-png.flaticon.com/512/3081/3081648.png" alt="" />
                    </div>

                    <h1 className="success-title">{failed ? 'Payment needs attention' : 'Your order has been placed'}</h1>
                    <p className="success-subtitle">
                        {failed ? 'The store could not verify this UPI payment. Check My Orders for the latest status.' : 'Your order is in My Orders, where you can track its status.'}
                    </p>

                    <div className="delivery-box">
                        <p><strong>Estimated Delivery:</strong> 3–5 Business Days</p>
                        {orderId && <p><strong>Order ID:</strong> {orderId}</p>}
                        <p><strong>Payment Status:</strong> {paymentStatus === 'PAID' ? 'Paid' : paymentStatus === 'FAILED' ? 'Failed' : 'Pending store verification'}</p>
                    </div>

                    <div className="success-buttons">
                        <button
                            className="orders-btn"
                            onClick={() => navigate("/my-orders")}
                        >
                            Go to My Orders
                        </button>

                        <button
                            className="shop-btn"
                            onClick={() => navigate("/")}
                        >
                            Continue Shopping
                        </button>
                    </div>

                </div>
            </div>
        </>
    )
}

export default OrderSuccess
