import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import {
    ArrowLeft,
    Banknote,
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    CircleHelp,
    Clock3,
    CreditCard,
    ExternalLink,
    Gift,
    LockKeyhole,
    Plus,
    Smile
} from 'lucide-react'
import toast from 'react-hot-toast'
import { expireUpiPaymentRequest, fetchUpiOptions, markUpiPaymentNotCompleted, recordUpiPaymentEvent, SingleOrderApi, startUpiPaymentRequest, toPaymentGateway } from '../service/Api'
import { useAppBack } from '../hooks/useAppBack'
import './css/Payment.css'

const UPI_CALLBACK_KEYS = new Set([
    'status',
    'txnid',
    'transactionid',
    'txnref',
    'transactionref',
    'approvalrefno',
    'responsecode',
    'responsemessage',
    'txnstatus',
    'transactionstatus',
    'amount',
    'currency'
])

const readUpiCallbackData = () => {
    const callbackData = {}
    const hash = window.location.hash
    const hashQuery = hash.includes('?')
        ? hash.slice(hash.indexOf('?') + 1)
        : hash.slice(1).includes('=')
            ? hash.slice(1)
            : ''
    const sources = [window.location.search, hashQuery]
    for (const source of sources) {
        const params = new URLSearchParams(source)
        for (const [key, value] of params) {
            const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
            if (UPI_CALLBACK_KEYS.has(normalizedKey) && value.trim()) {
                callbackData[key] = value.slice(0, 256)
            }
        }
    }
    return callbackData
}

const readStoredAmount = () => {
    try {
        return JSON.parse(sessionStorage.getItem('pendingPaymentAmount') || '{}')
    } catch {
        return {}
    }
}

const Payment = () => {
    const { id } = useParams()
    const navigate = useNavigate()
    const goBack = useAppBack(`/checkout/${id}/summary`)
    const location = useLocation()
    const { authenticated } = useSelector(state => state.user)
    const [expandedMethod, setExpandedMethod] = useState('')
    const [amountExpanded, setAmountExpanded] = useState(false)
    const [loadingPayment, setLoadingPayment] = useState(false)
    const [selectedUpi, setSelectedUpi] = useState('')
    const [upiId, setUpiId] = useState('')
    const [showUpiHelp, setShowUpiHelp] = useState(false)
    const [upiOptions, setUpiOptions] = useState([])
    const [loadingUpiOptions, setLoadingUpiOptions] = useState(false)
    const [upiOptionsError, setUpiOptionsError] = useState('')
    const [activePaymentRequest, setActivePaymentRequest] = useState(null)
    const [remainingSeconds, setRemainingSeconds] = useState(300)
    const [resolvingPayment, setResolvingPayment] = useState(false)
    const [showOrderPlaced, setShowOrderPlaced] = useState(false)
    const [transactionReference, setTransactionReference] = useState('')
    const expiryRequestInFlight = useRef(false)
    const upiIntentState = useRef({ active: false, hidden: false, launchedAt: 0 })
    const orderId = location.state?.orderId || sessionStorage.getItem('pendingPaymentOrderId')
    const storedAmount = readStoredAmount()
    const totalCost = Number(location.state?.totalCost ?? storedAmount.totalCost ?? 0)
    const totalMrp = Number(location.state?.totalMrp ?? storedAmount.totalMrp ?? totalCost)
    const savings = Math.max(totalMrp - totalCost, 0)

    useEffect(() => {
        if (!authenticated) {
            navigate(`/product/${id}`, { replace: true })
        } else if (!orderId) {
            toast.error('Please continue from Order Summary')
            navigate(`/checkout/${id}/summary`, { replace: true })
        }
    }, [authenticated, id, navigate, orderId])

    useEffect(() => {
        if (!authenticated || !orderId) return undefined
        let cancelled = false
        setLoadingUpiOptions(true)
        fetchUpiOptions()
            .then(options => {
                if (!cancelled) setUpiOptions(options)
            })
            .catch(error => {
                if (!cancelled) setUpiOptionsError(error.response?.data?.message || 'UPI options could not be loaded')
            })
            .finally(() => {
                if (!cancelled) setLoadingUpiOptions(false)
            })
        return () => { cancelled = true }
    }, [authenticated, orderId])

    useEffect(() => {
        if (!authenticated || !orderId) return undefined
        let cancelled = false
        SingleOrderApi(orderId).then(async order => {
            if (cancelled) return
            const request = order.upiPaymentRequest
            if (request?.status === 'ACTIVE' && request.expiresAt) {
                setActivePaymentRequest(request)
            } else if (['AWAITING_REVIEW', 'CONFIRMED'].includes(request?.status)) {
                navigate(`/order-success?orderId=${orderId}`, { replace: true })
            }
        }).catch(error => {
            if (!cancelled) toast.error(error.response?.data?.message || 'Could not load the order payment status')
        })
        return () => { cancelled = true }
    }, [authenticated, navigate, orderId])

    useEffect(() => {
        if (!activePaymentRequest?.expiresAt) return undefined
        const updateCountdown = () => {
            const seconds = Math.max(0, Math.ceil((new Date(activePaymentRequest.expiresAt).getTime() - Date.now()) / 1000))
            setRemainingSeconds(seconds)
        }
        updateCountdown()
        const interval = window.setInterval(updateCountdown, 1000)
        document.addEventListener('visibilitychange', updateCountdown)
        window.addEventListener('pageshow', updateCountdown)
        return () => {
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', updateCountdown)
            window.removeEventListener('pageshow', updateCountdown)
        }
    }, [activePaymentRequest?.expiresAt])

    useEffect(() => {
        const recordAppReturn = () => {
            const intent = upiIntentState.current
            if (document.visibilityState === 'hidden') {
                if (intent.active) intent.hidden = true
                return
            }
            let storedIntent
            try {
                storedIntent = JSON.parse(sessionStorage.getItem('pendingUpiIntent') || 'null')
            } catch {
                storedIntent = null
            }
            const storedIntentIsCurrent = storedIntent?.orderId === orderId
                && Number.isFinite(storedIntent.launchedAt)
                && storedIntent.launchedAt <= Date.now()
                && Date.now() - storedIntent.launchedAt <= 15 * 60 * 1000
            if (!(intent.active && intent.hidden) && !storedIntentIsCurrent) return

            const launchedAt = intent.active ? intent.launchedAt : storedIntent.launchedAt
            const returnDelayMs = Math.max(0, Math.min(Date.now() - launchedAt, 15 * 60 * 1000))
            const appScheme = intent.active ? intent.appScheme : storedIntent.appScheme
            upiIntentState.current = { active: false, hidden: false, launchedAt: 0 }
            sessionStorage.removeItem('pendingUpiIntent')
            const callbackData = readUpiCallbackData()
            const hasCallbackData = Object.keys(callbackData).length > 0
            recordUpiPaymentEvent(orderId, {
                type: hasCallbackData ? 'APP_CALLBACK_RECEIVED' : 'APP_RETURNED',
                appScheme,
                returnDelayMs,
                callbackData
            }).catch(error => {
                toast.error(error.response?.data?.message || 'Could not save the UPI app return activity')
            })
        }

        document.addEventListener('visibilitychange', recordAppReturn)
        window.addEventListener('pageshow', recordAppReturn)
        recordAppReturn()
        return () => {
            document.removeEventListener('visibilitychange', recordAppReturn)
            window.removeEventListener('pageshow', recordAppReturn)
        }
    }, [orderId])

    const confirmUpiPayment = async () => {
        if (expiryRequestInFlight.current) return
        expiryRequestInFlight.current = true
        setResolvingPayment(true)
        try {
            await expireUpiPaymentRequest(orderId, transactionReference)
            sessionStorage.removeItem('pendingPaymentOrderId')
            sessionStorage.removeItem('pendingPaymentAmount')
            setActivePaymentRequest(null)
            setShowOrderPlaced(true)
        } catch (error) {
            toast.error(error.response?.data?.message || 'Could not confirm your payment status')
        } finally {
            expiryRequestInFlight.current = false
            setResolvingPayment(false)
        }
    }

    const reportUpiPaymentNotCompleted = async () => {
        if (expiryRequestInFlight.current) return
        expiryRequestInFlight.current = true
        setResolvingPayment(true)
        try {
            await markUpiPaymentNotCompleted(orderId)
            setActivePaymentRequest(null)
            setSelectedUpi('')
            setExpandedMethod('upi')
            toast('Payment was not completed. You can try another UPI app.')
        } catch (error) {
            toast.error(error.response?.data?.message || 'Could not update the payment status')
        } finally {
            expiryRequestInFlight.current = false
            setResolvingPayment(false)
        }
    }

    const goToOrderTracking = () => {
        navigate(`/order/${orderId}`)
    }

    const continueToGateway = async () => {
        if (!orderId) {
            toast.error('Order session expired. Please try again.')
            navigate(`/checkout/${id}/summary`)
            return
        }

        try {
            setLoadingPayment(true)
            const paymentUrl = await toPaymentGateway(orderId)
            window.location.href = paymentUrl
        } catch (error) {
            toast.error(error.response?.data?.message || 'Could not start payment')
            setLoadingPayment(false)
        }
    }

    const toggleMethod = (method) => {
        setExpandedMethod(current => current === method ? '' : method)
    }

    const buildUpiUrl = (upiIdValue, scheme = 'upi://pay') => {
        const query = new URLSearchParams({
            pa: upiIdValue,
            pn: 'Flipkart',
            am: totalCost.toFixed(2),
            cu: 'INR',
            tn: `Order ${orderId}`,
            tr: orderId
        })
        return `${scheme}?${query.toString()}`
    }

    const appSchemes = {
        'google-pay': 'tez://upi/pay',
        phonepe: 'phonepe://pay',
        paytm: 'paytmmp://pay',
        mobikwik: 'mobikwik://upi/pay',
        custom: 'upi://pay'
    }

    const openUpiApp = async (request) => {
        const scheme = appSchemes[request.provider] || 'upi://pay'
        const appScheme = scheme.split(':')[0]
        try {
            await recordUpiPaymentEvent(orderId, { type: 'INTENT_LAUNCHED', appScheme })
        } catch (error) {
            toast.error(error.response?.data?.message || 'Could not save the UPI app launch activity')
        }
        upiIntentState.current = { active: true, hidden: false, launchedAt: Date.now(), appScheme }
        try {
            sessionStorage.setItem('pendingUpiIntent', JSON.stringify({
                orderId,
                appScheme,
                launchedAt: Date.now()
            }))
        } catch {
            toast.error('Could not preserve UPI app return tracking in this browser')
        }
        window.location.href = buildUpiUrl(request.upiId, scheme)
    }

    const beginUpiPayment = async (requestBody, selectedValue) => {
        try {
            setLoadingPayment(true)
            const request = await startUpiPaymentRequest(orderId, requestBody)
            expiryRequestInFlight.current = false
            setSelectedUpi(selectedValue)
            setActivePaymentRequest(request)
            window.setTimeout(() => { void openUpiApp(request) }, 350)
        } catch (error) {
            toast.error(error.response?.data?.message || 'Could not start the UPI payment request')
        } finally {
            setLoadingPayment(false)
        }
    }

    const openUpiProvider = (option) => beginUpiPayment({ optionId: option.id }, option.id)

    const openCustomUpi = () => {
        if (!/^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,29}$/i.test(upiId.trim())) {
            toast.error('Enter a valid UPI ID')
            return
        }
        beginUpiPayment({ customUpiId: upiId.trim() }, 'new-upi')
    }

    if (!authenticated || !orderId) return null

    return (
        <main className="payment-page">
            <header className="payment-header">
                <button type="button" aria-label="Back to order summary" onClick={goBack}>
                    <ArrowLeft />
                </button>
                <div className="payment-heading">
                    <span>Step 3 of 3</span>
                    <h1>Payments</h1>
                </div>
                <span className="payment-secure"><LockKeyhole /> 100% Secure</span>
            </header>

            <section className={`payment-total ${amountExpanded ? 'expanded' : ''}`}>
                <button type="button" onClick={() => setAmountExpanded(value => !value)} aria-expanded={amountExpanded}>
                    <span>Total Amount <ChevronDown /></span>
                    <strong>₹{totalCost.toLocaleString('en-IN')}</strong>
                </button>
                {amountExpanded && <div className="payment-amount-details">
                    <p><span>Price ({totalMrp === totalCost ? '1 item' : '1 item'})</span><span>₹{totalMrp.toLocaleString('en-IN')}</span></p>
                    <p><span>Discount</span><span className="payment-green">− ₹{savings.toLocaleString('en-IN')}</span></p>
                    <p><span>Delivery Charges</span><span className="payment-green">Free</span></p>
                    <p className="payment-amount-final"><strong>Payable Amount</strong><strong>₹{totalCost.toLocaleString('en-IN')}</strong></p>
                </div>}
            </section>

            <section className="payment-cashback">
                <div>
                    <strong>5% Cashback</strong>
                    <span>Claim now with payment offers</span>
                </div>
                <span className="payment-cashback-brands" aria-label="Bank offers available">
                    <b className="payment-bank-mark">S</b>
                    <b className="payment-axis-mark">A</b>
                </span>
            </section>

            <section className="payment-methods" aria-label="Payment methods">
                <article className={`payment-method ${expandedMethod === 'upi' ? 'open' : ''}`}>
                    <button type="button" className="payment-method-toggle" onClick={() => toggleMethod('upi')} aria-expanded={expandedMethod === 'upi'}>
                        <span className="payment-method-icon payment-upi-mark" aria-hidden="true">UPI</span>
                        <span className="payment-method-copy"><strong>UPI</strong><small>Pay by any UPI app</small></span>
                        <ChevronDown className="payment-method-chevron" />
                    </button>
                    {expandedMethod === 'upi' && <div className="payment-method-details">
                        {loadingUpiOptions && <p className="payment-upi-status">Loading UPI apps…</p>}
                        {!loadingUpiOptions && upiOptionsError && <p className="payment-upi-status error">{upiOptionsError}</p>}
                        {!loadingUpiOptions && !upiOptionsError && upiOptions.length === 0 && <p className="payment-upi-status">No UPI apps are configured yet.</p>}
                        <div className="payment-upi-options" role="radiogroup" aria-label="Choose a UPI payment option">
                            {upiOptions.map(option => {
                                const brandClass = {
                                    'google-pay': 'payment-google-logo',
                                    phonepe: 'payment-phonepe-logo',
                                    paytm: 'payment-paytm-logo',
                                    mobikwik: 'payment-mobikwik-logo'
                                }[option.provider]
                                const brandMark = { 'google-pay': 'G', phonepe: 'पे', paytm: 'P', mobikwik: 'M' }[option.provider]
                                return <label className="payment-upi-option" key={option.id}>
                                    <input type="radio" name="upi-option" value={option.id} checked={selectedUpi === option.id} onChange={() => openUpiProvider(option)} />
                                    <span>{option.label}</span>
                                    <span className={brandClass} aria-hidden="true">{brandMark}</span>
                                </label>
                            })}
                            <div className="payment-upi-option payment-upi-new-option">
                                <label>
                                    <input type="radio" name="upi-option" value="new-upi" checked={selectedUpi === 'new-upi'} onChange={() => setSelectedUpi('new-upi')} />
                                    <span>Add new UPI ID</span>
                                </label>
                                <button type="button" onClick={() => setShowUpiHelp(value => !value)}>How to find?</button>
                            </div>
                        </div>
                        {selectedUpi === 'new-upi' && <label className="payment-upi-id-field">Enter UPI ID<input type="text" value={upiId} onChange={event => setUpiId(event.target.value)} placeholder="name@bank" /></label>}
                        {showUpiHelp && <p className="payment-upi-help">Open your UPI app and find your UPI ID in Profile or Payment settings.</p>}
                        {selectedUpi === 'new-upi' && <button className="payment-continue-button" type="button" onClick={openCustomUpi} disabled={loadingPayment}>{loadingPayment ? 'Starting payment…' : 'Pay with UPI'}</button>}
                    </div>}
                </article>

                <article className={`payment-method ${expandedMethod === 'card' ? 'open' : ''}`}>
                    <button type="button" className="payment-method-toggle" onClick={() => toggleMethod('card')} aria-expanded={expandedMethod === 'card'}>
                        <CreditCard className="payment-method-icon" />
                        <span className="payment-method-copy">
                            <strong>Credit / Debit / ATM Card</strong>
                            <small>Add and secure cards as per RBI guidelines</small>
                            <em>Get upto 5% cashback · 2 offers available</em>
                        </span>
                        <ChevronDown className="payment-method-chevron" />
                    </button>
                    {expandedMethod === 'card' && <div className="payment-method-details">
                        <label>Card number<input type="text" inputMode="numeric" placeholder="0000 0000 0000 0000" /></label>
                        <div className="payment-card-fields">
                            <label>Expiry date<input type="text" placeholder="MM / YY" /></label>
                            <label>CVV<input type="password" inputMode="numeric" placeholder="CVV" /></label>
                        </div>
                        <button className="payment-continue-button" type="button" onClick={continueToGateway} disabled={loadingPayment}>
                            {loadingPayment ? 'Opening secure payment…' : 'Continue'}
                        </button>
                    </div>}
                </article>

                <article className={`payment-method ${expandedMethod === 'cod' ? 'open' : ''}`}>
                    <button type="button" className="payment-method-toggle single-line" onClick={() => toggleMethod('cod')} aria-expanded={expandedMethod === 'cod'}>
                        <Banknote className="payment-method-icon" />
                        <span className="payment-method-copy"><strong>Cash on Delivery</strong></span>
                        <ChevronDown className="payment-method-chevron" />
                    </button>
                    {expandedMethod === 'cod' && <div className="payment-method-details"><p>Cash on Delivery is available on eligible orders. Payment options are confirmed at delivery.</p></div>}
                </article>

                <article className={`payment-method payment-gift-card ${expandedMethod === 'gift' ? 'open' : ''}`}>
                    <button type="button" className="payment-method-toggle single-line" onClick={() => toggleMethod('gift')} aria-expanded={expandedMethod === 'gift'}>
                        <Gift className="payment-method-icon" />
                        <span className="payment-method-copy"><strong>Have a Flipkart Gift Card?</strong></span>
                        <Plus className="payment-gift-plus" />
                    </button>
                    {expandedMethod === 'gift' && <div className="payment-method-details">
                        <label>Gift card number<input type="text" placeholder="Enter gift card number" /></label>
                        <button className="payment-continue-button" type="button" onClick={() => toast('Gift card payments are not available yet')}>Apply</button>
                    </div>}
                </article>

                <article className="payment-method payment-unavailable" aria-disabled="true">
                    <div className="payment-method-toggle single-line">
                        <CalendarDays className="payment-method-icon" />
                        <span className="payment-method-copy"><strong>EMI</strong></span>
                        <span className="payment-unavailable-label">Unavailable <CircleHelp /></span>
                    </div>
                </article>
            </section>

            <footer className="payment-footer-note">
                <strong>35 Crore happy customers and counting!</strong>
                <Smile aria-hidden="true" />
            </footer>

            {activePaymentRequest && <div className="upi-timer-overlay" role="presentation">
                <section className="upi-timer-modal" role="dialog" aria-modal="true" aria-labelledby="upi-timer-title">
                    <span className="upi-timer-icon"><Clock3 size={24} /></span>
                    <p className="upi-timer-eyebrow">UPI payment request</p>
                    <h2 id="upi-timer-title">{remainingSeconds > 240 ? `Complete payment in ${activePaymentRequest.label}` : 'Did you complete the payment?'}</h2>
                    <p className="upi-timer-description">{remainingSeconds > 240 ? 'The payment app may open separately. Return here whenever you’re ready; the timer stays attached to your order.' : 'You can confirm your payment status now. The timer will keep running until it ends.'}</p>
                    <strong className="upi-timer-countdown" aria-live="polite">{String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:{String(remainingSeconds % 60).padStart(2, '0')}</strong>
                    {remainingSeconds > 0 && <>
                        <button className="upi-timer-open-app" type="button" onClick={() => { void openUpiApp(activePaymentRequest) }}>
                            Open {activePaymentRequest.label} again <ExternalLink size={16} />
                        </button>
                    </>}
                    {remainingSeconds <= 240 && <div className="upi-timer-result-actions">
                        <label className="upi-transaction-reference">
                            UPI transaction ID / UTR (optional)
                            <input
                                type="text"
                                value={transactionReference}
                                onChange={event => setTransactionReference(event.target.value)}
                                maxLength={50}
                                autoComplete="off"
                                placeholder="Enter the reference from your UPI receipt"
                            />
                            <span className="upi-timer-note">This reference is stored for review; it does not automatically verify payment.</span>
                        </label>
                        <button className="upi-payment-done-button" type="button" onClick={confirmUpiPayment} disabled={resolvingPayment}>
                            {resolvingPayment ? 'Updating order…' : 'Payment done'}
                        </button>
                        <button className="upi-payment-not-done-button" type="button" onClick={reportUpiPaymentNotCompleted} disabled={resolvingPayment}>
                            Payment not done
                        </button>
                    </div>}
                    {remainingSeconds > 240 && <p className="upi-timer-note">Payment options will appear when 4 minutes remain.</p>}
                </section>
            </div>}
            {showOrderPlaced && <div className="upi-timer-overlay upi-order-placed-overlay" role="presentation">
                <section className="upi-order-placed-modal" role="dialog" aria-modal="true" aria-labelledby="upi-order-placed-title">
                    <span className="upi-order-placed-icon"><CheckCircle2 size={34} /></span>
                    <p className="upi-order-placed-eyebrow">Payment confirmation received</p>
                    <h2 id="upi-order-placed-title">Your order has been placed</h2>
                    <p>Your payment will be verified by the store. You can track your order for the latest updates.</p>
                    <button type="button" onClick={goToOrderTracking}>Track your order</button>
                </section>
            </div>}
        </main>
    )
}

export default Payment