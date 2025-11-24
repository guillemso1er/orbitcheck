import { Address, shopifyAddressFixConfirm, shopifyAddressFixGet, ShopifyAddressFixSession } from '@orbitcheck/contracts';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiClient } from '../utils/api';

// --- Types ---




type SelectionType = 'original' | 'suggested' | 'edit';

// --- Icons ---

const Icons = {
    CheckCircle: ({ className }: { className?: string }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    ),
    AlertTriangle: ({ className }: { className?: string }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    ),
    Edit: ({ className }: { className?: string }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
    ),
    MapPin: ({ className }: { className?: string }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    ),
    Spinner: ({ className }: { className?: string }) => (
        <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    ),
    Copy: ({ className }: { className?: string }) => (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
    )
};

// --- Utils ---

const getAddressFields = (address: Address) => ({
    line1: address.line1 || '',
    line2: address.line2 || '',
    city: address.city || '',
    state: address.state || '',
    postal_code: address.postal_code || '',
    country: address.country || ''
});



const isAddressComplete = (addr: Address | null | undefined): boolean => {
    if (!addr) return false;
    const { line1, city, postal_code, country } = getAddressFields(addr);
    return !!(line1.trim() && city.trim() && postal_code.trim() && country.trim());
};

// --- Sub-Components ---

const StatusScreen: React.FC<{
    type: 'loading' | 'error' | 'success';
    message?: string;
    onRetry?: () => void;
}> = ({ type, message, onRetry }) => {
    const content = {
        loading: {
            icon: <Icons.Spinner className="h-10 w-10 text-blue-600" />,
            title: "Verifying Details...",
            bg: "bg-blue-50 dark:bg-blue-900/20",
        },
        error: {
            icon: <Icons.AlertTriangle className="h-10 w-10 text-red-600" />,
            title: "Something went wrong",
            bg: "bg-red-50 dark:bg-red-900/20",
        },
        success: {
            icon: <Icons.CheckCircle className="h-10 w-10 text-emerald-600" />,
            title: "Address Confirmed!",
            bg: "bg-emerald-50 dark:bg-emerald-900/20",
        }
    };
    const current = content[type];

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
            <div className="w-full max-w-md bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 text-center">
                <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5 ${current.bg}`}>
                    {current.icon}
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{current.title}</h2>
                {message && <p className="text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">{message}</p>}
                {type === 'error' && onRetry && (
                    <button onClick={onRetry} className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 text-white font-medium rounded-xl transition-colors">
                        Try Again
                    </button>
                )}
            </div>
        </div>
    );
};

const FormattedAddressBlock: React.FC<{ address: Address }> = ({ address }) => {
    const { line1, line2, city, state, postal_code, country } = getAddressFields(address);
    const cityLine = [city, state, postal_code].filter(part => part && part.trim().length > 0).join(', ');

    return (
        <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300 ml-1 mt-1">
            <p className="font-semibold text-base text-gray-900 dark:text-white">{line1}</p>
            {line2 && <p className="text-gray-500 dark:text-gray-400">{line2}</p>}
            <p>{cityLine}</p>
            <p className="uppercase tracking-wider text-xs font-bold text-gray-500 dark:text-gray-500 pt-1">{country}</p>
        </div>
    );
};

const AddressCard: React.FC<{
    type: SelectionType;
    title: string;
    address: Address | null;
    selected: boolean;
    onSelect: () => void;
    badge?: React.ReactNode;
    disabled?: boolean;
}> = ({ type, title, address, selected, onSelect, badge, disabled }) => {
    if (type !== 'edit' && !address) return null;

    const styles = {
        original: {
            activeBorder: 'border-amber-500 ring-1 ring-amber-500 bg-amber-50/30 dark:bg-amber-900/10',
            baseBorder: 'border-gray-200 dark:border-gray-700 hover:border-amber-300',
            iconColor: 'text-amber-500',
            iconBg: 'bg-amber-100 dark:bg-amber-900/30'
        },
        suggested: {
            activeBorder: 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/10',
            baseBorder: 'border-gray-200 dark:border-gray-700 hover:border-emerald-300',
            iconColor: 'text-emerald-500',
            iconBg: 'bg-emerald-100 dark:bg-emerald-900/30'
        },
        edit: {
            activeBorder: 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30 dark:bg-blue-900/10',
            baseBorder: 'border-gray-200 dark:border-gray-700 hover:border-blue-300',
            iconColor: 'text-blue-500',
            iconBg: 'bg-blue-100 dark:bg-blue-900/30'
        }
    };

    const style = styles[type];
    const fields = address ? getAddressFields(address) : { line1: '', line2: '', city: '', state: '', postal_code: '', country: '' };

    return (
        <div
            role="radio"
            aria-checked={selected}
            onClick={!disabled ? onSelect : undefined}
            className={`
                relative w-full group cursor-pointer rounded-xl border p-5 transition-all duration-200
                ${selected ? style.activeBorder : style.baseBorder}
                ${!selected ? 'bg-white dark:bg-gray-800' : ''}
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${style.iconBg} ${style.iconColor}`}>
                        {type === 'original' && <Icons.AlertTriangle className="w-5 h-5" />}
                        {type === 'suggested' && <Icons.CheckCircle className="w-5 h-5" />}
                        {type === 'edit' && <Icons.Edit className="w-5 h-5" />}
                    </div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-base">{title}</h3>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors mt-1
                    ${selected
                        ? 'border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400'
                        : 'border-gray-300 dark:border-gray-600'
                    }
                `}>
                    {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
            </div>

            {/* LOGIC CHANGED: Render Inputs for Original Type, Text for Suggested */}
            {type === 'original' && address ? (
                <div className="grid grid-cols-2 gap-3 mt-2 pointer-events-none">
                    <AddressInput label="Address Line 1" name="line1" value={fields.line1} readOnly />
                    <AddressInput label="Address Line 2" name="line2" value={fields.line2} readOnly />
                    <AddressInput label="City" name="city" value={fields.city} width="half" readOnly />
                    <AddressInput label="State" name="state" value={fields.state} width="half" readOnly />
                    <AddressInput label="ZIP Code" name="postal_code" value={fields.postal_code} width="half" readOnly />
                    <AddressInput label="Country" name="country" value={fields.country} width="half" readOnly />
                </div>
            ) : address ? (
                <FormattedAddressBlock address={address} />
            ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 ml-1 leading-relaxed">
                    Create a new address manually if the options above are incorrect.
                </p>
            )}

            {badge && (
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50 flex items-center">
                    {badge}
                </div>
            )}
        </div>
    );
};

// FIXED: Moved AddressInput OUTSIDE of AddressForm
const AddressInput: React.FC<{
    label: string;
    name: keyof Address;
    value: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; // Made optional
    error?: boolean;
    required?: boolean;
    width?: "full" | "half";
    readOnly?: boolean; // Added prop
}> = ({ label, name, value, onChange, error, required, width = "full", readOnly }) => (
    <div className={width === "half" ? "col-span-1" : "col-span-2"}>
        <label className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
            <span>{label}</span>
            {required && !readOnly && <span className="text-red-400 text-[10px] font-normal bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded">Required</span>}
        </label>
        <input
            type="text"
            name={name}
            value={value || ''}
            onChange={onChange}
            readOnly={readOnly}
            disabled={readOnly}
            autoComplete={readOnly ? 'off' : (name === 'postal_code' ? 'postal-code' : name === 'line1' ? 'address-line1' : 'off')}
            className={`
                block w-full h-11 px-3 rounded-lg shadow-sm text-sm transition-all duration-200
                ${readOnly
                    ? 'bg-gray-100 dark:bg-gray-800/80 text-gray-600 dark:text-gray-400 cursor-not-allowed border-transparent'
                    : 'bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                }
                ${error && !readOnly ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20 dark:border-red-800' : ''}
                ${!readOnly ? 'border' : ''}
            `}
        />
    </div>
);

const AddressForm: React.FC<{
    data: Address;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onCopy: () => void;
    errors?: Record<string, boolean>;
}> = ({ data, onChange, onCopy, errors }) => {
    return (
        <div className="mt-6 bg-white dark:bg-gray-900 p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm animate-fadeIn">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
                <h4 className="font-bold text-gray-900 dark:text-white">Enter Details</h4>
                <button
                    type="button"
                    onClick={onCopy}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center hover:text-blue-700 transition-colors bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full"
                >
                    <Icons.Copy className="w-3 h-3 mr-1.5" />
                    Copy Original
                </button>
            </div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-6">
                <AddressInput
                    label="Address Line 1"
                    name="line1"
                    value={data.line1 || ''}
                    onChange={onChange}
                    error={errors?.line1}
                    required
                />
                <AddressInput
                    label="Address Line 2"
                    name="line2"
                    value={data.line2 || ''}
                    onChange={onChange}
                />
                <AddressInput
                    label="City"
                    name="city"
                    value={data.city || ''}
                    onChange={onChange}
                    error={errors?.city}
                    required
                    width="half"
                />
                <AddressInput
                    label="State / Province"
                    name="state"
                    value={data.state || ''}
                    onChange={onChange}
                    width="half"
                />
                <AddressInput
                    label="ZIP / Postal Code"
                    name="postal_code"
                    value={data.postal_code || ''}
                    onChange={onChange}
                    error={errors?.postal_code}
                    required
                    width="half"
                />
                <AddressInput
                    label="Country Code"
                    name="country"
                    value={data.country || ''}
                    onChange={onChange}
                    error={errors?.country}
                    required
                    width="half"
                />
            </div>
        </div>
    );
};

// --- Main Page Component ---

const AddressFixPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const apiClient = useApiClient();

    const [session, setSession] = useState<ShopifyAddressFixSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [selectedOption, setSelectedOption] = useState<SelectionType>('suggested');
    const [editedAddress, setEditedAddress] = useState<Address>({});
    const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!token) {
            setError('Invalid or missing access token.');
            setLoading(false);
            return;
        }

        const fetchSession = async () => {
            try {
                const { data, error } = await shopifyAddressFixGet({
                    client: apiClient,
                    path: { token }
                });

                if (error) throw new Error((error as any).message || 'Unable to retrieve session.');

                if (data) {
                    setSession(data as ShopifyAddressFixSession);

                    // Intelligent Defaulting
                    const validSuggestion = isAddressComplete(data.normalized_address);

                    if (validSuggestion) {
                        setSelectedOption('suggested');
                    } else {
                        setSelectedOption('edit');
                        setEditedAddress(data.original_address);
                    }
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load address details.');
            } finally {
                setLoading(false);
            }
        };

        fetchSession();
    }, [token, apiClient]);

    const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEditedAddress(prev => ({ ...prev, [name]: value }));
        if (formErrors[name]) {
            setFormErrors(prev => ({ ...prev, [name]: false }));
        }
    };

    const handleCopyOriginal = () => {
        if (session?.original_address) {
            setEditedAddress(session.original_address);
            setFormErrors({});
        }
    };

    const handleConfirm = async () => {
        if (!session || !token) return;

        if (selectedOption === 'edit') {
            const fields = getAddressFields(editedAddress);
            const newErrors: Record<string, boolean> = {};
            if (!fields.line1) newErrors.line1 = true;
            if (!fields.city) newErrors.city = true;
            if (!fields.postal_code) newErrors.postal_code = true;
            if (!fields.country) newErrors.country = true;

            if (Object.keys(newErrors).length > 0) {
                setFormErrors(newErrors);
                return;
            }
        }

        setSubmitting(true);
        setError(null);

        try {
            const { error } = await shopifyAddressFixConfirm({
                client: apiClient,
                path: { token },
                body: {
                    shop_domain: session.shop_domain,
                    use_corrected: selectedOption === 'suggested',
                    address: selectedOption === 'edit' ? editedAddress : undefined
                }
            });

            if (error) {
                const errData = error as any;
                // The API returns { error: { code: ..., message: ... } }
                // So we need to check if errData.error exists
                const apiError = errData.error || errData;

                if (apiError.code === 'ADDRESS_VALIDATION_FAILED') {
                    const reasons = apiError.details?.reasons?.join(', ');
                    const message = apiError.message || 'The provided address could not be validated.';
                    throw new Error(reasons ? `Address validation failed: ${reasons}` : message);
                }
                throw new Error(apiError.message || 'Confirmation failed.');
            }
            setSuccess(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred while confirming.');
            setSubmitting(false);
        }
    };

    if (loading) return <StatusScreen type="loading" />;
    if (error && !session) return <StatusScreen type="error" message={error} onRetry={() => window.location.reload()} />;
    if (success) return <StatusScreen type="success" message="Your order will be processed with the updated address." />;
    if (!session) return null;

    const hasValidSuggestion = isAddressComplete(session.normalized_address);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8 font-sans selection:bg-blue-100 dark:selection:bg-blue-900">
            <div className="max-w-3xl mx-auto">

                <div className="text-center mb-10 animate-fadeInDown">
                    <div className="inline-flex items-center justify-center p-4 bg-white dark:bg-gray-900 rounded-2xl shadow-sm mb-6">
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl text-blue-600 dark:text-blue-400">
                            <Icons.MapPin className="w-8 h-8" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight sm:text-4xl mb-3">
                        Verify Shipping Address
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
                        We noticed a potential issue with your address. Please verify your details to ensure accurate delivery.
                    </p>
                </div>

                <div className="space-y-6 animate-fadeInUp">

                    <div className={`grid grid-cols-1 gap-6 ${hasValidSuggestion ? 'md:grid-cols-2' : 'md:grid-cols-1 max-w-xl mx-auto'}`}>

                        <AddressCard
                            type="original"
                            title="Original Input"
                            address={session.original_address}
                            selected={selectedOption === 'original'}
                            onSelect={() => setSelectedOption('original')}
                            badge={
                                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center">
                                    <Icons.AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                                    Unverified Format
                                </span>
                            }
                        />

                        {hasValidSuggestion && (
                            <AddressCard
                                type="suggested"
                                title="Recommended Fix"
                                address={session.normalized_address}
                                selected={selectedOption === 'suggested'}
                                onSelect={() => setSelectedOption('suggested')}
                                badge={
                                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
                                        <Icons.CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                                        Standardized Format
                                    </span>
                                }
                            />
                        )}
                    </div>

                    <div className="max-w-xl mx-auto w-full">
                        <AddressCard
                            type="edit"
                            title="Edit Manually"
                            address={null}
                            selected={selectedOption === 'edit'}
                            onSelect={() => setSelectedOption('edit')}
                        />

                        <div className={`transition-all duration-500 ease-in-out overflow-hidden ${selectedOption === 'edit' ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                            <AddressForm
                                data={editedAddress}
                                onChange={handleEditChange}
                                onCopy={handleCopyOriginal}
                                errors={formErrors}
                            />
                        </div>
                    </div>

                    <div className="mt-8 pt-8 flex flex-col items-center gap-4">
                        {error && (
                            <div className="w-full max-w-xl p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm text-center">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleConfirm}
                            disabled={submitting}
                            className={`
                                w-full max-w-md px-8 py-4 rounded-xl font-bold text-white text-lg shadow-lg shadow-blue-600/20
                                transition-all duration-200 transform focus:outline-none focus:ring-4 focus:ring-blue-500/30
                                ${submitting
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0'
                                }
                            `}
                        >
                            <span className="flex items-center justify-center gap-2">
                                {submitting && <Icons.Spinner className="w-5 h-5" />}
                                {submitting ? 'Processing...' : 'Confirm Address'}
                            </span>
                        </button>
                    </div>

                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes fadeInDown { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
                .animate-fadeIn { animation: fadeIn 0.4s ease-out forwards; }
                .animate-fadeInDown { animation: fadeInDown 0.6s ease-out forwards; }
                .animate-fadeInUp { animation: fadeInUp 0.6s ease-out forwards; }
            `}</style>
        </div>
    );
};

export default AddressFixPage;