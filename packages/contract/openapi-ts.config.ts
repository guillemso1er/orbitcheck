import { defineConfig } from "@hey-api/openapi-ts";


export default defineConfig({
    input: './dist/openapi.v1.json',
    output: 'generated/client',
    client: '@hey-api/client-fetch'
}); 