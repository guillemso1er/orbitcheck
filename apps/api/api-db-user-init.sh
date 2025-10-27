#!/bin/sh
set -e

# The `psql` command inside the Postgres container
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create a new role for your API clients with login privileges.
    CREATE USER api_user WITH PASSWORD '$API_USER_PASSWORD';

    -- Grant connection privileges to the specific database.
    GRANT CONNECT ON DATABASE mydatabase TO api_user;

    -- Grant USAGE on the public schema.
    GRANT USAGE ON SCHEMA public TO api_user;

    -- Grant SELECT privileges on all tables in the public schema.
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO api_user;

    -- Set default privileges for all *future* tables.
    ALTER DEFAULT PRIVILEGES FOR USER myuser IN SCHEMA public
    GRANT SELECT ON TABLES TO api_user;
EOSQL
