import type { Client } from "@orval/core";

const apiClient: Client = {
  api: {
    input: "./openapi.yaml",
    output: "./src/api-client",
    entrypoint: "index.ts",
    method: "split",
    client: "fetch",
    useOptions: true,
    useUnionTypes: true,
    prettier: true,
    schemas: true,
    mock: false,
    index: true,
    name: "api",
    hooks: {
      beforeRequest: [
        {
          name: "beforeRequest",
          target: "src/hooks/beforeRequest.ts",
          schema: {
            parameters: {
              headers: {
                type: "object",
                properties: {
                  authorization: {
                    type: "string",
                    description: "Bearer token for authentication",
                  },
                },
                required: ["authorization"],
              },
            },
          },
        },
      ],
      afterResponse: [
        {
          name: "afterResponse",
          target: "src/hooks/afterResponse.ts",
        },
      ],
    }

  },
};

export default apiClient;