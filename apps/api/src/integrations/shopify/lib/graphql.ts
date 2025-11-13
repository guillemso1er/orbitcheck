export async function shopifyGraphql(shop: string, accessToken: string, apiVersion: string) {
    const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
    return {
        mutate: async (query: string, variables: Record<string, any>) => {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({ query, variables }),
            });
            if (!res.ok) throw new Error(`GraphQL ${res.status}`);
            const json = await res.json();
            if (json.errors || json.data?.tagsAdd?.userErrors?.length) {
                throw new Error(JSON.stringify(json));
            }
            return json;
        },
    };
}

export const MUT_TAGS_ADD = `
  mutation addTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }`;