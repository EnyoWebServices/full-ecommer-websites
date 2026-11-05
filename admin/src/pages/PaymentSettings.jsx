import { useEffect, useState } from 'react'
import { AdminUpiOptions, SaveAdminUpiOptions } from '../service/OrderApi'
import './css/PaymentSettings.css'

const PROVIDERS = [
    { value: 'google-pay', label: 'Google Pay' },
    { value: 'phonepe', label: 'PhonePe' },
    { value: 'paytm', label: 'Paytm' },
    { value: 'mobikwik', label: 'MobiKwik' }
]

const emptyOption = () => ({ provider: 'google-pay', label: 'Google Pay', upiId: '', enabled: true })

const PaymentSettings = () => {
    const [upiOptions, setUpiOptions] = useState([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const loadOptions = async () => {
        setLoading(true)
        setError('')
        setMessage('')
        try {
            const options = await AdminUpiOptions()
            setUpiOptions(options.map(option => ({ ...option, id: option._id || option.id })))
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Could not load UPI settings.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadOptions()
    }, [])

    const updateOption = (index, updates) => {
        setUpiOptions(current => current.map((option, optionIndex) => optionIndex === index ? { ...option, ...updates } : option))
    }

    const changeProvider = (index, provider) => {
        const providerLabel = PROVIDERS.find(option => option.value === provider)?.label || 'UPI App'
        updateOption(index, { provider, label: providerLabel })
    }

    const addOption = () => setUpiOptions(current => [...current, emptyOption()])

    const saveOptions = async () => {
        setSaving(true)
        setError('')
        setMessage('')
        try {
            const savedOptions = await SaveAdminUpiOptions(upiOptions)
            setUpiOptions(savedOptions.map(option => ({ ...option, id: option._id || option.id })))
            setMessage('UPI options saved.')
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Could not save UPI options.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="payment-settings-page">
                    <section className="payment-settings-access">
                        <div>
                            <h2>UPI payment options</h2>
                            <p>Choose the app, payee UPI ID, and display name. Enabled options appear at checkout and open the selected UPI app directly.</p>
                        </div>
                        <div className="payment-settings-key-row">
                    <span className="text-sm font-medium text-slate-700">Admin session active</span>
                    <button type="button" onClick={loadOptions} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
                </div>
            </section>

            {error && <p className="payment-settings-alert error" role="alert">{error}</p>}
            {message && <p className="payment-settings-alert success" role="status">{message}</p>}

                    <section className="payment-settings-list-section">
                        <div className="payment-settings-list-heading">
                            <h3>Configured UPI IDs</h3>
                            <span>{upiOptions.length} options</span>
                        </div>

                        {upiOptions.length === 0 ? (
                            <p className="payment-settings-empty">No UPI options configured yet.</p>
                        ) : (
                            <div className="payment-settings-options">
                                {upiOptions.map((option, index) => (
                                    <div className="payment-settings-option" key={option.id || `upi-${index}`}>
                                        <label className="payment-settings-enabled">
                                            <input type="checkbox" checked={option.enabled !== false} onChange={event => updateOption(index, { enabled: event.target.checked })} />
                                            <span>Enabled</span>
                                        </label>
                                        <label>
                                            <span>App</span>
                                            <select value={option.provider} onChange={event => changeProvider(index, event.target.value)}>
                                                {PROVIDERS.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                                            </select>
                                        </label>
                                        <label>
                                            <span>Display name</span>
                                            <input value={option.label} onChange={event => updateOption(index, { label: event.target.value })} maxLength={60} />
                                        </label>
                                        <label className="payment-settings-vpa-field">
                                            <span>UPI ID</span>
                                            <input value={option.upiId} onChange={event => updateOption(index, { upiId: event.target.value })} placeholder="merchant@bank" maxLength={120} />
                                        </label>
                                        <button className="payment-settings-remove" type="button" onClick={() => setUpiOptions(current => current.filter((_, optionIndex) => optionIndex !== index))}>Remove</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="payment-settings-actions">
                            <button className="secondary" type="button" onClick={addOption}>Add UPI ID</button>
                            <button type="button" onClick={saveOptions} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                        </div>
                    </section>

        </section>
    )
}

export default PaymentSettings