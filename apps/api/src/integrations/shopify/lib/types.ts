export type Mode = 'disabled' | 'notify' | 'activated';

export interface ShopSettings {
    mode: Mode;
}

export interface ShopifyOrder {
    id: string;
    admin_graphql_api_id: string;
    contact_email?: string;
    email?: string;
    phone?: string;
    shipping_address?: {
        address1?: string;
        address2?: string;
        city?: string;
        province?: string;
        zip?: string;
        country_code?: string;
        latitude?: number;
        longitude?: number;
        first_name?: string;
        last_name?: string;
        phone?: string;
    };
    total_price?: string;
    current_total_price?: string;
    currency: string;
    gateway?: string;
}

export interface OrderEvaluatePayload {
    order_id: string;
    customer: {
        email?: string;
        phone?: string;
        first_name?: string;
        last_name?: string;
    };
    shipping_address: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
        lat?: number;
        lng?: number;
    };
    total_amount: number;
    currency: string;
    payment_method?: string;
}

export interface OrderEvaluateResponse {
    tags?: string[];
    action?: string;
    risk_score?: number;
}