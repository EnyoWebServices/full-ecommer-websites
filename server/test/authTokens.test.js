const test = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const {
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    REFRESH_COOKIE_MAX_AGE_MS,
    createAccessToken,
    createRefreshToken,
    getRefreshCookieOptions,
    setRefreshTokenCookie,
    clearRefreshTokenCookie
} = require("../service/authTokens")

process.env.ACCESS_TOKEN_SECRET ||= "auth-token-test-access-secret"
process.env.REFRESH_TOKEN_SECRET ||= "auth-token-test-refresh-secret"

test("customer access tokens remain valid for 24 hours", () => {
    const token = createAccessToken({ _id: "customer-1", role: "customer" })
    const decoded = jwt.decode(token)

    assert.equal(decoded.exp - decoded.iat, ACCESS_TOKEN_TTL_SECONDS)
    assert.equal(ACCESS_TOKEN_TTL_SECONDS, 24 * 60 * 60)
})

test("refresh tokens and cookies use a 30-day lifetime", () => {
    const token = createRefreshToken({ _id: "customer-1" })
    const decoded = jwt.decode(token)

    assert.equal(decoded.exp - decoded.iat, REFRESH_TOKEN_TTL_SECONDS)
    assert.equal(REFRESH_COOKIE_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000)
})

test("refresh cookie is HTTP-only and cleared with matching security options", (t) => {
    const originalNodeEnv = process.env.NODE_ENV
    t.after(() => {
        if (originalNodeEnv === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = originalNodeEnv
    })
    process.env.NODE_ENV = "production"
    const options = getRefreshCookieOptions()
    let setCookie
    let clearedCookie

    setRefreshTokenCookie({
        cookie: (...args) => { setCookie = args }
    }, "refresh-token")
    clearRefreshTokenCookie({
        clearCookie: (...args) => { clearedCookie = args }
    })

    assert.equal(options.httpOnly, true)
    assert.equal(options.secure, true)
    assert.equal(options.sameSite, "none")
    assert.equal(setCookie[0], "refreshToken")
    assert.equal(setCookie[2].maxAge, REFRESH_COOKIE_MAX_AGE_MS)
    assert.equal(clearedCookie[0], "refreshToken")
    assert.equal(clearedCookie[1].httpOnly, true)
    assert.equal(clearedCookie[1].sameSite, "none")
    assert.equal("maxAge" in clearedCookie[1], false)
})
