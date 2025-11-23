# Shopify Flow Templates for Address Fix Workflow

This directory contains example Shopify Flow templates for automating customer communication when address validation fails.

## address-fix-email.json

Sends an email to the customer with a link to confirm or correct their shipping address.

### Trigger
- Order tagged with `address_fix_needed`

### Condition
- Order metafield `orbitcheck.address_fix_url` exists

### Action
- Send email to customer with:
  - Subject: "Please confirm your shipping address"
  - Body: Includes the address fix URL from the metafield
  - Link text: "Confirm or Update Address"

## address-fix-order.json

Tags and notifies staff when an order requires address confirmation.

### Trigger  
- Order tagged with `address_fix_needed`

### Actions
1. Add staff note to order: "Customer address validation failed - awaiting confirmation"
2. Send notification to fulfillment team
3. (Optional) Delay fulfillment until tag is removed

## Setup Instructions

1. Go to **Settings > Apps and sales channels > Shopify Flow** in your Shopify admin
2. Create a new workflow
3. Use the template structure above or import the JSON files
4. Customize email templates and notification settings
5. Activate the workflow

## Metafields Used

- **orbitcheck.address_fix_url** (single_line_text_field): Contains the URL for the customer to confirm/correct their address
- This URL is automatically set by OrbitCheck when an invalid address is detected

## Tags Used

- **address_fix_needed**: Added to orders that require address confirmation
- Automatically removed when customer confirms their address

## Notes

- The address fix URL expires after 7 days
- Customers can choose to keep their original address or use the corrected version
- Fulfillment holds are automatically released after customer confirmation
