#!/bin/bash

set -e

# Install required packages
echo "Installing required packages..."
apk add --no-cache jq curl

BASE="${INFISICAL_SITE_URL:-http://localhost:8085}"

echo "Waiting for Infisical to be ready..."
while ! curl -s "$BASE/" > /dev/null; do
  echo "Infisical not ready, waiting..."
  sleep 5
done

# Check if already bootstrapped
echo "Checking if Infisical is already bootstrapped..."
BOOTSTRAP_CHECK=$(curl -s "$BASE/api/v1/admin/bootstrap" || echo '{}')

if echo "$BOOTSTRAP_CHECK" | jq -e '.initialized == true' > /dev/null 2>&1; then
  echo "Infisical already bootstrapped. Logging in..."
  
  # Login with existing admin credentials
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE/api/v1/auth/login1" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@orbicheck.local","clientPublicKey":""}')
  
  SERVER_PUB_KEY=$(echo "$LOGIN_RESPONSE" | jq -r '.serverPublicKey')
  SALT=$(echo "$LOGIN_RESPONSE" | jq -r '.salt')
  
  # For simplicity, we'll use a second login endpoint if available
  # Otherwise, you'd need to implement SRP here
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE/api/v1/auth/login2" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@orbicheck.local","password":"AdminPass123!"}' 2>/dev/null || echo '{}')
  
  if echo "$LOGIN_RESPONSE" | jq -e '.token' > /dev/null 2>&1; then
    ADMIN_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
  else
    # Alternative: try to use the bootstrap endpoint with a different approach
    echo "Standard login failed, trying alternative method..."
    # Create a new admin token via bootstrap if possible
    BOOTSTRAP_RESPONSE=$(curl -s -X POST "$BASE/api/v1/admin/bootstrap" \
      -H "Content-Type: application/json" \
      -d '{"email":"admin@orbicheck.local","password":"AdminPass123!","organization":"orbicheck"}' 2>/dev/null || echo '{}')
    
    if echo "$BOOTSTRAP_RESPONSE" | jq -e '.identity.credentials.token' > /dev/null 2>&1; then
      ADMIN_TOKEN=$(echo "$BOOTSTRAP_RESPONSE" | jq -r '.identity.credentials.token')
      ORG_ID=$(echo "$BOOTSTRAP_RESPONSE" | jq -r '.organization.id')
    else
      echo "Unable to authenticate. Please check admin credentials."
      exit 1
    fi
  fi
  
  # Get organization ID if not already set
  if [ -z "$ORG_ID" ]; then
    ORG_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/organizations")
    ORG_ID=$(echo "$ORG_RESPONSE" | jq -r '.organizations[] | select(.name=="orbicheck") | .id' | head -n1)
  fi
else
  echo "Bootstrapping Infisical instance..."
  BOOTSTRAP_RESPONSE=$(curl -s -X POST "$BASE/api/v1/admin/bootstrap" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@orbicheck.local","password":"AdminPass123!","organization":"orbicheck"}')
  
  echo "$BOOTSTRAP_RESPONSE" > bootstrap.json
  
  if ! echo "$BOOTSTRAP_RESPONSE" | jq -e '.identity' > /dev/null 2>&1; then
    echo "Bootstrap failed! Response:"
    echo "$BOOTSTRAP_RESPONSE"
    exit 1
  fi
  
  ADMIN_TOKEN=$(echo "$BOOTSTRAP_RESPONSE" | jq -r '.identity.credentials.token')
  ORG_ID=$(echo "$BOOTSTRAP_RESPONSE" | jq -r '.organization.id')
  echo "Bootstrap successful."
fi

echo "Admin token acquired: ${ADMIN_TOKEN:0:20}..."

# Check if project already exists
echo "Checking for existing project..."
PROJECTS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/projects")
PROJECT_ID=$(echo "$PROJECTS_RESPONSE" | jq -r '.projects[] | select(.name=="orbicheck-api") | .id' | head -n1)

if [ -z "$PROJECT_ID" ]; then
  echo "Creating project..."
  PROJECT_RESPONSE=$(curl -s -X POST "$BASE/api/v1/projects" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d '{"projectName":"orbicheck-api","projectDescription":"OrbiCheck API service","shouldCreateDefaultEnvs":true}')
  
  if ! echo "$PROJECT_RESPONSE" | jq -e '.project' > /dev/null 2>&1; then
    echo "Project creation failed! Response:"
    echo "$PROJECT_RESPONSE"
    exit 1
  fi
  
  PROJECT_ID=$(echo "$PROJECT_RESPONSE" | jq -r '.project.id')
  echo "Project created successfully. Project ID: $PROJECT_ID"
else
  echo "Project already exists. Project ID: $PROJECT_ID"
fi

# Check if machine identity already exists
echo "Checking for existing machine identity..."
IDENTITIES_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/identities?organizationId=$ORG_ID")
IDENTITY_ID=$(echo "$IDENTITIES_RESPONSE" | jq -r '.identities[] | select(.name=="orbicheck-api") | .id' | head -n1)

if [ -z "$IDENTITY_ID" ]; then
  echo "Creating machine identity..."
  IDENTITY_RESPONSE=$(curl -s -X POST "$BASE/api/v1/identities" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"orbicheck-api\",\"organizationId\":\"$ORG_ID\",\"role\":\"no-access\"}")
  
  if ! echo "$IDENTITY_RESPONSE" | jq -e '.identity' > /dev/null 2>&1; then
    echo "Identity creation failed! Response:"
    echo "$IDENTITY_RESPONSE"
    exit 1
  fi
  
  IDENTITY_ID=$(echo "$IDENTITY_RESPONSE" | jq -r '.identity.id')
  echo "Identity created successfully. Identity ID: $IDENTITY_ID"
else
  echo "Machine identity already exists. Identity ID: $IDENTITY_ID"
fi

# Fetch project roles
echo "Fetching project roles..."
ROLES_JSON=$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/roles") || {
  echo "Failed to fetch roles"; exit 1; }

ROLE_SLUG=$(echo "$ROLES_JSON" | jq -r '.roles[] | select(.slug | test("(^|-)developer$")) | .slug' | head -n1)
if [ -z "$ROLE_SLUG" ]; then
  ROLE_SLUG=$(echo "$ROLES_JSON" | jq -r '.roles[0].slug // empty')
fi

if [ -z "$ROLE_SLUG" ]; then
  echo "No role slugs found in roles response"
  exit 1
fi

# Check if identity is already a member of the project
echo "Checking if identity is already a project member..."
MEMBERSHIPS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/api/v1/projects/$PROJECT_ID/identity-memberships")
IS_MEMBER=$(echo "$MEMBERSHIPS_RESPONSE" | jq -r ".identityMemberships[] | select(.identity.id==\"$IDENTITY_ID\") | .id" | head -n1)

if [ -z "$IS_MEMBER" ]; then
  echo "Adding identity to project with role: $ROLE_SLUG"
  curl -s -X POST "$BASE/api/v1/projects/$PROJECT_ID/identity-memberships/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"roles\":[{\"role\":\"$ROLE_SLUG\",\"isTemporary\":false}]}" | jq .
else
  echo "Identity is already a member of the project"
fi

# Check if Universal Auth is already attached
echo "Checking if Universal Auth is already attached..."
UA_CHECK=$(curl -s "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$UA_CHECK" | jq -e '.identityUniversalAuth.clientId' > /dev/null 2>&1; then
  echo "Universal Auth already attached"
  CLIENT_ID=$(echo "$UA_CHECK" | jq -r '.identityUniversalAuth.clientId')
  
  # Check if we have existing client secrets
  SECRETS_RESPONSE=$(curl -s "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  
  EXISTING_SECRET=$(echo "$SECRETS_RESPONSE" | jq -r '.clientSecretData[] | select(.description=="orbicheck-api bootstrap") | .id' | head -n1)
  
  if [ -z "$EXISTING_SECRET" ]; then
    echo "Creating new Universal Auth client secret..."
    SECRET_RESPONSE=$(curl -s -X POST "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
      -d '{"description":"orbicheck-api bootstrap","numUsesLimit":0,"ttl":0}')
    CLIENT_SECRET=$(echo "$SECRET_RESPONSE" | jq -r '.clientSecret')
  else
    echo "Client secret already exists. Please retrieve it manually if needed."
    CLIENT_SECRET="<existing-secret-not-retrievable>"
  fi
else
  echo "Attaching Universal Auth to identity..."
  curl -s -X POST "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d '{}' | jq .
  
  echo "Issuing Universal Auth client secret..."
  SECRET_RESPONSE=$(curl -s -X POST "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d '{"description":"orbicheck-api bootstrap","numUsesLimit":0,"ttl":0}')
  CLIENT_SECRET=$(echo "$SECRET_RESPONSE" | jq -r '.clientSecret')
  
  echo "Retrieving Universal Auth client ID..."
  UA_IDENTITY=$(curl -s "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  CLIENT_ID=$(echo "$UA_IDENTITY" | jq -r '.identityUniversalAuth.clientId')
fi

echo "Universal Auth ready. Client ID: ${CLIENT_ID:0:20}..."

# Function to create or update a secret
upsert_secret() {
  local secret_name=$1
  local secret_value=$2
  
  echo "Checking secret: $secret_name..."
  
  # Check if secret exists
  SECRET_CHECK=$(curl -s "$BASE/api/v4/secrets/$secret_name" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -G --data-urlencode "projectId=$PROJECT_ID" \
    --data-urlencode "environment=dev" \
    --data-urlencode "secretPath=/" 2>/dev/null || echo '{}')
  
  if echo "$SECRET_CHECK" | jq -e '.secret' > /dev/null 2>&1; then
    echo "Secret $secret_name already exists, updating..."
    curl -s -X PATCH "$BASE/api/v4/secrets/$secret_name" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
      -d "{\"projectId\":\"$PROJECT_ID\",\"environment\":\"dev\",\"secretPath\":\"/\",\"secretValue\":\"$secret_value\"}" \
      | jq .
  else
    echo "Creating secret $secret_name..."
    curl -s -X POST "$BASE/api/v4/secrets/$secret_name" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
      -d "{\"projectId\":\"$PROJECT_ID\",\"environment\":\"dev\",\"secretPath\":\"/\",\"secretValue\":\"$secret_value\"}" \
      | jq .
  fi
}

# Add or update secrets
echo "Managing project secrets..."
upsert_secret "DB_PASSWORD" "postgres"
upsert_secret "REDIS_URL" "valkey:6379"

echo "Infisical setup complete!"
echo "CLIENT_ID: $CLIENT_ID"
if [ "$CLIENT_SECRET" != "<existing-secret-not-retrievable>" ]; then
  echo "CLIENT_SECRET: $CLIENT_SECRET"
else
  echo "CLIENT_SECRET: (existing - not shown for security)"
fi
echo "PROJECT_ID: $PROJECT_ID"

# Save credentials to a file for the API to read
if [ "$CLIENT_SECRET" != "<existing-secret-not-retrievable>" ]; then
  cat > /tmp/infisical-credentials.json << EOF
{
  "CLIENT_ID": "$CLIENT_ID",
  "CLIENT_SECRET": "$CLIENT_SECRET",
  "PROJECT_ID": "$PROJECT_ID",
  "BASE_URL": "$BASE"
}
EOF
  echo "Credentials saved to /tmp/infisical-credentials.json"
else
  echo "Note: Client secret not available (already exists). Manual retrieval may be needed."
fi