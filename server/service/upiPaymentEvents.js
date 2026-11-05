const UPI_APP_SCHEMES = new Set(["upi", "phonepe", "tez", "paytmmp", "mobikwik"])
const TRANSACTION_REFERENCE_PATTERN = /^[a-z0-9-]{6,50}$/i
const MAX_UPI_PAYMENT_EVENTS = 50
const MAX_RETURN_DELAY_MS = 15 * 60 * 1000

const validateUpiEventPayload = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { error: "A UPI payment event is required." }
    }
    const { type, appScheme, transactionReference, returnDelayMs } = payload
    if (!["INTENT_LAUNCHED", "APP_RETURNED"].includes(type)) {
        return { error: "Unsupported UPI payment event." }
    }
    if (appScheme !== undefined && !UPI_APP_SCHEMES.has(appScheme)) {
        return { error: "Unsupported UPI app scheme." }
    }
    if (transactionReference !== undefined) {
        return { error: "Transaction references can only be submitted with payment confirmation." }
    }
    if (returnDelayMs !== undefined
        && (!Number.isInteger(returnDelayMs) || returnDelayMs < 0 || returnDelayMs > MAX_RETURN_DELAY_MS)) {
        return { error: "UPI app return time is invalid." }
    }
    return { value: { type, appScheme, returnDelayMs } }
}

const validateTransactionReference = (value) => {
    if (value === undefined || value === null || value === "") return { value: "" }
    if (typeof value !== "string" || !TRANSACTION_REFERENCE_PATTERN.test(value.trim())) {
        return { error: "Enter a valid UPI transaction reference (6-50 letters, numbers, or hyphens)." }
    }
    return { value: value.trim() }
}

const canAppendUpiPaymentEvent = (events) => events.length < MAX_UPI_PAYMENT_EVENTS

module.exports = {
    MAX_UPI_PAYMENT_EVENTS,
    MAX_RETURN_DELAY_MS,
    validateUpiEventPayload,
    validateTransactionReference,
    canAppendUpiPaymentEvent
}
