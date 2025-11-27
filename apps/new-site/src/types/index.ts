export interface PageMeta {
    title: string;
    description: string;
    canonical?: string;
    ogImage?: string;
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

export type Theme = 'light' | 'dark';
