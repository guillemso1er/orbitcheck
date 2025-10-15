#!/usr/bin/env zx

import { config, sleep, state, UA_CLIENT_ID, UA_CLIENT_SECRET } from './config.mjs';
import { log } from './utils.mjs';

// ============================================================================
// API Utility Functions
// ============================================================================
export async function retryApiCall(maxRetries, fn) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                log.warning(`API call failed, retrying in ${config.RETRY_DELAY}s... (attempt ${i + 2}/${maxRetries})`);
                await sleep(config.RETRY_DELAY * 1000);
            }
        }
    }
    throw lastError;
}

export async function waitForService(url, timeout = 90) {
    const startTime = Date.now();
    log.info(`Waiting for Infisical to be ready at ${url}...`);

    while ((Date.now() - startTime) / 1000 < timeout) {
        try {
            const response = await fetch(`${url}/api/status`);
            if (response.ok) {
                log.success('Infisical is ready!');
                return;
            }
        } catch (error) {
            // Service not ready yet
        }
        process.stderr.write('.');
        await sleep(2000);
    }

    console.error('');
    log.die('Timeout waiting for Infisical to be ready');
}

export function requireAdmin() {
    if (!state.HAVE_ADMIN && !state.ADMIN_TOKEN) {
        log.die('This operation requires admin auth. Provide INFISICAL_ADMIN_TOKEN or run once with bootstrap.');
    }
}

export async function makeApiRequest(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const finalOptions = { ...options, headers };
    if (finalOptions.body && typeof finalOptions.body === 'object') { finalOptions.body = JSON.stringify(finalOptions.body); }
    const response = await fetch(url, finalOptions);
    const text = await response.text();
    let data; try { data = JSON.parse(text); }
    catch { data = text; }
    return { response, data, status: response.status };
}

// ============================================================================
// Identity Management
// ============================================================================
export async function discoverOrgId() {
    requireAdmin();
    if (state.ORG_ID) return;

    log.info('Discovering organization ID...');

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(`${config.BASE}/api/v1/organizations`, {
            headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` }
        });

        if (result.status !== 200) throw new Error('Failed to fetch organizations');
        return result;
    });

    const org = data.organizations?.find(o => o.name === config.ORG_NAME);
    if (!org) {
        log.die(`Organization '${config.ORG_NAME}' not found`);
    }

    // Set ORG_ID
    state.ORG_ID = org.id;
    log.info(`Found organization ID: ${state.ORG_ID}`);
}

export async function ensureProject() {
    requireAdmin();
    await discoverOrgId();

    log.info(`Checking for project '${config.PROJECT_NAME}'...`);

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(`${config.BASE}/api/v1/projects`, {
            headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` }
        });

        if (result.status !== 200) throw new Error('Failed to fetch projects');
        return result;
    });

    const project = data.projects?.find(p =>
        (p.name || p.projectName) === config.PROJECT_NAME
    );

    if (project) {
        state.PROJECT_ID = project.id || project.projectId || project.workspaceId;
        log.info(`Project exists with ID: ${state.PROJECT_ID}`);
        return;
    }

    log.info(`Creating project '${config.PROJECT_NAME}'...`);

    const { SCRIPT_CONFIG: { SCRIPT_NAME } } = await import('./config.mjs');

    // Try different payload shapes - the API validation error suggests a schema issue
    let createResult;

    // Try without organizationId at all - just name and description
    createResult = await makeApiRequest(`${config.BASE}/api/v1/projects`,
        {
            method: 'POST', headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
            body: {
                projectName: config.PROJECT_NAME,
                projectDescription: `Managed by ${SCRIPT_NAME}`,
                slug: 'orbitcheck',
                type: 'secret-manager',
                shouldCreateDefaultEnvs: true
            }
        });

    // If failed, try with organizationId
    if (!createResult.status.toString().startsWith('2')) {
        log.warning('Create project failed. Retrying with organizationId...');
        log.warning(`First attempt failed with: HTTP ${createResult.status}, data: ${JSON.stringify(createResult.data)}`);

        createResult = await makeApiRequest(`${config.BASE}/api/v1/projects`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
            body: {
                name: config.PROJECT_NAME,
                organizationId: state.ORG_ID,
                description: `Managed by ${SCRIPT_NAME}`
            }
        });
    }

    if (!createResult.status.toString().startsWith('2')) {
        log.error(`Failed to create project (HTTP ${createResult.status})`);
        log.error(`Error response: ${JSON.stringify(createResult.data)}`);
        log.die(`Project creation failed`);
    }

    state.PROJECT_ID = createResult.data?.project?.id ||
        createResult.data?.id || createResult.data?.projectId ||
        createResult.data?.workspace?.id || createResult.data?.workspaceId;

    if (!state.PROJECT_ID) {
        log.die('Project creation response missing ID');
    }

    log.success(`Project created with ID: ${state.PROJECT_ID}`);
}

export async function createReadOnlyIdentity() {
    requireAdmin();
    await discoverOrgId();

    log.info('Setting up read-only machine identity...');

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/identities?orgId=${state.ORG_ID}`,
            { headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch identities');
        return result;
    });

    const identity = data.identities?.find(i => i.name === config.IDENTITY_NAME);

    if (identity) {
        state.IDENTITY_ID = identity.id;
        log.info(`Identity exists with ID: ${state.IDENTITY_ID}`);
    } else {
        log.info(`Creating machine identity '${config.IDENTITY_NAME}'...`);

        const createResult = await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(`${config.BASE}/api/v1/identities`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
                body: {
                    name: config.IDENTITY_NAME,
                    organizationId: state.ORG_ID
                }
            });

            if (result.status !== 200) throw new Error('Failed to create identity');
            return result;
        });

        state.IDENTITY_ID = createResult.data?.identity?.id || createResult.data?.id;
        if (!state.IDENTITY_ID) {
            log.die('Identity creation response missing ID');
        }
        log.success(`Identity created with ID: ${state.IDENTITY_ID}`);
    }

    await ensureIdentityUniversalAuth();
}

export async function assignReadOnlyRole() {
    requireAdmin();

    log.info('Configuring read-only permissions...');

    const rolesResult = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/projects/${state.PROJECT_ID}/roles`,
            { headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch project roles');
        return result;
    });

    const roles = rolesResult.data?.roles || [];

    // Find suitable read-only role
    let roleSlug = roles.find(r => r.slug === 'project_viewer')?.slug;
    if (!roleSlug) {
        roleSlug = roles.find(r => /viewer|read/i.test(r.slug))?.slug;
    }
    if (!roleSlug) {
        const sortedRoles = roles.sort((a, b) =>
            (a.permissions?.length || 0) - (b.permissions?.length || 0)
        );
        roleSlug = sortedRoles[0]?.slug;
    }

    if (!roleSlug) {
        log.die('No suitable read-only role found');
    }

    log.info(`Using role: ${roleSlug}`);

    // Check existing membership
    const membershipsResult = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/projects/${state.PROJECT_ID}/identity-memberships`,
            { headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch memberships');
        return result;
    });

    const isMember = membershipsResult.data?.identityMemberships?.find(
        m => m.identity?.id === state.IDENTITY_ID
    );

    if (!isMember) {
        log.info('Adding identity to project with read-only access...');

        await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(
                `${config.BASE}/api/v1/projects/${state.PROJECT_ID}/identity-memberships/${state.IDENTITY_ID}`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
                    body: {
                        roles: [{
                            role: roleSlug,
                            isTemporary: false
                        }]
                    }
                }
            );
            if (result.status !== 200) throw new Error('Failed to add identity to project');
            return result;
        });

        log.success('Identity added to project with read-only access');
    } else {
        log.info('Identity already has project access');
    }
}

export async function ensureIdentityUniversalAuth(forceRotate = false) {
    requireAdmin();

    const { SCRIPT_NAME, loadUASecretOnly, saveUACredsToFile } = await import('./config.mjs');

    log.info(`Ensuring Universal Auth is configured for identity '${config.IDENTITY_NAME}' (${state.IDENTITY_ID})...`);
    log.info('Attaching Universal Auth to identity (idempotent)...');

    const { data, status } = await makeApiRequest(
        `${config.BASE}/api/v1/auth/universal-auth/identities/${state.IDENTITY_ID}`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
            body: {
                clientSecretTrustedIps: [
                    { ipAddress: '0.0.0.0/0' },
                    { ipAddress: '::/0' }
                ],
                accessTokenTTL: config.TOKEN_TTL
            }
        }
    );

    if (status === 200) {
        log.success('Universal Auth created for identity.');
    } else if (status === 400 && data?.message?.includes('already configured')) {
        log.success('Universal Auth already configured for identity.');
    } else {
        log.die(`Failed to attach Universal Auth to identity (HTTP ${status})`);
    }

    // Retrieve UA details
    log.info('Retrieving Universal Auth details for identity...');

    const uaCheck = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/auth/universal-auth/identities/${state.IDENTITY_ID}`,
            { headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to verify UA configuration');
        return result;
    });

    const clientId = uaCheck.data?.identityUniversalAuth?.clientId || uaCheck.data?.clientId;
    if (!clientId) {
        log.die('Failed to determine clientId for identity');
    }

    const { setUA_CLIENT_ID } = await import('./config.mjs');
    setUA_CLIENT_ID(clientId);

    // Load existing secret if available
    await loadUASecretOnly();

    const needSecret = forceRotate || !UA_CLIENT_SECRET;

    if (needSecret) {
        log.info(`Creating client secret (ttl=${config.UA_SECRET_TTL}s; 0 => omit ttl)...`);

        const secretPayload = {
            description: `Persistent secret for ${config.IDENTITY_NAME} (generated by ${SCRIPT_NAME})`,
            numUsesLimit: 0
        };

        if (config.UA_SECRET_TTL > 0) {
            secretPayload.ttl = config.UA_SECRET_TTL;
        }

        const secretResult = await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(
                `${config.BASE}/api/v1/auth/universal-auth/identities/${state.IDENTITY_ID}/client-secrets`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${state.ADMIN_TOKEN}` },
                    body: secretPayload
                }
            );
            if (result.status !== 200) throw new Error('Failed to create client secret');
            return result;
        });

        const { setUA_CLIENT_SECRET } = await import('./config.mjs');
        setUA_CLIENT_SECRET(secretResult.data?.clientSecret);
        if (!UA_CLIENT_SECRET) {
            log.die('Client secret missing in response');
        }

        await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, state.ORG_ID, state.PROJECT_ID, state.IDENTITY_ID);
    } else {
        log.info('Using existing client secret');
    }
}