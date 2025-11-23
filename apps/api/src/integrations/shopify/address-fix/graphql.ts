/**
 * GraphQL mutations and queries for Shopify address fix workflow
 */

export const MUT_TAGS_REMOVE = `
#graphql
  mutation removeTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
      node {
        id
      }
    }
  }
`;

export const MUT_METAFIELDS_SET = `
#graphql
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MUT_ORDER_UPDATE = `
#graphql
  mutation orderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const QUERY_FULFILLMENT_ORDERS = `
#graphql
  query getFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      fulfillmentOrders(first: 10) {
        edges {
          node {
            id
            status
            assignedLocation {
              name
            }
          }
        }
      }
    }
  }
`;

export const MUT_FULFILLMENT_ORDER_HOLD = `
#graphql
  mutation fulfillmentOrderHold($id: ID!, $reason: FulfillmentHoldReason!, $reasonNotes: String) {
    fulfillmentOrderHold(id: $id, fulfillmentHold: {
      reason: $reason,
      reasonNotes: $reasonNotes
    }) {
      fulfillmentOrder {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MUT_FULFILLMENT_ORDER_RELEASE_HOLD = `
#graphql
  mutation fulfillmentOrderReleaseHold($id: ID!) {
    fulfillmentOrderReleaseHold(id: $id) {
      fulfillmentOrder {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;
