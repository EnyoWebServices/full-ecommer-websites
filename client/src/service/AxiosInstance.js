import axios from "axios"
import { clearSession, updateToken } from "../redux/features/UserSlice"

let reduxStore
let refreshPromise

export const injectStore = (store) => {
    reduxStore = store
}

const axiosInstance = axios.create({
    baseURL: import.meta.env.DEV
        ? `${window.location.protocol}//${window.location.hostname}:${import.meta.env.VITE_API_PORT || "5001"}`
        : import.meta.env.VITE_API_URL,
    withCredentials: true
})

const shouldSkipRefresh = (url = "") => [
    "/login",
    "/signup",
    "/verify-otp",
    "/firebase-login",
    "/send-otp",
    "/signup/send-otp",
    "/refresh",
    "/logout"
].some(path => url.endsWith(path))

const refreshAccessToken = () => {
    if (!refreshPromise) {
        refreshPromise = axiosInstance.post("/refresh")
            .then(({ data }) => {
                if (!data?.token) {
                    throw new Error("Refresh response did not include an access token")
                }
                if (reduxStore) reduxStore.dispatch(updateToken(data.token))
                else localStorage.setItem("flipkart_token", data.token)
                return data.token
            })
            .finally(() => {
                refreshPromise = null
            })
    }
    return refreshPromise
}

axiosInstance.interceptors.request.use((config) => {
    const token = reduxStore?.getState()?.user?.token || localStorage.getItem("flipkart_token")
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config
        if (
            error.response?.status !== 401 ||
            !originalRequest ||
            originalRequest._retry ||
            shouldSkipRefresh(originalRequest.url)
        ) {
            return Promise.reject(error)
        }

        originalRequest._retry = true
        try {
            const token = await refreshAccessToken()
            originalRequest.headers = originalRequest.headers || {}
            originalRequest.headers.Authorization = `Bearer ${token}`
            return axiosInstance(originalRequest)
        } catch (refreshError) {
            if (reduxStore) reduxStore.dispatch(clearSession())
            else {
                localStorage.removeItem("flipkart_token")
                localStorage.removeItem("flipkart_user")
            }
            return Promise.reject(refreshError)
        }
    }
)

export default axiosInstance
