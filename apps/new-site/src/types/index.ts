export interface PageMeta {
    title: string;
    description: string;
    canonical?: string;
    ogImage?: string;
}

export interface LayoutProps {
    title?: string;
    description?: string;
    canonical?: string;
    ogImage?: string;
    noIndex?: boolean;
}

export interface HeadProps extends PageMeta {
    noIndex?: boolean;
    structuredData?: object;
}

export interface NavItem {
    label: string;
    href: string;
    isExternal?: boolean;
}

export interface PricingPlan {
    name: string;
    price: number;
    validations: number;
    features: string[];
    isPopular?: boolean;
}

export interface ChangelogEntry {
    date: string;
    version: string;
    title: string;
    description: string;
    changes: string[];
}

export interface ROIFormData {
    email: string;
    company: string;
    platform: string;
    monthly_orders: number;
    consent: boolean;
}

export interface EarlyAccessFormData {
    name: string;
    email: string;
    company?: string;
    orders?: string;
    useCase?: string;
}

export interface ValidationResult {
    isValid: boolean;
    message?: string;
}

export type Theme = 'light' | 'dark';
