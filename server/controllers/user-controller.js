const User = require("../models/user")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken");
const Otp = require("../models/otp");
const wrapAsync = require("../utils/wrapAsync");
const { verifyFirebaseIdToken } = require("../service/firebaseAdmin");
const { isOtpValid } = require("../service/otpVerification");
const {
    createAccessToken,
    createRefreshToken,
    setRefreshTokenCookie,
    clearRefreshTokenCookie
} = require("../service/authTokens");

//Get Me Controller
module.exports.getMe = wrapAsync(async (req, res) => {
    let userId = req.user?._id
    let shouldRefreshAccessToken = false

    if (!userId) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split(" ")[1];
            try {
                const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
                userId = decoded._id;
            } catch (tokenErr) {
                userId = null;
            }
        }
    }

    if (!userId) {
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
            try {
                const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
                userId = decoded._id;
                shouldRefreshAccessToken = true
            } catch (refreshErr) {
                userId = null;
            }
        }
    }

    if (!userId) {
        return res.status(401).json({ message: "Not authenticated", success: false })
    }

    const user = await User.findById(userId)

    if (!user) {
        return res.status(404).json({ message: "User not found", success: false })
    }

    const response = {
        resUser: {
            _id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            phone: user.phone,
            addresses: user.addresses,
            selectedAddressId: user.selectedAddressId
        }
    }

    if (shouldRefreshAccessToken) {
        response.token = createAccessToken(user)
        setRefreshTokenCookie(res, createRefreshToken(user))
    }

    res.status(200).json({
        ...response
    })
})

module.exports.addAddress = wrapAsync(async (req, res) => {
    const { fullName, phone, alternatePhone = "", flat, area, city, state, pincode, type = "Home" } = req.body || {}
    const requiredValues = [fullName, phone, flat, area, city, state, pincode]

    if (requiredValues.some(value => typeof value !== "string" || !value.trim())) {
        return res.status(400).json({ success: false, message: "Please complete all required address fields." })
    }

    if (typeof alternatePhone !== "string" || !/^\d{10}$/.test(phone.trim()) || (alternatePhone && !/^\d{10}$/.test(alternatePhone.trim()))) {
        return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number." })
    }

    if (!/^\d{6}$/.test(pincode.trim())) {
        return res.status(400).json({ success: false, message: "Enter a valid 6-digit PIN code." })
    }

    if (!["Home", "Work"].includes(type)) {
        return res.status(400).json({ success: false, message: "Address type must be Home or Work." })
    }

    const user = await User.findById(req.user._id)
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." })
    }

    const address = user.addresses.create({
        fullName: fullName.trim(),
        phone: phone.trim(),
        alternatePhone: alternatePhone.trim(),
        flat: flat.trim(),
        area: area.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        type
    })
    user.addresses.push(address)
    user.selectedAddressId = address._id
    await user.save()

    res.status(201).json({
        success: true,
        address: user.addresses.id(address._id),
        selectedAddressId: user.selectedAddressId
    })
})

module.exports.selectAddress = wrapAsync(async (req, res) => {
    const user = await User.findById(req.user._id)
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." })
    }

    const address = user.addresses.id(req.params.addressId)
    if (!address) {
        return res.status(404).json({ success: false, message: "Saved address not found." })
    }

    user.selectedAddressId = address._id
    await user.save()
    res.status(200).json({ success: true, selectedAddressId: user.selectedAddressId })
})

//Signup Controller
module.exports.signup = wrapAsync(async (req, res) => {
    const { name, email, username, password, phone, otp } = req.body
    if (!name || !email || !username || !password || !phone || !otp) {
        return res.status(400).json({ message: "All fields and email OTP are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const otpRecord = await Otp.findOne({
        email: normalizedEmail,
        purpose: "signup",
        expiresAt: { $gt: Date.now() }
    });
    if (!otpRecord) {
        return res.status(400).json({ message: "Signup OTP expired or not found. Request a new code." });
    }

    if (!isOtpValid(otp, otpRecord.otpHash)) {
        return res.status(400).json({ message: "Incorrect signup OTP" });
    }

    const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username: username.trim() }, { phone }] });
    if (existingUser) {
        return res.status(409).json({ message: "Email, username, or phone is already registered" })
    }

    const hashedPass = await bcrypt.hash(password, 10);

    const user = new User({
        name: name,
        email: normalizedEmail,
        username: username.trim(),
        password: hashedPass,
        phone: phone
    })

    const savedUser = await user.save();
    await Otp.deleteMany({ email: normalizedEmail, purpose: "signup" });

    const accessToken = createAccessToken(savedUser);
    const refreshToken = createRefreshToken(savedUser);

    setRefreshTokenCookie(res, refreshToken)

    const resUser = {
        _id: savedUser._id,
        name: savedUser.name,
        email: savedUser.email,
        username: savedUser.username,
        phone: savedUser.phone,
        addresses: savedUser.addresses,
        selectedAddressId: savedUser.selectedAddressId,
    }

    res.status(201).json({
        success: true,
        message: `${name} Welcome to FlipKart`,
        resUser,
        token: accessToken
    })
})

//Login Controller
module.exports.login = wrapAsync(async (req, res) => {
    const { email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (!existingUser) {
        return res.status(401).json({
            message: "Invalid email or password",
            success: false
        })
    }

    const verifyPass = await bcrypt.compare(password, existingUser.password)
    if (!verifyPass) {
        return res.status(401).json({
            message: "Invalid email or password",
            success: false
        })
    }

    const resUser = {
        _id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
        username: existingUser.username,
        phone: existingUser.phone,
        addresses: existingUser.addresses,
        selectedAddressId: existingUser.selectedAddressId,
    }

    const accessToken = createAccessToken(existingUser);
    const refreshToken = createRefreshToken(existingUser);

    setRefreshTokenCookie(res, refreshToken)

    res.status(200).json({
        message: `Welcome Back ${existingUser.name}`,
        success: true,
        resUser,
        token: accessToken
    })
})

module.exports.firebasePhoneLogin = wrapAsync(async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
        return res.status(400).json({ success: false, message: "Firebase ID token is required" });
    }

    let firebaseUser;
    try {
        firebaseUser = await verifyFirebaseIdToken(idToken);
    } catch {
        return res.status(401).json({ success: false, message: "Firebase phone verification failed" });
    }

    if (!firebaseUser.phone_number) {
        return res.status(401).json({ success: false, message: "Verified phone number is missing" });
    }

    const digits = firebaseUser.phone_number.replace(/\D/g, "");
    const localNumber = digits.length > 10 ? digits.slice(-10) : digits;
    const user = await User.findOne({ phone: { $in: [localNumber, `+91${localNumber}`, `91${localNumber}`] } });

    if (!user || user.role === "admin") {
        return res.status(404).json({ success: false, message: "No customer account found for this phone number. Please sign up or use password login." });
    }

    const accessToken = createAccessToken(user);
    const refreshToken = createRefreshToken(user);
    setRefreshTokenCookie(res, refreshToken)

    return res.status(200).json({
        success: true,
        token: accessToken,
        resUser: {
            _id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            phone: user.phone,
            addresses: user.addresses,
            selectedAddressId: user.selectedAddressId
        }
    });
});

//LogOut Route
module.exports.logOutUser = (req, res) => {
    clearRefreshTokenCookie(res)
    res.status(200).json({ message: "Logged Out Successfully" })
}

//Refresh Token Route
module.exports.refreshToken = wrapAsync(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken

    if (!refreshToken) {
        return res.status(401).json({ message: "No refresh token" })
    }

    let decoded
    try {
        decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET)
    } catch {
        clearRefreshTokenCookie(res)
        return res.status(401).json({ message: "Refresh token is invalid or expired" })
    }

    const user = await User.findById(decoded._id)
    if (!user) {
        return res.status(401).json({ message: "User not found" })
    }

    const newAccessToken = createAccessToken(user)
    setRefreshTokenCookie(res, createRefreshToken(user))

    res.status(200).json({
        token: newAccessToken
    })
}) 