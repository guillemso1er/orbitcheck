#!/usr/bin/env zx

import { config, state, UA_CLIENT_ID, UA_CLIENT_SECRET } from './config.mjs';
import { waitForService, retryApiCall, makeApiRequest, ensureIdentityUniversalAuth } from './api.mjs';
import { loadUACredsFromFile, saveUACredsToFile } from './config.mjs';
import { log } from './utils.mjs';

// ============================================================================
// Authentication Functions
// ============================================================================
export async function bootstrapOrLogin() {
    log.info('Checking instance status and obtaining credentials...');

    // Try to use existing admin token from env first
    if (config.ADMIN_TOKEN_ENV) {
        state.ADMIN_TOKEN = config.ADMIN_TOKEN_ENV;
        state.HAVE_ADMIN = true;
        log.info('Using admin token from environment.');

        // Try to get ORG_ID if we don't have it
        if (!state.ORG_ID) {
            try {
                const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
                    return await makeApiRequest(`${config.BASE}/api/v1/organizations`, {
                        headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` }
                    });
                });

                if (data?.organizations) {
                    const org = data.organizations.find(o => o.name === config.ORG_NAME);
                    if (org) {
                        state.ORG_ID = org.id;
                    }
                }
            } catch {
                // Continue without ORG_ID
            }
        }
        return;
    }

    // Try bootstrap
    log.info('Attempting to bootstrap instance (will skip if already initialized)...');

    try {
        const { data, status } = await makeApiRequest(`${config.BASE}/api/v1/admin/bootstrap`, {
            method: 'POST',
            body: {
                email: config.ADMIN_EMAIL,
                password: config.ADMIN_PASSWORD,
                organization: config.ORG_NAME
            }
        });

        if (status === 200) {
            state.ADMIN_TOKEN = data?.identity?.credentials?.token || data?.token || data?.accessToken || '';
            state.ORG_ID = data?.organization?.id || '';

            if (state.ADMIN_TOKEN && state.ORG_ID) {
                log.success('Bootstrapped instance and obtained admin token.');
                state.HAVE_ADMIN = true;
                return;
            }
        }

        if (data?.message?.includes('already been set up')) {
            log.info('Instance already initialized.');
        } else {
            log.info(`Bootstrap returned HTTP ${status} (instance may already be initialized).`);
        }
    } catch (error) {
        log.info('Bootstrap failed (instance may already be initialized).');
    }

    // No admin token available, will work with UA credentials only
    state.HAVE_ADMIN = false;
    await loadUACredsFromFile();

    if (UA_CLIENT_ID && UA_CLIENT_SECRET) {
        log.info('Will use UA credentials for access token (no admin auth available).');
    } else {
        log.warning('No admin token or UA credentials available. Will attempt to continue...');
    }
}

export async function generateTemporaryToken() {
    log.info('Generating access token using Universal Auth credentials...');

    await loadUACredsFromFile();

    if (state.HAVE_ADMIN) {
        if (state.IDENTITY_ID) {
            await ensureIdentityUniversalAuth();
        }
    }

    if (!UA_CLIENT_ID) {
        log.die(`UA clientId missing. Run with admin credentials first or set in ${UA_CRED_FILE}.`);
    }
    if (!UA_CLIENT_SECRET) {
        log.die(`UA clientSecret missing. Run with admin credentials first or set in ${UA_CRED_FILE}.`);
    }

    log.info('Attempting to generate token with Universal Auth...');
    log.info(` >> URL: ${config.BASE}/api/v1/auth/universal-auth/login`);

    try {
        const { data, status } = await makeApiRequest(
            `${config.BASE}/api/v1/auth/universal-auth/login`,
            {
                method: 'POST',
                body: {
                    clientId: UA_CLIENT_ID,
                    clientSecret: UA_CLIENT_SECRET
                }
            }
        );

        if (status.toString().startsWith('2')) {
            state.ACCESS_TOKEN = data?.accessToken;
            if (!state.ACCESS_TOKEN) {
                log.die('UA login successful but accessToken missing');
            }
            log.success('Access token generated');

            // Ensure UA credentials are saved to file
            const { saveUACredsToFile } = await import('./config.mjs');
            await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, state.ORG_ID, state.PROJECT_ID, state.IDENTITY_ID);

            return;
        }

        if (status === 401 && state.HAVE_ADMIN) {
            if (state.IDENTITY_ID) {
                log.warning('UA login 401 with admin available. Rotating client secret and retrying...');
                await ensureIdentityUniversalAuth(true);
                await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, state.ORG_ID, state.PROJECT_ID, state.IDENTITY_ID);

                // Retry
                const retryResult = await makeApiRequest(
                    `${config.BASE}/api/v1/auth/universal-auth/login`,
                    {
                        method: 'POST',
                        body: {
                            clientId: UA_CLIENT_ID,
                            clientSecret: UA_CLIENT_SECRET
                        }
                    }
                );

                if (retryResult.status.toString().startsWith('2')) {
                    state.ACCESS_TOKEN = retryResult.data?.accessToken;
                    if (!state.ACCESS_TOKEN) {
                        log.die('UA login successful on retry but accessToken missing');
                    }
                    log.success('Access token generated after secret rotation');

                    // Ensure UA credentials are saved to file after secret rotation
                    const { saveUACredsToFile } = await import('./config.mjs');
                    await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, state.ORG_ID, state.PROJECT_ID, state.IDENTITY_ID);

                    return;
                }
            }
        }

        log.die(`Failed to obtain access token. Status: ${status}`);
    } catch (error) {
        log.error('Connection error during token generation:');
        console.error(error);
        log.die('Failed to connect to Infisical API');
    }
}