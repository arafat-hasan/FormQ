// Prompt Builder
// Constructs optimized prompts for LLM-powered form filling

import type { FormSignature, FieldSignature, Profile } from '@shared/types';
import { isFieldDenylisted } from '@shared/constants';

// ============================================================================
// Types
// ============================================================================

export interface PromptContext {
    profile: Profile;
    formSignature: FormSignature;
    ragContext?: string[];  // Retrieved examples from RAG
    maxTokens?: number;     // Token budget for context
}

export interface BuiltPrompt {
    systemPrompt: string;
    userPrompt: string;
    estimatedTokens: number;
}

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_PROMPT = `You are a form-filling assistant. Your task is to analyze form fields and provide appropriate values from the user's profile data.

RULES:
1. Return ONLY a valid JSON object mapping field IDs to values
2. Only include fields you can confidently fill
3. Never fill password, OTP, CVV, or security-related fields
4. Match data types appropriately (email format for email fields, etc.)
5. If unsure about a field, omit it from the response
6. Use exact field IDs from the input

RESPONSE FORMAT:
{
  "fieldId1": "value1",
  "fieldId2": "value2"
}`;

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 3000;

// ============================================================================
// Prompt Builder
// ============================================================================

export class PromptBuilder {
    /**
     * Build a complete prompt for form filling
     */
    buildPrompt(context: PromptContext): BuiltPrompt {
        const maxTokens = context.maxTokens ?? DEFAULT_MAX_TOKENS;

        // Build profile context
        const profileContext = this.buildProfileContext(context.profile);

        // Build form schema
        const formSchema = this.buildFormSchema(context.formSignature);

        // Build RAG context if available
        const ragSection = context.ragContext?.length
            ? this.buildRAGSection(context.ragContext)
            : '';

        // Assemble user prompt
        const userPrompt = this.assembleUserPrompt(
            profileContext,
            formSchema,
            ragSection,
            maxTokens
        );

        // Estimate tokens
        const estimatedTokens = this.estimateTokens(SYSTEM_PROMPT + userPrompt);

        return {
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            estimatedTokens,
        };
    }

    /**
     * Build profile context section
     */
    private buildProfileContext(profile: Profile): string {
        const fields = profile.staticContext.fields;
        const entries: string[] = [];

        for (const [key, field] of Object.entries(fields)) {
            if (field.value && !field.isEncrypted) {
                entries.push(`${key}: ${field.value}`);
            }
        }

        // Add document summaries if available
        for (const doc of profile.staticContext.documents) {
            if (doc.content) {
                // Truncate long documents
                const summary = doc.content.slice(0, 500);
                entries.push(`[${doc.type}] ${doc.name}: ${summary}${doc.content.length > 500 ? '...' : ''}`);
            }
        }

        return entries.join('\n');
    }

    /**
     * Build form schema section
     */
    private buildFormSchema(formSignature: FormSignature): string {
        const fields: FieldSchemaEntry[] = [];

        for (const field of formSignature.fields) {
            // Skip denylisted fields
            if (isFieldDenylisted(field)) {
                continue;
            }

            fields.push({
                id: field.id,
                label: field.normalizedLabel,
                type: field.inputType,
                semanticClass: field.semanticClass,
                placeholder: field.attributes.placeholder,
            });
        }

        return JSON.stringify(fields, null, 2);
    }

    /**
     * Build RAG context section
     */
    private buildRAGSection(ragContext: string[]): string {
        if (ragContext.length === 0) return '';

        return `\nPrevious successful fills for similar forms:\n${ragContext.map((ex, i) => `Example ${i + 1}: ${ex}`).join('\n')}`;
    }

    /**
     * Assemble the complete user prompt
     */
    private assembleUserPrompt(
        profileContext: string,
        formSchema: string,
        ragSection: string,
        maxTokens: number
    ): string {
        let prompt = `PROFILE DATA:
${profileContext}

FORM FIELDS TO FILL:
${formSchema}`;

        // Add RAG section if within token budget
        if (ragSection) {
            const currentTokens = this.estimateTokens(prompt);
            const ragTokens = this.estimateTokens(ragSection);

            if (currentTokens + ragTokens < maxTokens) {
                prompt += ragSection;
            }
        }

        prompt += `

Based on the profile data above, provide values for the form fields. Return ONLY a JSON object mapping field IDs to values.`;

        return prompt;
    }

    /**
     * Estimate token count for text
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }

    /**
     * Create a minimal prompt for simple forms (fewer tokens)
     */
    buildMinimalPrompt(
        fields: FieldSignature[],
        FormQata: Record<string, string>
    ): BuiltPrompt {
        const fieldList = fields
            .filter(f => !isFieldDenylisted(f))
            .map(f => `- ${f.id}: ${f.normalizedLabel} (${f.semanticClass})`)
            .join('\n');

        const profileList = Object.entries(FormQata)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');

        const userPrompt = `Profile:\n${profileList}\n\nFields:\n${fieldList}\n\nReturn JSON mapping field IDs to values.`;

        return {
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            estimatedTokens: this.estimateTokens(SYSTEM_PROMPT + userPrompt),
        };
    }
}

// ============================================================================
// Internal Types
// ============================================================================

interface FieldSchemaEntry {
    id: string;
    label: string;
    type: string;
    semanticClass: string;
    placeholder?: string;
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const promptBuilder = new PromptBuilder();
