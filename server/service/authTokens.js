const jwt = require("jsonwebtoken")

const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const REFRESH_COOKIE_MAX_AGE_MS = REFRESH_TOKEN_TTL_SECONDS * 1000

const createAccessToken = (user) => jwt.sign(
    { _id: user._id, role: user.role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS }
)

const createRefreshToken = (user) => jwt.sign(
    { _id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL_SECONDS }
)

const getRefreshCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS
})

const setRefreshTokenCookie = (res, token) => {
    res.cookie("refreshToken", token, getRefreshCookieOptions())
}

const clearRefreshTokenCookie = (res) => {
    const { maxAge, ...options } = getRefreshCookieOptions()
    res.clearCookie("refreshToken", options)
}

module.exports = {
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    REFRESH_COOKIE_MAX_AGE_MS,
    createAccessToken,
    createRefreshToken,
    getRefreshCookieOptions,
    setRefreshTokenCookie,
    clearRefreshTokenCookie
}
