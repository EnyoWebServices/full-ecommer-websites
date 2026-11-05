const test = require("node:test")
const assert = require("node:assert/strict")
const {
    MAX_UPI_PAYMENT_EVENTS,
    MAX_RETURN_DELAY_MS,
    validateUpiEventPayload,
    validateTransactionReference,
    canAppendUpiPaymentEvent
} = require("../service/upiPaymentEvents")

test("UPI app lifecycle events accept only supported event and scheme values", () => {
    assert.deepEqual(validateUpiEventPayload({ type: "INTENT_LAUNCHED", appScheme: "phonepe" }), {
        value: { type: "INTENT_LAUNCHED", appScheme: "phonepe", returnDelayMs: undefined }
    })
    assert.deepEqual(validateUpiEventPayload({ type: "APP_RETURNED", appScheme: "upi" }), {
        value: { type: "APP_RETURNED", appScheme: "upi", returnDelayMs: undefined }
    })
    assert.match(validateUpiEventPayload({ type: "PAID", appScheme: "upi" }).error, /Unsupported/)
    assert.match(validateUpiEventPayload({ type: "APP_RETURNED", appScheme: "javascript" }).error, /Unsupported/)
    assert.match(validateUpiEventPayload(null).error, /event is required/)
    assert.deepEqual(validateUpiEventPayload({
        type: "APP_RETURNED",
        appScheme: "upi",
        returnDelayMs: MAX_RETURN_DELAY_MS
    }).value.returnDelayMs, MAX_RETURN_DELAY_MS)
    assert.match(validateUpiEventPayload({
        type: "APP_RETURNED",
        appScheme: "upi",
        returnDelayMs: MAX_RETURN_DELAY_MS + 1
    }).error, /return time is invalid/)
})

test("transaction references are optional and validated before storage", () => {
    assert.deepEqual(validateTransactionReference(undefined), { value: "" })
    assert.deepEqual(validateTransactionReference("123456789012"), { value: "123456789012" })
    assert.match(validateTransactionReference("ref!?").error, /valid UPI transaction reference/)
    assert.match(validateTransactionReference("123").error, /valid UPI transaction reference/)
    assert.match(validateTransactionReference("1".repeat(51)).error, /valid UPI transaction reference/)
})

test("UPI activity history has a bounded size", () => {
    assert.equal(canAppendUpiPaymentEvent(Array(MAX_UPI_PAYMENT_EVENTS - 1)), true)
    assert.equal(canAppendUpiPaymentEvent(Array(MAX_UPI_PAYMENT_EVENTS)), false)
})
