/**
 * ROI Calculator functionality
 * Handles form progress tracking, ROI estimation, and form submission
 */

export interface ROIFormData {
    email: string;
    company: string;
    platform: string;
    monthly_orders: number;
    consent: boolean;
}

function setButtonLoading(loading: boolean): void {
    const submitBtn = document.getElementById('roi-submit-btn') as HTMLButtonElement | null;
    const submitText = document.getElementById('submit-text');
    const submitSpinner = document.getElementById('submit-spinner');

    if (submitBtn) submitBtn.disabled = loading;
    if (submitText) submitText.textContent = loading ? 'Sending...' : 'Get Detailed ROI Report';
    if (submitSpinner) submitSpinner.classList.toggle('hidden', !loading);
}

function updateFormProgress(): void {
    const roiForm = document.getElementById('roi-form');
    const progressBar = document.getElementById('form-progress-bar');
    const progressText = document.getElementById('form-progress-text');

    if (!roiForm) return;

    const inputs = roiForm.querySelectorAll('input[required], select[required]');
    const filledInputs = Array.from(inputs).filter((input: Element) => {
        const inputEl = input as HTMLInputElement;
        if (inputEl.type === 'checkbox') return inputEl.checked;
        return inputEl.value.trim() !== '';
    });

    const progress = Math.round((filledInputs.length / inputs.length) * 100);
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${progress}%`;
}

function updateROIEstimate(): void {
    const monthlyOrdersSelect = document.getElementById('roi-monthly-orders') as HTMLSelectElement | null;
    const roiPreview = document.getElementById('roi-preview');
    const savingsAmount = document.getElementById('savings-amount');

    const orders = parseInt(monthlyOrdersSelect?.value || '0') || 0;

    if (orders > 0) {
        // Average order value $50, 3% failure rate, 40% recovery
        const avgOrderValue = 50;
        const failureRate = 0.03;
        const recoveryRate = 0.4;
        const savings = Math.round(orders * avgOrderValue * failureRate * recoveryRate);

        if (savingsAmount) savingsAmount.textContent = savings.toLocaleString();
        roiPreview?.classList.remove('hidden');
    } else {
        roiPreview?.classList.add('hidden');
    }
}

async function handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const roiForm = document.getElementById('roi-form') as HTMLFormElement | null;
    const notification = document.getElementById('roi-notification');
    const successMessage = document.getElementById('roi-success');

    if (!roiForm) return;

    setButtonLoading(true);

    const formData = new FormData(roiForm);
    const ordersPerMonth = parseInt((formData.get('monthly_orders') as string) || '1000') || 1000;

    // Create a controller for the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
        const response = await fetch('https://api.orbitcheck.io/public/roi/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders_per_month: ordersPerMonth }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            // Show success
            roiForm.classList.add('hidden');
            if (successMessage) successMessage.classList.remove('hidden');
        } else {
            throw new Error(`Request failed with status ${response.status}`);
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('ROI Calculator Error:', error);

        // Show error notification
        if (notification) {
            notification.className =
                'mt-4 p-4 rounded-lg border bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-800 toast';
            notification.textContent = 'Something went wrong. Please try again or contact support@orbitcheck.io';
            notification.classList.remove('hidden');

            setTimeout(() => notification.classList.add('hidden'), 5000);
        }
    } finally {
        // Always reset button state
        setButtonLoading(false);
    }
}

export function initROICalculator(): void {
    const roiForm = document.getElementById('roi-form');
    const monthlyOrdersSelect = document.getElementById('roi-monthly-orders');

    // Set up progress tracking
    roiForm?.querySelectorAll('input, select').forEach((input) => {
        input.addEventListener('input', updateFormProgress);
        input.addEventListener('change', updateFormProgress);
    });

    // Set up ROI estimate updates
    monthlyOrdersSelect?.addEventListener('change', updateROIEstimate);

    // Set up form submission
    roiForm?.addEventListener('submit', handleFormSubmit);
}
