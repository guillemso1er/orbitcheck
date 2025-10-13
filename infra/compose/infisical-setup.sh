#!/bin/bash

set -e

# Install required packages
echo "Installing required packages..."
apk add --no-cache jq curl

BASE="http://infisical-backend:8080"

echo "Waiting for Infisical to be ready..."
while ! curl -s "$BASE/" > /dev/null; do
  echo "Infisical not ready, waiting..."
  sleep 5
done

echo "Bootstrapping Infisical instance..."
curl -s -X POST "$BASE/api/v1/admin/bootstrap" \
-H "Content-Type: application/json" \
-d '{"email":"admin@orbicheck.local","password":"AdminPass123!","organization":"orbicheck"}' \
| tee bootstrap.json

# Check if bootstrap was successful
if ! jq -e '.identity' bootstrap.json > /dev/null 2>&1; then
  echo "Bootstrap failed! Response:"
  cat bootstrap.json
  exit 1
fi

ADMIN_TOKEN=$(jq -r '.identity.credentials.token' bootstrap.json)
ORG_ID=$(jq -r '.organization.id' bootstrap.json)

echo "Bootstrap successful. Admin token: ${ADMIN_TOKEN:0:20}..."

echo "Creating project..."
curl -s -X POST "$BASE/api/v1/projects" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"projectName":"orbicheck-api","projectDescription":"OrbiCheck API service","shouldCreateDefaultEnvs":true}' \
| tee project.json

# (optional) validate the role slug exists; if not, use "developer"
# curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/roles" | jq -r '.roles[].slug'


# Check if project creation was successful
if ! jq -e '.project' project.json > /dev/null 2>&1; then
  echo "Project creation failed! Response:"
  cat project.json
  exit 1
fi

PROJECT_ID=$(jq -r '.project.id' project.json)

echo "Project created successfully. Project ID: $PROJECT_ID"

echo "Creating machine identity..."
curl -s -X POST "$BASE/api/v1/identities" \
-H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
-d "{\"name\":\"orbicheck-api\",\"organizationId\":\"$ORG_ID\",\"role\":\"no-access\"}" \
| tee id.json

# Check if identity creation was successful
if ! jq -e '.identity' id.json > /dev/null 2>&1; then
  echo "Identity creation failed! Response:"
  cat id.json
  exit 1
fi

IDENTITY_ID=$(jq -r '.identity.id' id.json)

echo "Identity created successfully. Identity ID: $IDENTITY_ID"

echo "Fetching project roles..."
ROLES_JSON=$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/roles") || {
  echo "Failed to fetch roles"; echo "Response:"; echo "$ROLES_JSON"; exit 1; }

# Prefer a slug that ends with 'developer' or '-developer'; otherwise first slug
ROLE_SLUG=$(echo "$ROLES_JSON" | jq -r '.roles[] | select(.slug | test("(^|-)developer$")) | .slug' | head -n1)
if [ -z "$ROLE_SLUG" ]; then
  ROLE_SLUG=$(echo "$ROLES_JSON" | jq -r '.roles[0].slug // empty')
fi

if [ -z "$ROLE_SLUG" ]; then
  echo "No role slugs found in roles response:"; echo "$ROLES_JSON"; exit 1
fi

echo "Adding identity to project with role: $ROLE_SLUG"
curl -s -X POST "$BASE/api/v1/projects/$PROJECT_ID/identity-memberships/$IDENTITY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"roles\":[{\"role\":\"$ROLE_SLUG\",\"isTemporary\":false}]}" | jq .

echo "Attaching Universal Auth to identity..."
curl -s -X POST "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{}' | jq .  # minimal body is fine

echo "Issuing Universal Auth client secret..."
curl -s -X POST "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"orbicheck-api bootstrap","numUsesLimit":0,"ttl":0}' | tee ua.json

echo "Retrieving Universal Auth client ID..."
curl -s -X GET "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | tee ua_identity.json

CLIENT_SECRET=$(jq -r '.clientSecret' ua.json)
CLIENT_ID=$(jq -r '.identityUniversalAuth.clientId' ua_identity.json)

echo "Universal Auth credentials created successfully. Client ID: ${CLIENT_ID:0:20}..."

echo "Adding sample secrets to project..."
curl -s -X POST "$BASE/api/v4/secrets/DB_PASSWORD" \
-H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
-d "{\"projectId\":\"$PROJECT_ID\",\"environment\":\"dev\",\"secretPath\":\"/\",\"secretValue\":\"postgres\"}" \
| jq .

curl -s -X POST "$BASE/api/v4/secrets/REDIS_URL" \
-H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
-d "{\"projectId\":\"$PROJECT_ID\",\"environment\":\"dev\",\"secretPath\":\"/\",\"secretValue\":\"valkey:6379\"}" \
| jq .

echo "Infisical setup complete!"
echo "CLIENT_ID: $CLIENT_ID"
echo "CLIENT_SECRET: $CLIENT_SECRET"
echo "PROJECT_ID: $PROJECT_ID"
echo "Save these credentials securely for your API to use."

# Save credentials to a file for the API to read
cat > /tmp/infisical-credentials.json << EOF
{
  "CLIENT_ID": "$CLIENT_ID",
  "CLIENT_SECRET": "$CLIENT_SECRET",
  "PROJECT_ID": "$PROJECT_ID",
  "BASE_URL": "$BASE"
}
EOF

echo "Credentials saved to /tmp/infisical-credentials.json"