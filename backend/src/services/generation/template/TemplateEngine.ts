import { 
    Template, 
    TemplateComponent, 
    ComponentType, 
    TemplateContext,
    ValidationRule,
    CompositionRule
} from './types';
import { SecurityAnalyzer } from '../../security/analyzers/SecurityAnalyzer';
import { RustCodeGenerator } from '../rust/RustCodeGenerator';
import { ProgramLayoutParser } from '../../solana/layout/ProgramLayoutParser';
import { validateTemplateStructure } from './validators/TemplateValidator';
import { optimizeTemplate } from './optimizers/TemplateOptimizer';

export class TemplateEngine {
    private static instance: TemplateEngine;
    private templates: Map<string, Template>;
    private components: Map<string, TemplateComponent>;
    private validationRules: Map<string, ValidationRule[]>;
    private compositionRules: Map<string, CompositionRule[]>;
    private securityAnalyzer: SecurityAnalyzer;
    private codeGenerator: RustCodeGenerator;
    private layoutParser: ProgramLayoutParser;

    private constructor() {
        this.templates = new Map();
        this.components = new Map();
        this.validationRules = new Map();
        this.compositionRules = new Map();
        this.securityAnalyzer = new SecurityAnalyzer();
        this.codeGenerator = new RustCodeGenerator();
        this.layoutParser = ProgramLayoutParser.getInstance();
        this.initializeBaseTemplates();
    }

    public static getInstance(): TemplateEngine {
        if (!TemplateEngine.instance) {
            TemplateEngine.instance = new TemplateEngine();
        }
        return TemplateEngine.instance;
    }

    public registerTemplate(template: Template): void {
        validateTemplateStructure(template);
        
        const optimizedTemplate = optimizeTemplate(template);
        const securityAnalysis = this.securityAnalyzer.analyzeTemplate(optimizedTemplate);
        
        if (securityAnalysis.hasCriticalIssues) {
            throw new Error(`Template ${template.id} failed security analysis: ${securityAnalysis.issues.join(', ')}`);
        }

        this.templates.set(template.id, {
            ...optimizedTemplate,
            securityProfile: securityAnalysis.profile
        });

        // Register template components
        template.components.forEach(component => {
            this.registerComponent(component);
        });

        // Register validation rules
        this.validationRules.set(template.id, template.validationRules || []);
        
        // Register composition rules
        this.compositionRules.set(template.id, template.compositionRules || []);
    }

    public async generateProgram(templateId: string, context: TemplateContext): Promise<string> {
        const template = this.templates.get(templateId);
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        try {
            // Validate context against template rules
            this.validateContext(template, context);

            // Compose program structure
            const programStructure = await this.composeProgramStructure(template, context);

            // Generate Rust code
            const rustCode = this.codeGenerator.generateProgram(programStructure);

            // Register program layout
            this.registerProgramLayout(programStructure);

            return rustCode;
        } catch (error) {
            throw new Error(`Failed to generate program from template ${templateId}: ${error.message}`);
        }
    }

    private registerComponent(component: TemplateComponent): void {
        // Validate component
        this.validateComponent(component);

        // Generate and validate component layout
        const componentLayout = this.layoutParser.createComponentLayout(component);
        
        // Register component with its layout
        this.components.set(component.id, {
            ...component,
            layout: componentLayout
        });
    }

    private validateContext(template: Template, context: TemplateContext): void {
        const rules = this.validationRules.get(template.id) || [];
        
        for (const rule of rules) {
            if (!rule.validate(context)) {
                throw new Error(`Context validation failed: ${rule.errorMessage}`);
            }
        }
    }

    private async composeProgramStructure(template: Template, context: TemplateContext): Promise<any> {
        const compositionRules = this.compositionRules.get(template.id) || [];
        let programStructure = {
            components: [],
            instructions: [],
            accounts: [],
            state: {}
        };

        // Apply base template structure
        programStructure = {
            ...programStructure,
            ...this.applyBaseTemplate(template)
        };

        // Apply composition rules
        for (const rule of compositionRules) {
            programStructure = await rule.apply(programStructure, context);
        }

        // Validate final structure
        this.validateProgramStructure(programStructure);

        return programStructure;
    }

    private applyBaseTemplate(template: Template): any {
        return {
            name: template.name,
            version: template.version,
            components: template.components.map(component => ({
                ...component,
                layout: this.components.get(component.id)?.layout
            })),
            instructions: template.instructions,
            accounts: template.accounts,
            state: template.state
        };
    }

    private validateComponent(component: TemplateComponent): void {
        switch (component.type) {
            case ComponentType.INSTRUCTION:
                this.validateInstructionComponent(component);
                break;
            case ComponentType.ACCOUNT:
                this.validateAccountComponent(component);
                break;
            case ComponentType.STATE:
                this.validateStateComponent(component);
                break;
            default:
                throw new Error(`Unknown component type: ${component.type}`);
        }
    }

    private validateInstructionComponent(component: TemplateComponent): void {
        if (!component.inputs || !component.outputs) {
            throw new Error(`Invalid instruction component ${component.id}: missing inputs or outputs`);
        }
        // Additional instruction-specific validation
    }

    private validateAccountComponent(component: TemplateComponent): void {
        if (!component.schema) {
            throw new Error(`Invalid account component ${component.id}: missing schema`);
        }
        // Additional account-specific validation
    }

    private validateStateComponent(component: TemplateComponent): void {
        if (!component.schema || !component.initialState) {
            throw new Error(`Invalid state component ${component.id}: missing schema or initial state`);
        }
        // Additional state-specific validation
    }

    private validateProgramStructure(structure: any): void {
        // Validate complete program structure
        if (!structure.components || !structure.instructions || !structure.accounts) {
            throw new Error('Invalid program structure: missing required sections');
        }

        // Validate component dependencies
        this.validateComponentDependencies(structure);

        // Validate instruction flows
        this.validateInstructionFlows(structure);
    }

    private validateComponentDependencies(structure: any): void {
        // Implement component dependency validation
    }

    private validateInstructionFlows(structure: any): void {
        // Implement instruction flow validation
    }

    private registerProgramLayout(structure: any): void {
        // Register program layout with the layout parser
        this.layoutParser.registerProgramLayout(structure);
    }
}
