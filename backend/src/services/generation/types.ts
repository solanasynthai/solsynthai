export interface ProgramConfig {
  name: string;
  instructions: InstructionConfig[];
  accounts: AccountConfig[];
  state: StateConfig;
  security: SecurityConfig;
}

export interface InstructionConfig {
  name: string;
  accounts: Account[];
  arguments: Argument[];
  securityLevel: SecurityLevel;
  returns?: Type;
}

export interface AccountConfig {
  name: string;
  fields: Field[];
  constraints: Constraint[];
}

export interface StateConfig {
  name: string;
  fields: Field[];
  serialization: SerializationConfig;
}

export interface SecurityConfig {
  level: SecurityLevel;
  checks: SecurityCheck[];
  constraints: SecurityConstraint[];
}
