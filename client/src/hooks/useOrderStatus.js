import { useEffect, useState } from "react"
import { SingleOrderApi } from "../service/Api"

const ORDER_STATUS_POLL_INTERVAL_MS = 30 * 1000

const shouldPollOrderStatus = (order) => {
    const paymentStatus = String(order?.paymentDetails?.status || "").toUpperCase()
    const requestStatus = String(order?.upiPaymentRequest?.status || "").toUpperCase()
    return order?.paymentDetails?.method === "UPI" &&
        !["PAID", "COMPLETED", "FAILED"].includes(paymentStatus) &&
        order?.status !== "PAYMENT_FAILED" &&
        ["ACTIVE", "AWAITING_REVIEW", "CONFIRMED"].includes(requestStatus)
}

const useOrderStatus = (orderId) => {
    const [order, setOrder] = useState(null)
    const [error, setError] = useState("")
    const [reloadCount, setReloadCount] = useState(0)

    useEffect(() => {
        if (!orderId) {
            setOrder(null)
            setError("Order ID is missing, so its payment status cannot be checked.")
            return undefined
        }

        let cancelled = false
        let requestInFlight = false
        let shouldPoll = true

        const loadOrder = async () => {
            if (cancelled || requestInFlight || !shouldPoll) return
            requestInFlight = true
            try {
                const loadedOrder = await SingleOrderApi(orderId)
                if (cancelled) return
                setOrder(loadedOrder)
                setError("")
                shouldPoll = shouldPollOrderStatus(loadedOrder)
            } catch (loadError) {
                if (cancelled) return
                console.error("Could not load order status.", loadError)
                setError(loadError.response?.data?.message || "Could not load order details. Please try again.")
            } finally {
                requestInFlight = false
            }
        }

        void loadOrder()
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void loadOrder()
        }, ORDER_STATUS_POLL_INTERVAL_MS)

        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [orderId, reloadCount])

    return {
        order,
        error,
        retry: () => setReloadCount(count => count + 1)
    }
}

export default useOrderStatus
