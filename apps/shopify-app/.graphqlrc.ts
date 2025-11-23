import { ApiType, shopifyApiProject } from "@shopify/api-codegen-preset";
import { ApiVersion } from "@shopify/shopify-app-react-router/server";
import fs from "fs";
import type { IGraphQLConfig } from "graphql-config";

function getConfig() {
  // Check if there are any GraphQL documents
  const documentPaths = ["./app/**/*.{js,ts,jsx,tsx}", "./app/.server/**/*.{js,ts,jsx,tsx}"];
  const hasDocuments = false; // Temporarily set to false since no documents exist yet

  const config: IGraphQLConfig = {
    projects: {
      default: shopifyApiProject({
        apiType: ApiType.Admin,
        apiVersion: ApiVersion.October25,
        documents: hasDocuments ? documentPaths : [],
        outputDir: "./app/types",
      }),
    },
  };

  let extensions: string[] = [];
  try {
    extensions = fs.readdirSync("./extensions");
  } catch {
    // ignore if no extensions
  }

  for (const entry of extensions) {
    const extensionPath = `./extensions/${entry}`;
    const schema = `${extensionPath}/schema.graphql`;
    if (!fs.existsSync(schema)) {
      continue;
    }
    config.projects[entry] = {
      schema,
      documents: [`${extensionPath}/**/*.graphql`],
    };
  }

  return config;
}

const config = getConfig();

export default config;
