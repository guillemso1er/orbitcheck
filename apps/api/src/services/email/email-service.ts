import type { FastifyBaseLogger } from 'fastify';

export interface EmailService {
    sendAddressFixEmail(params: AddressFixEmailParams): Promise<void>;
}

export interface AddressFixEmailParams {
    shopDomain: string;
    shopName?: string;
    customerEmail: string;
    customerName?: string;
    fixUrl: string;
    orderId: string;
    orderGid: string;
    orderName?: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
}

export class KlaviyoEmailService implements EmailService {
    private apiKey: string;
    private templateId: string;

    constructor(private logger: FastifyBaseLogger, apiKey?: string, templateId?: string) {
        this.apiKey = apiKey || process.env.KLAVIYO_API_KEY || '';
        this.templateId = templateId || process.env.KLAVIYO_TEMPLATE_ID || '';

        if (!this.apiKey) {
            this.logger.warn('KLAVIYO_API_KEY is not set. Klaviyo emails will not be sent.');
        }
    }

    async sendAddressFixEmail(params: AddressFixEmailParams): Promise<void> {
        if (!this.apiKey || !this.templateId) {
            this.logger.warn({ shop: params.shopDomain }, 'Skipping Klaviyo email: Missing API Key or Template ID');
            return;
        }

        try {
            // Using fetch to avoid adding a new dependency if possible, or we could use 'klaviyo-api' package
            // For now, let's assume a direct API call to Klaviyo's v3 API

            const metricName = `OrbitCheck Address Fix Needed`;

            // Inside your try/catch block
            const response = await fetch('https://a.klaviyo.com/api/events', {
                method: 'POST',
                headers: {
                    'Authorization': `Klaviyo-API-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Revision': '2024-02-15'
                },
                body: JSON.stringify({
                    data: {
                        type: 'event',
                        attributes: {
                            metric: {
                                data: {
                                    type: 'metric',
                                    attributes: {
                                        name: metricName
                                    }
                                }
                            },
                            profile: {
                                data: {
                                    type: 'profile',
                                    attributes: {
                                        email: params.customerEmail,
                                        first_name: params.customerName?.split(' ')[0],
                                        last_name: params.customerName?.split(' ').slice(1).join(' '),
                                    }
                                }
                            },
                            properties: {
                                // URLs
                                fix_url: params.fixUrl,
                                customer_name: params.customerName,

                                // Order Details
                                order_id: params.orderId,
                                order_name: params.orderName || `#${params.orderId}`, // Pass the actual name (e.g. #1024) if you have it

                                // Shop Details
                                shop_domain: params.shopDomain,
                                shop_name: params.shopName || params.shopDomain, // Pass the clean name (e.g. "Snowboard Shop")

                                // Address Details (You must add these to your params to display them!)
                                shipping_address: {
                                    address1: params.address1,
                                    address2: params.address2 || '',
                                    city: params.city,
                                    province: params.province,
                                    zip: params.zip,
                                    country: params.country
                                }
                            }
                        }
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Klaviyo API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            this.logger.info({ shop: params.shopDomain, email: params.customerEmail }, 'Sent address fix email via Klaviyo');
        } catch (error) {
            this.logger.error({ err: error, shop: params.shopDomain }, 'Failed to send Klaviyo email');
            // We don't throw here to avoid breaking the webhook flow
        }
    }
}

export class ShopifyFlowEmailService implements EmailService {
    constructor(private logger: FastifyBaseLogger) { }

    async sendAddressFixEmail(params: AddressFixEmailParams): Promise<void> {
        // This service is a no-op because the actual email sending is triggered by 
        // Shopify Flow when it detects the metafield change (which is done in the AddressFixService).
        // We just log here for visibility.
        this.logger.info(
            { shop: params.shopDomain, orderId: params.orderId },
            'Address fix email delegated to Shopify Flow (via metafield update)'
        );
    }
}

export class CompositeEmailService implements EmailService {
    constructor(private services: EmailService[]) { }

    async sendAddressFixEmail(params: AddressFixEmailParams): Promise<void> {
        await Promise.all(this.services.map(s => s.sendAddressFixEmail(params)));
    }
}
