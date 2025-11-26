/**
 * Maps internal order tags to human-readable Shopify tags
 *
 * Hierarchy:
 * - Status Tags (Workflow): ⏳ Validation: Pending, ✅ Validation: Verified, ❌ Validation: Failed
 * - Risk Tags (Warnings): <emoji> Risk: <specific risk>
 */

import { ORDER_TAGS, VALIDATION_TAGS } from '../../../validation';

// Internal to Shopify display mapping
export const TAG_MAPPING: Record<string, string> = {
    // Status/Workflow tags
    address_fix_needed: VALIDATION_TAGS.PENDING,
    address_fix_confirmed: VALIDATION_TAGS.VERIFIED,
    address_fix_failed: VALIDATION_TAGS.FAILED,

    // Risk tags - Duplicates
    potential_duplicate_customer: ORDER_TAGS.POTENTIAL_DUPLICATE_CUSTOMER,
    potential_duplicate_address: ORDER_TAGS.POTENTIAL_DUPLICATE_ADDRESS,
    duplicate_order: ORDER_TAGS.DUPLICATE_ORDER,

    // Risk tags - Address issues
    po_box_detected: ORDER_TAGS.PO_BOX_DETECTED,
    virtual_address: ORDER_TAGS.VIRTUAL_ADDRESS,
    invalid_address: ORDER_TAGS.INVALID_ADDRESS,

    // Risk tags - Contact issues
    disposable_email: ORDER_TAGS.DISPOSABLE_EMAIL,

    // Risk tags - Order flags
    cod_order: ORDER_TAGS.COD_ORDER,
    high_risk_rto: ORDER_TAGS.HIGH_RISK_RTO,
    high_value_order: ORDER_TAGS.HIGH_VALUE_ORDER,
};

// Reverse mapping for removing tags (Shopify -> internal)
export const REVERSE_TAG_MAPPING: Record<string, string> = Object.fromEntries(
    Object.entries(TAG_MAPPING).map(([internal, shopify]) => [shopify, internal])
);

/**
 * Convert internal tags to Shopify display format
 */
export function mapTagsToShopify(internalTags: string[]): string[] {
    return internalTags.map((tag) => TAG_MAPPING[tag] ?? tag);
}

/**
 * Convert Shopify display tags back to internal format
 */
export function mapTagsFromShopify(shopifyTags: string[]): string[] {
    return shopifyTags.map((tag) => REVERSE_TAG_MAPPING[tag] ?? tag);
}

/**
 * Get all Shopify tags that should be removed when clearing risk/validation state
 */
export function getAllRemovableTags(): string[] {
    return Object.values(TAG_MAPPING);
}
