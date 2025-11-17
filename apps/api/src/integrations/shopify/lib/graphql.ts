export async function shopifyGraphql(shop: string, accessToken: string, apiVersion: string) {
    const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

    const executeQuery = async (query: string, variables: Record<string, any>) => {
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
        if (json.errors) {
            throw new Error(JSON.stringify(json.errors));
        }
        // Check for user errors in mutations (backwards compatible)
        if (json.data?.tagsAdd?.userErrors?.length) {
            throw new Error(JSON.stringify(json.data.tagsAdd.userErrors));
        }
        return json;
    };

    return {
        mutate: executeQuery,
        query: executeQuery,
    };
}

export const MUT_TAGS_ADD = `
  mutation addTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }`;