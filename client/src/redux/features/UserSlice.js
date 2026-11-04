import { createAsyncThunk, createSlice } from "@reduxjs/toolkit"
import axiosInstance from "../../service/AxiosInstance"

//Fetch User
export const fetchMe = createAsyncThunk(
    "user/fetchMe",
    async (_, { rejectWithValue }) => {
        try {
            const { data } = await axiosInstance.get("/me")
            const currentToken = localStorage.getItem("flipkart_token")
            return {
                user: data.resUser,
                token: data.token || currentToken
            }
        }  catch (error) {
            return rejectWithValue(
                {
                    message: error.response?.data?.message || "Session check failed",
                    status: error.response?.status
                }
            )
        }
    }
)

//Login User
export const loginUser = createAsyncThunk(
    "user/loginUser",
    async (cred, { rejectWithValue }) => {
        try {
            const { data } = await axiosInstance.post(`/login`, cred)
            return {
                user: data.resUser,
                token: data.token
            }
        } catch (error) {
            return rejectWithValue(error.response?.data?.message || error.message || "Login failed")
        }
    }
)

//SignUp User
export const signUpUser = createAsyncThunk(
    "user/signUp",
    async (signupData) => {
        const { data } = await axiosInstance.post(`/signup`, signupData);
        return {
            user: data.resUser,
            token: data.token
        }
    }
)

//LogOut User
export const logOutUser = createAsyncThunk(
    "user/logOut",
    async () => {
        const { data } = await axiosInstance.post(`/logout`);
        return {
            message: data.message
        }
    }
)

//OTP Verify For Login
export const VerifyOtp = createAsyncThunk(
    "user/login/otp",
    async ({ email, phone, otp }) => {
        const { data } = await axiosInstance.post(`/verify-otp`, { email, phone, otp })
        return {
            user: data.resUser,
            token: data.token
        }
    }
)

export const firebasePhoneLogin = createAsyncThunk(
    "user/firebasePhoneLogin",
    async (idToken) => {
        const { data } = await axiosInstance.post("/firebase-login", { idToken })
        return {
            user: data.resUser,
            token: data.token
        }
    }
)

// Slice ------------------------------->

const savedToken = typeof window !== "undefined" ? localStorage.getItem("flipkart_token") : null;
const savedUser = typeof window !== "undefined" && localStorage.getItem("flipkart_user")
    ? (function() {
        try {
            return JSON.parse(localStorage.getItem("flipkart_user"))
        } catch {
            return null
        }
    })()
    : null;

const userSlice = createSlice({
    name: "user",
    initialState: {
        user: savedUser || null,
        token: savedToken || null,
        authenticated: !!savedToken,
        error: null,
        loading: false,
        message: null
    },
    reducers: {
        clearSession(state) {
            state.user = null
            state.token = null
            state.authenticated = false
            state.loading = false
            localStorage.removeItem("flipkart_token")
            localStorage.removeItem("flipkart_user")
        },
        updateToken(state, action) {
            state.token = action.payload
            state.authenticated = true
            if (action.payload) {
                localStorage.setItem("flipkart_token", action.payload)
            }
        },
        updateDeliveryAddresses(state, action) {
            if (!state.user) return
            state.user.addresses = action.payload.addresses
            state.user.selectedAddressId = action.payload.selectedAddressId
            localStorage.setItem("flipkart_user", JSON.stringify(state.user))
        }
    },
    extraReducers: (builder) => {
        builder

            //Fetch User
            .addCase(fetchMe.pending, (state) => {
                state.loading = true
            })
            .addCase(fetchMe.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.token = action.payload.token
                state.authenticated = true
                state.loading = false
                if (action.payload.user) {
                    localStorage.setItem("flipkart_user", JSON.stringify(action.payload.user))
                }
                if (action.payload.token) {
                    localStorage.setItem("flipkart_token", action.payload.token)
                }
            })
            .addCase(fetchMe.rejected, (state, action) => {
                state.loading = false
                state.error = action.payload?.message || null
                if ([401, 404].includes(action.payload?.status)) {
                    state.user = null
                    state.token = null
                    state.authenticated = false
                    localStorage.removeItem("flipkart_token")
                    localStorage.removeItem("flipkart_user")
                }
            })

            //Login
            .addCase(loginUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(loginUser.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.token = action.payload.token
                if (action.payload.token) {
                    localStorage.setItem("flipkart_token", action.payload.token)
                }
                if (action.payload.user) {
                    localStorage.setItem("flipkart_user", JSON.stringify(action.payload.user))
                }
                state.loading = false;
                state.authenticated = true
            })
            .addCase(loginUser.rejected, (state, action) => {
                state.error = action.error.message
                state.loading = false;
            })

            //Signup
            .addCase(signUpUser.pending, (state) => {
                state.error = null;
                state.loading = true;
            })
            .addCase(signUpUser.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.token = action.payload.token
                if (action.payload.token) {
                    localStorage.setItem("flipkart_token", action.payload.token)
                }
                if (action.payload.user) {
                    localStorage.setItem("flipkart_user", JSON.stringify(action.payload.user))
                }
                state.authenticated = true
                state.loading = false;
            })
            .addCase(signUpUser.rejected, (state, action) => {
                state.error = action.error.message
                state.loading = false;
            })

            //logOut User
            .addCase(logOutUser.pending, (state) => {
                state.loading = true;
            })
            .addCase(logOutUser.fulfilled, (state, action) => {
                state.user = null;
                state.authenticated = false;
                state.token = null;
                state.loading = false;
                state.message = action.payload;
                localStorage.removeItem("flipkart_token")
                localStorage.removeItem("flipkart_user")
            })
            .addCase(logOutUser.rejected, (state) => {
                state.loading = false;
            })

            //Verify OTP
            .addCase(VerifyOtp.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.token = action.payload.token
                if (action.payload.token) {
                    localStorage.setItem("flipkart_token", action.payload.token)
                }
                if (action.payload.user) {
                    localStorage.setItem("flipkart_user", JSON.stringify(action.payload.user))
                }
                state.loading = false;
                state.authenticated = true
            })
            .addCase(firebasePhoneLogin.pending, (state) => {
                state.loading = true
                state.error = null
            })
            .addCase(firebasePhoneLogin.fulfilled, (state, action) => {
                state.user = action.payload.user
                state.token = action.payload.token
                state.loading = false
                state.authenticated = true
                localStorage.setItem("flipkart_token", action.payload.token)
                localStorage.setItem("flipkart_user", JSON.stringify(action.payload.user))
            })
            .addCase(firebasePhoneLogin.rejected, (state, action) => {
                state.loading = false
                state.error = action.error.message
            })
    }
})

export const { clearSession, updateDeliveryAddresses, updateToken } = userSlice.actions
export default userSlice.reducer