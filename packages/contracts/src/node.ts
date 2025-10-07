// packages/contracts/src/node.ts

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const openapiPath = join(__dirname, '..', 'openapi.yaml');

// Export the schema only from this file
export const openapiSchema = yaml.load(readFileSync(openapiPath, 'utf8'));