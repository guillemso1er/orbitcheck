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

/**
 * Common email template parameters used by all email services
 */
export interface EmailTemplateParams {
    fixUrl: string;
    customerName?: string;
    orderId: string;
    orderName: string;
    shopDomain: string;
    shopName: string;
    shippingAddress: {
        address1: string;
        address2: string;
        city: string;
        province: string;
        zip: string;
        country: string;
    };
}

/**
 * Base class for email services that provides common functionality
 */
export abstract class BaseEmailService implements EmailService {
    constructor(protected logger: FastifyBaseLogger) { }

    abstract sendAddressFixEmail(params: AddressFixEmailParams): Promise<void>;

    /**
     * Transforms AddressFixEmailParams into standardized template parameters
     */
    protected buildTemplateParams(params: AddressFixEmailParams): EmailTemplateParams {
        return {
            fixUrl: params.fixUrl,
            customerName: params.customerName,
            orderId: params.orderId,
            orderName: params.orderName || `#${params.orderId}`,
            shopDomain: params.shopDomain,
            shopName: params.shopName || params.shopDomain,
            shippingAddress: {
                address1: params.address1,
                address2: params.address2 || '',
                city: params.city,
                province: params.province,
                zip: params.zip,
                country: params.country,
            },
        };
    }

    /**
     * Parses customer name into first and last name components
     */
    protected parseCustomerName(customerName?: string): { firstName?: string; lastName?: string } {
        if (!customerName) {
            return {};
        }
        const parts = customerName.split(' ');
        return {
            firstName: parts[0],
            lastName: parts.slice(1).join(' ') || undefined,
        };
    }
}

export class KlaviyoEmailService extends BaseEmailService {
    private apiKey: string;
    private templateId: string;

    constructor(logger: FastifyBaseLogger, apiKey?: string, templateId?: string) {
        super(logger);
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
            const templateParams = this.buildTemplateParams(params);
            const { firstName, lastName } = this.parseCustomerName(params.customerName);
            const metricName = `OrbitCheck Address Fix Needed`;

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
                                        first_name: firstName,
                                        last_name: lastName,
                                    }
                                }
                            },
                            properties: {
                                fix_url: templateParams.fixUrl,
                                customer_name: templateParams.customerName,
                                order_id: templateParams.orderId,
                                order_name: templateParams.orderName,
                                shop_domain: templateParams.shopDomain,
                                shop_name: templateParams.shopName,
                                shipping_address: templateParams.shippingAddress,
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

export class BrevoEmailService extends BaseEmailService {
    private apiKey: string;
    private templateId: number | null;
    private senderEmail: string;
    private senderName: string;

    constructor(
        logger: FastifyBaseLogger,
        apiKey?: string,
        templateId?: string | number | null,
        senderEmail?: string,
        senderName?: string
    ) {
        super(logger);
        this.apiKey = apiKey || process.env.BREVO_API_KEY || '';

        // Template ID is optional - if not provided or 0, we'll use inline HTML
        if (templateId === null || templateId === undefined) {
            const envTemplateId = process.env.BREVO_TEMPLATE_ID;
            this.templateId = envTemplateId ? parseInt(envTemplateId, 10) : null;
        } else if (typeof templateId === 'number') {
            this.templateId = templateId || null;
        } else {
            this.templateId = parseInt(templateId, 10) || null;
        }

        this.senderEmail = senderEmail || process.env.BREVO_SENDER_EMAIL || '';
        this.senderName = senderName || process.env.BREVO_SENDER_NAME || 'OrbitCheck';

        if (!this.apiKey) {
            this.logger.warn('BREVO_API_KEY is not set. Brevo emails will not be sent.');
        }
    }

    async sendAddressFixEmail(params: AddressFixEmailParams): Promise<void> {
        if (!this.apiKey) {
            this.logger.warn({ shop: params.shopDomain }, 'Skipping Brevo email: Missing API Key');
            return;
        }

        if (!this.senderEmail) {
            this.logger.warn({ shop: params.shopDomain }, 'Skipping Brevo email: Missing Sender Email');
            return;
        }

        try {
            const templateParams = this.buildTemplateParams(params);
            const { firstName, lastName } = this.parseCustomerName(params.customerName);

            // Build the request body - use templateId if available, otherwise use inline HTML
            const requestBody: Record<string, unknown> = {
                to: [
                    {
                        email: params.customerEmail,
                        name: params.customerName,
                    }
                ],
                sender: {
                    email: this.senderEmail,
                    name: this.senderName,
                },
            };

            if (this.templateId) {
                // Use Brevo template
                requestBody.templateId = this.templateId;
                requestBody.params = {
                    FIRSTNAME: firstName,
                    LASTNAME: lastName,
                    CUSTOMER_NAME: templateParams.customerName,
                    CUSTOMER_EMAIL: params.customerEmail,
                    FIX_URL: templateParams.fixUrl,
                    ORDER_ID: templateParams.orderId,
                    ORDER_NAME: templateParams.orderName,
                    SHOP_DOMAIN: templateParams.shopDomain,
                    SHOP_NAME: templateParams.shopName,
                    ADDRESS1: templateParams.shippingAddress.address1,
                    ADDRESS2: templateParams.shippingAddress.address2,
                    CITY: templateParams.shippingAddress.city,
                    PROVINCE: templateParams.shippingAddress.province,
                    ZIP: templateParams.shippingAddress.zip,
                    COUNTRY: templateParams.shippingAddress.country,
                    SHIPPING_ADDRESS: templateParams.shippingAddress,
                };
            } else {
                // Use inline HTML template
                requestBody.subject = `[${templateParams.shopName}] Action Required: Please verify your shipping address for ${templateParams.orderName}`;
                requestBody.htmlContent = this.buildHtmlTemplate(templateParams, params.customerEmail);
            }

            const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json',
                    'accept': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Brevo API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            this.logger.info({ shop: params.shopDomain, email: params.customerEmail, useTemplate: !!this.templateId }, 'Sent address fix email via Brevo');
        } catch (error) {
            this.logger.error({ err: error, shop: params.shopDomain }, 'Failed to send Brevo email');
            // We don't throw here to avoid breaking the webhook flow
        }
    }

    /**
     * Builds an HTML email template for address fix notifications
     */
    private buildHtmlTemplate(params: EmailTemplateParams, customerEmail: string): string {
        const { shippingAddress } = params;
        const customerName = params.customerName || 'Valued Customer';

        // Format the full address for display
        const addressLines = [
            shippingAddress.address1,
            shippingAddress.address2,
            `${shippingAddress.city}, ${shippingAddress.province} ${shippingAddress.zip}`,
            shippingAddress.country,
        ].filter(Boolean);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Verify Your Shipping Address - ${this.escapeHtml(params.shopName)}</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; -webkit-font-smoothing: antialiased;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Main Container -->
                <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    <!-- Shop Header / Branding -->
                    <tr>
                        <td style="padding: 24px 40px; background-color: #18181b; border-radius: 12px 12px 0 0; text-align: center;">
                            <h2 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #ffffff;">
                                ${this.escapeHtml(params.shopName)}
                            </h2>
                            <p style="margin: 0; font-size: 13px; color: #a1a1aa;">
                                ${this.escapeHtml(params.shopDomain)}
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Title Header -->
                    <tr>
                        <td style="padding: 30px 40px 24px; text-align: center; border-bottom: 1px solid #e4e4e7;">
                            <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #18181b;">
                                📦 Shipping Address Verification Needed
                            </h1>
                            <p style="margin: 0; font-size: 14px; color: #71717a;">
                                ${this.escapeHtml(params.orderName)}
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                                Hi ${this.escapeHtml(customerName)},
                            </p>
                            <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                                We were unable to verify the shipping address for your recent order from <strong>${this.escapeHtml(params.shopName)}</strong>. To ensure your package arrives safely, please review and confirm your address.
                            </p>
                            
                            <!-- Order Info Box -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #eff6ff; border-radius: 8px; margin-bottom: 16px;">
                                <tr>
                                    <td style="padding: 16px 20px;">
                                        <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #1e40af;">
                                            <strong>Order:</strong> ${this.escapeHtml(params.orderName)}<br>
                                            <strong>Store:</strong> ${this.escapeHtml(params.shopName)} (${this.escapeHtml(params.shopDomain)})
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Address Box -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #fef3c7; border-radius: 8px; margin-bottom: 24px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #92400e;">
                                            Current Shipping Address
                                        </p>
                                        <p style="margin: 0; font-size: 15px; line-height: 1.5; color: #78350f;">
                                            ${addressLines.map(line => this.escapeHtml(line)).join('<br>')}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- CTA Button -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td align="center" style="padding: 8px 0 24px;">
                                        <a href="${this.escapeHtml(params.fixUrl)}" target="_blank" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; background-color: #2563eb; text-decoration: none; border-radius: 8px; transition: background-color 0.2s;">
                                            Verify My Address
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #71717a;">
                                If you can't click the button, copy and paste this link into your browser:
                            </p>
                            <p style="margin: 0 0 24px; font-size: 13px; line-height: 1.5; color: #2563eb; word-break: break-all;">
                                <a href="${this.escapeHtml(params.fixUrl)}" style="color: #2563eb; text-decoration: underline;">${this.escapeHtml(params.fixUrl)}</a>
                            </p>
                            
                            <!-- Info Box -->
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f5; border-radius: 8px;">
                                <tr>
                                    <td style="padding: 16px 20px;">
                                        <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #52525b;">
                                            <strong>Why am I receiving this?</strong><br>
                                            You placed an order at <strong>${this.escapeHtml(params.shopName)}</strong> and our address verification system detected a potential issue with your shipping address. Verifying your address helps ensure successful delivery of your order.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7; text-align: center;">
                            <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
                                This email was sent to ${this.escapeHtml(customerEmail)} regarding ${this.escapeHtml(params.orderName)} from <strong>${this.escapeHtml(params.shopName)}</strong>
                            </p>
                            <p style="margin: 0 0 8px; font-size: 13px; color: #a1a1aa;">
                                ${this.escapeHtml(params.shopDomain)}
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #d4d4d8;">
                                Address verification powered by <a href="https://orbitcheck.io" style="color: #2563eb; text-decoration: none;">OrbitCheck</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
    }

    /**
     * Escapes HTML special characters to prevent XSS
     */
    private escapeHtml(str: string): string {
        const htmlEscapes: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
    }
}

export class ShopifyFlowEmailService extends BaseEmailService {
    constructor(logger: FastifyBaseLogger) {
        super(logger);
    }

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
