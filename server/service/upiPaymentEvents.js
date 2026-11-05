const UPI_APP_SCHEMES = new Set(["upi", "phonepe", "tez", "paytmmp", "mobikwik"])
const TRANSACTION_REFERENCE_PATTERN = /^[a-z0-9-]{6,50}$/i
const MAX_UPI_PAYMENT_EVENTS = 50
const MAX_RETURN_DELAY_MS = 15 * 60 * 1000
const UPI_CALLBACK_FIELDS = new Map([
    ["status", "status"],
    ["txnstatus", "status"],
    ["transactionstatus", "status"],
    ["txnid", "transactionId"],
    ["transactionid", "transactionId"],
    ["txnref", "transactionReference"],
    ["transactionref", "transactionReference"],
    ["approvalrefno", "approvalReference"],
    ["responsecode", "responseCode"],
    ["responsemessage", "responseMessage"],
    ["amount", "amount"],
    ["currency", "currency"]
])
const MAX_CALLBACK_FIELDS = 10
const MAX_CALLBACK_VALUE_LENGTH = 256

const validateUpiEventPayload = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { error: "A UPI payment event is required." }
    }
    const { type, appScheme, transactionReference, returnDelayMs, callbackData } = payload
    if (!["INTENT_LAUNCHED", "APP_RETURNED", "APP_CALLBACK_RECEIVED"].includes(type)) {
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
    if (callbackData !== undefined && (!callbackData || typeof callbackData !== "object" || Array.isArray(callbackData))) {
        return { error: "UPI callback data must be an object." }
    }

    const validatedCallbackData = []
    for (const [field, rawValue] of Object.entries(callbackData || {})) {
        const key = UPI_CALLBACK_FIELDS.get(field.toLowerCase().replace(/[^a-z0-9]/g, ""))
        if (!key || rawValue === undefined || rawValue === null || rawValue === "") continue
        if (typeof rawValue !== "string" && typeof rawValue !== "number") {
            return { error: "UPI callback values must be text or numbers." }
        }
        const value = String(rawValue).replace(/[\u0000-\u001f\u007f]/g, "").trim()
        if (!value) continue
        if (value.length > MAX_CALLBACK_VALUE_LENGTH) {
            return { error: "UPI callback value is too long." }
        }
        if (!validatedCallbackData.some((item) => item.key === key)) {
            validatedCallbackData.push({ key, value })
        }
        if (validatedCallbackData.length > MAX_CALLBACK_FIELDS) {
            return { error: "Too many UPI callback fields were provided." }
        }
    }
    if (type === "APP_CALLBACK_RECEIVED" && validatedCallbackData.length === 0) {
        return { error: "No supported UPI callback fields were provided." }
    }
    return { value: { type, appScheme, returnDelayMs, callbackData: validatedCallbackData } }
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
