#!/usr/bin/env zx

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse } from 'dotenv';

// ============================================================================
// Utility Functions
// ============================================================================

// Logging utilities
export const log = {
    info: (message) => console.log(`ℹ️  ${message}`),
    success: (message) => console.log(`✅ ${message}`),
    warning: (message) => console.log(`⚠️  ${message}`),
    error: (message) => console.error(`❌ ${message}`),
    die: (message) => {
        console.error(`❌ ${message}`);
        process.exit(1);
    }
};

// Check if a command is available on the system
export async function isCommandAvailable(command) {
    try {
        await $`which ${command}`.quiet();
        return true;
    } catch {
        return false;
    }
}

// Check if a file exists
export async function fileExists(filePath) {
    return existsSync(filePath);
}

// Load environment variables from a file
export async function loadEnvFile(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');
        const parsed = parse(content);

        for (const [key, value] of Object.entries(parsed)) {
            process.env[key] = value;
        }

        log.success(`Loaded ${Object.keys(parsed).length} environment variables from ${filePath}`);
    } catch (error) {
        log.die(`Failed to load environment file '${filePath}': ${error.message}`);
    }
}

// Parse environment file into an object
export async function parseEnvFile(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');
        return parse(content);
    } catch (error) {
        log.die(`Failed to parse environment file '${filePath}': ${error.message}`);
    }
}