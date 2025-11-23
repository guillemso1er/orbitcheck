import { shopifyAddressFixConfirm, shopifyAddressFixGet } from '@orbitcheck/contracts';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiClient } from '../utils/api';

interface Address {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country_code?: string;
    first_name?: string;
    last_name?: string;
    // Mapping for ContractAddress (API response)
    line1?: string;
    line2?: string;
    state?: string;
    postal_code?: string;
    country?: string;
}

interface AddressFixSession {
    id: string;
    shop_domain: string;
    original_address: Address;
    normalized_address: Address | null;
    fix_status: 'pending' | 'confirmed' | 'cancelled';
}

const AddressFixPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const [session, setSession] = useState<AddressFixSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [selectedOption, setSelectedOption] = useState<'original' | 'suggested' | 'edit'>('suggested');
    const [editedAddress, setEditedAddress] = useState<Address>({
        address1: '',
        address2: '',
        city: '',
        province: '',
        zip: '',
        country_code: '',
        first_name: '',
        last_name: ''
    });
    const apiClient = useApiClient();

    useEffect(() => {
        if (!token) {
            setError('Invalid link. Please check your email and try again.');
            setLoading(false);
            return;
        }

        const fetchSession = async () => {
            try {
                const { data, error } = await shopifyAddressFixGet({
                    client: apiClient,
                    path: { token }
                });

                if (error) {
                    throw new Error((error as any).message || 'Session not found or expired');
                }

                if (data) {
                    const sessionData = data as unknown as AddressFixSession;
                    setSession(sessionData);
                    // Initialize edited address with original address
                    setEditedAddress(sessionData.original_address);

                    // Default to 'edit' if no suggestion available
                    if (!sessionData.normalized_address) {
                        setSelectedOption('edit');
                    }
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load address details');
            } finally {
                setLoading(false);
            }
        };

        fetchSession();
    }, [token, apiClient]);

    const [validationError, setValidationError] = useState<string | null>(null);

    const validateAddress = (addr: Address): boolean => {
        if (!addr.address1?.trim()) return false;
        if (!addr.city?.trim()) return false;
        if (!addr.zip?.trim()) return false;
        if (!addr.country_code?.trim()) return false;
        return true;
    };

    const handleConfirm = async () => {
        if (!session || !token) return;

        setValidationError(null);
        setError(null);

        if (selectedOption === 'edit') {
            if (!validateAddress(editedAddress)) {
                setValidationError('Please fill in all required fields (Address 1, City, Zip, Country Code).');
                return;
            }
        }

        setSubmitting(true);
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
                console.error('API Error:', error);
                throw new Error((error as any).message || 'Failed to confirm address. Please try again.');
            }

            setSuccess(true);
        } catch (err) {
            console.error('Confirmation error:', err);
            setError(err instanceof Error ? err.message : 'Failed to confirm address');
        } finally {
            setSubmitting(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEditedAddress(prev => ({
            ...prev,
            [name]: value
        }));
        // Clear validation error on edit
        if (validationError) setValidationError(null);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Error</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Address Confirmed</h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        Thank you! Your order will be processed with the confirmed address.
                    </p>
                </div>
            </div>
        );
    }

    if (!session) return null;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">
                        Verify Shipping Address
                    </h1>
                    <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
                        We found a potential issue with your shipping address. Please review the suggestion below to ensure accurate delivery.
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-800 shadow-xl rounded-2xl overflow-hidden">
                    <div className="p-6 sm:p-10">
                        <div className={`grid ${session.normalized_address ? 'md:grid-cols-2' : 'grid-cols-1'} gap-8`}>
                            {/* Original Address */}
                            <div
                                className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${selectedOption === 'original'
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'
                                    }`}
                                onClick={() => setSelectedOption('original')}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Original Address</h3>
                                    {selectedOption === 'original' && (
                                        <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                                    <p>{session.original_address.address1 || session.original_address.line1}</p>
                                    {session.original_address.address2 || session.original_address.line2 ? <p>{session.original_address.address2 || session.original_address.line2}</p> : null}
                                    <p>
                                        {session.original_address.city}, {session.original_address.province || session.original_address.state} {session.original_address.zip || session.original_address.postal_code}
                                    </p>
                                    <p>{session.original_address.country_code || session.original_address.country}</p>
                                </div>
                                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium flex items-center">
                                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                        May cause delivery issues
                                    </span>
                                </div>
                            </div>

                            {/* Suggested Address */}
                            {session.normalized_address && (
                                <div
                                    className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${selectedOption === 'suggested'
                                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700'
                                        }`}
                                    onClick={() => setSelectedOption('suggested')}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Suggested Address</h3>
                                        {selectedOption === 'suggested' && (
                                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-1 text-gray-600 dark:text-gray-300">
                                        <p>{session.normalized_address.address1 || session.normalized_address.line1}</p>
                                        {session.normalized_address.address2 || session.normalized_address.line2 ? <p>{session.normalized_address.address2 || session.normalized_address.line2}</p> : null}
                                        <p>
                                            {session.normalized_address.city}, {session.normalized_address.province || session.normalized_address.state} {session.normalized_address.zip || session.normalized_address.postal_code}
                                        </p>
                                        <p>{session.normalized_address.country_code || session.normalized_address.country}</p>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <span className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center">
                                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Recommended
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Edit Address Option */}
                        <div className="mt-8">
                            <div
                                className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 ${selectedOption === 'edit'
                                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700'
                                    }`}
                                onClick={() => setSelectedOption('edit')}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Address Manually</h3>
                                    {selectedOption === 'edit' && (
                                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                    )}
                                </div>

                                {selectedOption === 'edit' && (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Address Line 1 *</label>
                                            <input
                                                type="text"
                                                name="address1"
                                                value={editedAddress.address1}
                                                onChange={handleInputChange}
                                                className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${!editedAddress.address1 && validationError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'} dark:bg-gray-700 dark:border-gray-600 dark:text-white`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Address Line 2</label>
                                            <input
                                                type="text"
                                                name="address2"
                                                value={editedAddress.address2 || ''}
                                                onChange={handleInputChange}
                                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">City *</label>
                                            <input
                                                type="text"
                                                name="city"
                                                value={editedAddress.city}
                                                onChange={handleInputChange}
                                                className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${!editedAddress.city && validationError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'} dark:bg-gray-700 dark:border-gray-600 dark:text-white`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">State/Province</label>
                                            <input
                                                type="text"
                                                name="province"
                                                value={editedAddress.province || ''}
                                                onChange={handleInputChange}
                                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">ZIP/Postal Code *</label>
                                            <input
                                                type="text"
                                                name="zip"
                                                value={editedAddress.zip}
                                                onChange={handleInputChange}
                                                className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${!editedAddress.zip && validationError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'} dark:bg-gray-700 dark:border-gray-600 dark:text-white`}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Country Code *</label>
                                            <input
                                                type="text"
                                                name="country_code"
                                                value={editedAddress.country_code}
                                                onChange={handleInputChange}
                                                className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${!editedAddress.country_code && validationError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'} dark:bg-gray-700 dark:border-gray-600 dark:text-white`}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {validationError && (
                            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center">
                                <svg className="w-5 h-5 text-red-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-red-600 dark:text-red-400 text-sm font-medium">{validationError}</span>
                            </div>
                        )}

                        <div className="mt-10 flex justify-center">
                            <button
                                onClick={handleConfirm}
                                disabled={submitting}
                                className={`
                  w-full sm:w-auto px-8 py-4 rounded-xl text-lg font-bold text-white shadow-lg transform transition-all duration-200
                  ${submitting
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:scale-105 hover:shadow-xl'
                                    }
                `}
                            >
                                {submitting ? 'Processing...' : `Confirm ${selectedOption === 'suggested' ? 'Suggested' : selectedOption === 'edit' ? 'Edited' : 'Original'} Address`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AddressFixPage;
