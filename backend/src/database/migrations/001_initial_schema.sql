-- Enable necessary extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Set search path
SET search_path TO app, public;

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    public_key TEXT NOT NULL UNIQUE,
    username CITEXT UNIQUE,
    email CITEXT UNIQUE,
    avatar_url TEXT,
    bio TEXT,
    roles TEXT[] DEFAULT ARRAY['user'],
    permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
    organization_id UUID,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_public_key CHECK (public_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

-- Contracts table
CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    version TEXT NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    program_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('draft', 'compiled', 'audited', 'deployed', 'archived', 'deprecated')),
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public', 'organization')),
    source_code TEXT NOT NULL,
    bytecode BYTEA,
    metadata JSONB NOT NULL DEFAULT '{}',
    compilation_settings JSONB NOT NULL DEFAULT '{}',
    deployment_settings JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deployed_at TIMESTAMPTZ,
    last_audited_at TIMESTAMPTZ,
    CONSTRAINT valid_program_id CHECK (program_id IS NULL OR program_id ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

-- Contract versions table
CREATE TABLE contract_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    version TEXT NOT NULL,
    source_code TEXT NOT NULL,
    bytecode BYTEA,
    metadata JSONB NOT NULL DEFAULT '{}',
    changes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (contract_id, version)
);

-- Deployments table
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    version_id UUID NOT NULL REFERENCES contract_versions(id),
    deployer_id UUID NOT NULL REFERENCES users(id),
    network TEXT NOT NULL CHECK (network IN ('mainnet-beta', 'testnet', 'devnet', 'localnet')),
    program_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'success', 'failed')),
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_deployment_program_id CHECK (program_id ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);

-- Audits table
CREATE TABLE audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    version_id UUID NOT NULL REFERENCES contract_versions(id),
    auditor_id UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    security_score INTEGER CHECK (security_score BETWEEN 0 AND 100),
    findings JSONB NOT NULL DEFAULT '[]',
    recommendations JSONB NOT NULL DEFAULT '[]',
    report_url TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Analytics table
CREATE TABLE analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    deployment_id UUID REFERENCES deployments(id),
    network TEXT NOT NULL,
    transaction_count BIGINT NOT NULL DEFAULT 0,
    unique_users BIGINT NOT NULL DEFAULT 0,
    compute_units_total BIGINT NOT NULL DEFAULT 0,
    compute_units_avg DOUBLE PRECISION,
    execution_time_avg DOUBLE PRECISION,
    error_rate DOUBLE PRECISION,
    metrics JSONB NOT NULL DEFAULT '{}',
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    description TEXT,
    website_url TEXT,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Organization members table
CREATE TABLE organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id)
);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_contracts_author ON contracts(author_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_visibility ON contracts(visibility);
CREATE INDEX idx_contract_versions_contract ON contract_versions(contract_id);
CREATE INDEX idx_deployments_contract ON deployments(contract_id);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_audits_contract ON audits(contract_id);
CREATE INDEX idx_analytics_contract ON analytics(contract_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);

-- Create updated_at triggers
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION app.maintain_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW
    EXECUTE FUNCTION app.maintain_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON deployments
    FOR EACH ROW
    EXECUTE FUNCTION app.maintain_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON audits
    FOR EACH ROW
    EXECUTE FUNCTION app.maintain_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION app.maintain_updated_at();

-- Create audit log triggers
CREATE TRIGGER audit_contract_changes
    AFTER INSERT OR UPDATE OR DELETE ON contracts
    FOR EACH ROW
    EXECUTE FUNCTION app.audit_trigger();

CREATE TRIGGER audit_deployment_changes
    AFTER INSERT OR UPDATE OR DELETE ON deployments
    FOR EACH ROW
    EXECUTE FUNCTION app.audit_trigger();

CREATE TRIGGER audit_audit_changes
    AFTER INSERT OR UPDATE OR DELETE ON audits
    FOR EACH ROW
    EXECUTE FUNCTION app.audit_trigger();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO solsynthai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO solsynthai_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO solsynthai_readonly;
