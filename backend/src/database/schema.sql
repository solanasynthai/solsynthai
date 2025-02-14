-- Database creation and configuration
CREATE DATABASE solsynthai
    WITH 
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TEMPLATE = template0;

\connect solsynthai

-- Set timezone to UTC
SET timezone = 'UTC';

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- For UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- For encryption
CREATE EXTENSION IF NOT EXISTS "citext";         -- For case-insensitive text
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- For query analysis
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- For text search
CREATE EXTENSION IF NOT EXISTS "btree_gist";     -- For exclusion constraints

-- Set configuration parameters
ALTER DATABASE solsynthai SET timezone TO 'UTC';
ALTER DATABASE solsynthai SET statement_timeout TO '30s';
ALTER DATABASE solsynthai SET idle_in_transaction_session_timeout TO '60s';
ALTER DATABASE solsynthai SET lock_timeout TO '10s';
ALTER DATABASE solsynthai SET client_encoding TO 'UTF8';

-- Create schema for application
CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS 'Main application schema for SolSynthai';

-- Set search path
SET search_path TO app, public;

-- Create roles
DO $$
BEGIN
    -- Application roles
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solsynthai_app') THEN
        CREATE ROLE solsynthai_app WITH LOGIN PASSWORD 'change_in_production';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solsynthai_readonly') THEN
        CREATE ROLE solsynthai_readonly WITH LOGIN PASSWORD 'change_in_production';
    END IF;

    -- Admin role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solsynthai_admin') THEN
        CREATE ROLE solsynthai_admin WITH LOGIN PASSWORD 'change_in_production' SUPERUSER;
    END IF;
END;
$$;

-- Grant permissions
GRANT USAGE ON SCHEMA app TO solsynthai_app;
GRANT USAGE ON SCHEMA app TO solsynthai_readonly;
GRANT ALL ON SCHEMA app TO solsynthai_admin;

-- Include migrations
\i migrations/001_initial_schema.sql

-- Create read-only user permissions
GRANT SELECT ON ALL TABLES IN SCHEMA app TO solsynthai_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO solsynthai_readonly;

-- Create application user permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO solsynthai_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO solsynthai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO solsynthai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE ON SEQUENCES TO solsynthai_app;

-- Create maintenance functions
CREATE OR REPLACE FUNCTION app.maintain_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create audit function
CREATE OR REPLACE FUNCTION app.audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    audit_row app.audit_logs;
    excluded_cols text[] = ARRAY[]::text[];
BEGIN
    IF TG_OP = 'DELETE' THEN
        audit_row = ROW(
            uuid_generate_v4(),          -- id
            current_user::uuid,          -- user_id
            TG_OP,                       -- action
            TG_TABLE_NAME::text,         -- resource_type
            OLD.id,                      -- resource_id
            row_to_json(OLD),           -- details
            inet_client_addr(),          -- ip_address
            current_setting('app.user_agent', true),  -- user_agent
            CURRENT_TIMESTAMP            -- created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        audit_row = ROW(
            uuid_generate_v4(),          -- id
            current_user::uuid,          -- user_id
            TG_OP,                       -- action
            TG_TABLE_NAME::text,         -- resource_type
            NEW.id,                      -- resource_id
            jsonb_build_object(
                'old', row_to_json(OLD),
                'new', row_to_json(NEW)
            ),                           -- details
            inet_client_addr(),          -- ip_address
            current_setting('app.user_agent', true),  -- user_agent
            CURRENT_TIMESTAMP            -- created_at
        );
    ELSIF TG_OP = 'INSERT' THEN
        audit_row = ROW(
            uuid_generate_v4(),          -- id
            current_user::uuid,          -- user_id
            TG_OP,                       -- action
            TG_TABLE_NAME::text,         -- resource_type
            NEW.id,                      -- resource_id
            row_to_json(NEW),           -- details
            inet_client_addr(),          -- ip_address
            current_setting('app.user_agent', true),  -- user_agent
            CURRENT_TIMESTAMP            -- created_at
        );
    END IF;

    INSERT INTO app.audit_logs VALUES (audit_row.*);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp;

-- Create maintenance procedures
CREATE OR REPLACE PROCEDURE app.cleanup_sessions()
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM app.sessions WHERE expires_at < CURRENT_TIMESTAMP;
    DELETE FROM app.audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
END;
$$;

-- Create maintenance views
CREATE OR REPLACE VIEW app.active_users AS
    SELECT u.*, COUNT(c.id) as contract_count
    FROM app.users u
    LEFT JOIN app.contracts c ON c.author_id = u.id
    WHERE u.is_active = true
    GROUP BY u.id;

CREATE OR REPLACE VIEW app.contract_metrics AS
    SELECT 
        c.id,
        c.name,
        c.author_id,
        c.status,
        c.created_at,
        COUNT(cv.id) as version_count,
        COUNT(ca.id) as audit_count,
        MAX(ca.severity_score) as max_severity
    FROM app.contracts c
    LEFT JOIN app.contract_versions cv ON cv.contract_id = c.id
    LEFT JOIN app.contract_audits ca ON ca.contract_id = c.id
    GROUP BY c.id;

-- Set up partitioning for audit logs
CREATE TABLE IF NOT EXISTS app.audit_logs_partitioned (
    LIKE app.audit_logs INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create initial partition
CREATE TABLE app.audit_logs_y2025m02 PARTITION OF app.audit_logs_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Create indexes on partitioned table
CREATE INDEX idx_audit_logs_part_created_at ON app.audit_logs_partitioned(created_at);
CREATE INDEX idx_audit_logs_part_user_id ON app.audit_logs_partitioned(user_id);

-- Set up backup functions
CREATE OR REPLACE FUNCTION app.backup_tables()
RETURNS void AS $$
DECLARE
    backup_path text;
BEGIN
    backup_path := current_setting('app.backup_path');
    EXECUTE format('COPY (SELECT * FROM app.users) TO %L', backup_path || '/users.csv') WITH CSV HEADER;
    EXECUTE format('COPY (SELECT * FROM app.contracts) TO %L', backup_path || '/contracts.csv') WITH CSV HEADER;
    -- Add more tables as needed
END;
$$ LANGUAGE plpgsql;

-- Configure replication (if needed)
SELECT pg_create_physical_replication_slot('standby_1');

-- Set up statistics collection
ALTER SYSTEM SET track_activities = on;
ALTER SYSTEM SET track_counts = on;
ALTER SYSTEM SET track_io_timing = on;
ALTER SYSTEM SET track_functions = 'all';

COMMENT ON DATABASE solsynthai IS 'Smart Contract Generation and Analysis Platform';
