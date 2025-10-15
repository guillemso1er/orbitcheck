#!/usr/bin/env zx

import { log } from './utils.mjs';
import { config, HAVE_ADMIN, ACCESS_TOKEN, PROJECT_ID, ADMIN_TOKEN } from './config.mjs';
import { waitForService } from './api.mjs';
import { loadUACredsFromFile, saveUACredsToFile } from './config.mjs';
import { bootstrapOrLogin, generateTemporaryToken } from './auth.mjs';
import { ensureProject, createReadOnlyIdentity, assignReadOnlyRole } from './api.mjs';

// ============================================================================
//  Script Entry Point
// ============================================================================
export default async function setupInfisica() {
    try {
        await waitForService(config.BASE);

        // Load any existing credentials from file first
        await loadUACredsFromFile();

        // Try to bootstrap or login
        await bootstrapOrLogin();

        if (HAVE_ADMIN) {
            // Admin path: ensure everything exists
            await ensureProject();
            await createReadOnlyIdentity();
            await assignReadOnlyRole();
            const { UA_CLIENT_ID, UA_CLIENT_SECRET, ORG_ID, PROJECT_ID, IDENTITY_ID } = await import('./config.mjs');
            await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, ORG_ID, PROJECT_ID, IDENTITY_ID);
        } else {
            // Non-admin path: use existing credentials
            const { PROJECT_ID: pid, IDENTITY_ID: iid, UA_CLIENT_ID, UA_CLIENT_SECRET } = await import('./config.mjs');
            if (!pid || !iid) {
                if (!UA_CLIENT_ID || !UA_CLIENT_SECRET) {
                    log.die('No admin access and no UA credentials available. Run once with admin credentials or provide UA credentials.');
                }
                log.warning('PROJECT_ID or IDENTITY_ID missing. Will attempt to continue with UA credentials only.');
            }
        }

        // Generate access token
        await generateTemporaryToken();

        // Output results (matching original script format)
        console.log(`${ACCESS_TOKEN} ${PROJECT_ID || ''} ${ADMIN_TOKEN || ''}`);
        return { accessToken: ACCESS_TOKEN, projectId: PROJECT_ID, adminToken: ADMIN_TOKEN };
    } catch (error) {
        log.error(`Unexpected error: ${error.message}`);
        process.exit(1);
    }
}
