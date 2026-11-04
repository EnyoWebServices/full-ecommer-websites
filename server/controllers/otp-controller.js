const { sendMailWithSmtpSettings } = require("../config/nodeMailer");
const Otp = require("../models/otp");
const crypto = require("crypto");
const User = require("../models/user");
const wrapAsync = require("../utils/wrapAsync");
const { getOtpEmailSettings } = require("../service/smtpSettings");
const { renderOtpEmail, renderOtpEmailText } = require("../service/otpEmailTemplate");
const { hashOtp, isOtpValid } = require("../service/otpVerification");
const { createEmailOnlyAccountDetails } = require("../service/emailOnlyAccount");
const bcrypt = require("bcryptjs");
const {
    createAccessToken,
    createRefreshToken,
    setRefreshTokenCookie
} = require("../service/authTokens");

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_RESEND_INTERVAL_MS = 30 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getOtpDeliveryErrorStatus = (error) => {
    if (error.code === "OTP_RATE_LIMITED") return 429;
    if (error.code === "SMTP_NOT_CONFIGURED" || error.code === "EMAIL_SENDER_NOT_CONFIGURED") return 503;
    return 502;
}

const sendOtpEmail = async ({ to, otp }) => {
    const { subject, template } = await getOtpEmailSettings()
    return sendMailWithSmtpSettings({
        to,
        subject,
        html: renderOtpEmail(template, otp),
        text: renderOtpEmailText(template, otp)
    })
}

const createAndSendSignupOtp = async (email) => {
    const recentOtp = await Otp.findOne({
        email,
        purpose: "signup",
        createdAt: { $gt: new Date(Date.now() - OTP_RESEND_INTERVAL_MS) }
    }).select("_id").lean()
    if (recentOtp) {
        const error = new Error("Please wait 30 seconds before requesting another code.")
        error.code = "OTP_RATE_LIMITED"
        throw error
    }

    await Otp.deleteMany({ email, purpose: "signup" });
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpRecord = await Otp.create({
        email,
        purpose: "signup",
        otpHash: hashOtp(otp),
        expiresAt: Date.now() + OTP_EXPIRY_MS
    });

    try {
        await sendOtpEmail({ to: email, otp });
    } catch (error) {
        await Otp.deleteOne({ _id: otpRecord._id });
        throw error;
    }
}

module.exports.SendSignupOtp = wrapAsync(async (req, res) => {
    const { email, username, phone } = req.body;
    if (!email || !username || !phone) {
        return res.status(400).json({ success: false, message: "Email, username, and phone are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({
        $or: [{ email: normalizedEmail }, { username: username.trim() }, { phone }]
    });
    if (existingUser) {
        return res.status(409).json({ success: false, message: "Email, username, or phone is already registered" });
    }

    try {
        await createAndSendSignupOtp(normalizedEmail);
    } catch (error) {
        console.error("Signup OTP Delivery Error:", error.message);
        return res.status(getOtpDeliveryErrorStatus(error)).json({ success: false, message: error.message || "Failed to send signup verification email" });
    }

    return res.status(200).json({ success: true, message: "Signup verification code sent" });
});

//Send OTP
module.exports.SendOtp = wrapAsync(async (req, res) => {
    const { email, phone } = req.body;

    if (!email && !phone) {
        return res.status(400).json({ success: false, message: "Email or phone number is required" });
    }
    if (email && (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()))) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." })
    }

    let existingUser;
    if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        existingUser = await User.findOne({ email: normalizedEmail });
        if (!existingUser) {
            try {
                await createAndSendSignupOtp(normalizedEmail);
            } catch (error) {
                console.error("Signup OTP Delivery Error:", error.message);
                return res.status(getOtpDeliveryErrorStatus(error)).json({ success: false, message: error.message || "Failed to send signup verification email" });
            }
            return res.status(200).json({
                success: true,
                message: "Signup verification code sent",
                purpose: "signup"
            });
        }
    } else {
        const digits = String(phone).replace(/\D/g, '');
        const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
        if (localNumber.length !== 10) {
            return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number" });
        }
        existingUser = await User.findOne({ phone: { $in: [localNumber, `+91${localNumber}`, `91${localNumber}`] } });
    }

    if (!existingUser) {
        return res.status(404).json({ success: false, message: "User does not exist. Please sign up first." });
    }

    await Otp.deleteMany({ userId: existingUser._id });

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = hashOtp(otp);

    await Otp.create({
        userId: existingUser._id,
        otpHash,
        expiresAt: Date.now() + OTP_EXPIRY_MS
    });

    try {
        await sendOtpEmail({ to: existingUser.email, otp });
    } catch (err) {
        await Otp.deleteMany({ userId: existingUser._id });
        console.error("OTP Delivery Error:", err.message);
        const status = err.code === "SMTP_NOT_CONFIGURED" || err.code === "EMAIL_SENDER_NOT_CONFIGURED" ? 503 : 502;
        return res.status(status).json({ success: false, message: err.message || "Failed to send OTP email." });
    }

    return res.status(200).json({ success: true, message: "OTP sent successfully" });
});


//Verify OTP
module.exports.VerifyOtp = wrapAsync(async (req, res) => {
    const { email, phone, otp } = req.body

    if ((!email && !phone) || !otp) {
        return res.status(400).json({ success: false, message: "Email or phone number and OTP are required" });
    }
    if (email && (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()))) {
        return res.status(400).json({ success: false, message: "Enter a valid email address." })
    }

    let existingUser;
    if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        existingUser = await User.findOne({ email: normalizedEmail });
    } else {
        const digits = String(phone).replace(/\D/g, '');
        const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
        if (localNumber.length !== 10) {
            return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number" });
        }
        existingUser = await User.findOne({ phone: { $in: [localNumber, `+91${localNumber}`, `91${localNumber}`] } });
    }

    if (!existingUser) {
        if (email) {
            const normalizedEmail = email.toLowerCase().trim()
            const signupOtp = await Otp.findOne({
                email: normalizedEmail,
                purpose: "signup",
                expiresAt: { $gt: Date.now() }
            })
            if (!signupOtp) {
                return res.status(400).json({ success: false, message: "Signup OTP expired or not found. Request a new code." })
            }
            if (!isOtpValid(otp, signupOtp.otpHash)) {
                return res.status(400).json({ success: false, message: "Incorrect signup OTP" })
            }
            const accountDetails = createEmailOnlyAccountDetails(normalizedEmail)
            const hashedPassword = await bcrypt.hash(accountDetails.password, 10)
            try {
                existingUser = await User.create({
                    ...accountDetails,
                    email: normalizedEmail,
                    password: hashedPassword
                })
            } catch (error) {
                if (error.code !== 11000) throw error
                existingUser = await User.findOne({ email: normalizedEmail })
                if (!existingUser) {
                    return res.status(409).json({ success: false, message: "Could not create account. Please request a new code." })
                }
            }
            await Otp.deleteMany({ email: normalizedEmail, purpose: "signup" })
        } else {
            return res.status(404).json({ success: false, message: "User does not exist" })
        }
    } else {
        const otpRecord = await Otp.findOne({
            userId: existingUser._id,
            expiresAt: { $gt: Date.now() }
        })

        if (!otpRecord) {
            return res.status(400).json({ success: false, message: "OTP expired or invalid" })
        }

        if (!isOtpValid(otp, otpRecord.otpHash)) {
            return res.status(400).json({ success: false, message: "Incorrect Otp" })
        }

        await Otp.deleteMany({ userId: existingUser._id })
    }

    const accessToken = createAccessToken(existingUser)
    const refreshToken = createRefreshToken(existingUser)
    setRefreshTokenCookie(res, refreshToken)

    return res.status(200).json({
        success: true, message: "Login Successfull", token: accessToken, resUser: {
            _id: existingUser._id,
            email: existingUser.email,
            name: existingUser.name,
            username: existingUser.username,
            phone: existingUser.phone,
            addresses: existingUser.addresses,
            selectedAddressId: existingUser.selectedAddressId
        }
    })
})