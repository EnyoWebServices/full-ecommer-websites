import React, { useEffect } from 'react'
import "./css/orderSuccess.css"
import Header from '../components/Header/Header'
import { useNavigate, useSearchParams } from 'react-router-dom';
import useOrderStatus from '../hooks/useOrderStatus'
import { trackMetaPurchase } from '../utils/metaPixel'

const OrderSuccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams()
    const orderId = searchParams.get('orderId')
    const { order, error: orderLoadError } = useOrderStatus(orderId)

    useEffect(() => {
        trackMetaPurchase(order)
    }, [order])

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
                    {orderLoadError && <p role="alert">{orderLoadError}</p>}

                    <div className="delivery-box">
                        <p><strong>Estimated Delivery:</strong> 3–5 Business Days</p>
                        {orderId && <p><strong>Order ID:</strong> {orderId}</p>}
                        <p><strong>Payment Status:</strong> {['PAID', 'COMPLETED'].includes(paymentStatus) ? 'Paid' : paymentStatus === 'FAILED' ? 'Failed' : 'Pending store verification'}</p>
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
