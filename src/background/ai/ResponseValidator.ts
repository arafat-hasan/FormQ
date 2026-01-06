// Response Validator
// Validates and sanitizes LLM responses for form filling

import type { FormSignature, FieldSignature, FieldMapping } from '@shared/types';
import { isFieldDenylisted } from '@shared/constants';
import { createLogger } from '@shared/utils';

const logger = createLogger('ResponseValidator');

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    mappings: FieldMapping[];
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    type: 'INVALID_JSON' | 'INVALID_FIELD_ID' | 'INVALID_VALUE_TYPE' | 'SECURITY_VIOLATION';
    message: string;
    fieldId?: string;
}

export interface ValidationWarning {
    type: 'LOW_CONFIDENCE' | 'TYPE_MISMATCH' | 'EMPTY_VALUE';
    message: string;
    fieldId?: string;
}

// ============================================================================
// Constants
// ============================================================================

// Patterns for value type validation
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[\d\s\-\+\(\)\.]{7,20}$/;
const URL_PATTERN = /^https?:\/\/.+/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_PATTERN = /^[\d\-\s]{3,10}$/;

// ============================================================================
// Response Validator
// ============================================================================

export class ResponseValidator {
    /**
     * Validate and parse LLM response into field mappings
     */
    validate(
        rawResponse: string,
        formSignature: FormSignature
    ): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        const mappings: FieldMapping[] = [];

        // Step 1: Parse JSON
        let parsed: Record<string, string>;
        try {
            parsed = this.parseJSON(rawResponse);
        } catch (error) {
            errors.push({
                type: 'INVALID_JSON',
                message: error instanceof Error ? error.message : 'Invalid JSON response',
            });
            return { valid: false, mappings: [], errors, warnings };
        }

        // Step 2: Create field lookup map
        const fieldMap = new Map<string, FieldSignature>();
        for (const field of formSignature.fields) {
            fieldMap.set(field.id, field);
        }

        // Step 3: Validate each field mapping
        for (const [fieldId, value] of Object.entries(parsed)) {
            const field = fieldMap.get(fieldId);

            // Check if field exists
            if (!field) {
                errors.push({
                    type: 'INVALID_FIELD_ID',
                    message: `Field ID "${fieldId}" not found in form`,
                    fieldId,
                });
                continue;
            }

            // Check security denylist
            if (isFieldDenylisted(field)) {
                errors.push({
                    type: 'SECURITY_VIOLATION',
                    message: `Field "${fieldId}" is on security denylist`,
                    fieldId,
                });
                continue;
            }

            // Check for empty value
            if (!value || value.trim() === '') {
                warnings.push({
                    type: 'EMPTY_VALUE',
                    message: `Empty value for field "${fieldId}"`,
                    fieldId,
                });
                continue;
            }

            // Validate value type
            const typeValidation = this.validateValueType(value, field);
            if (typeValidation.warning) {
                warnings.push(typeValidation.warning);
            }

            // Create mapping
            mappings.push({
                fieldSignature: field,
                value: String(value).trim(),
                confidence: typeValidation.confidence,
                source: 'llm',
            });
        }

        // Determine overall validity
        const hasBlockingErrors = errors.some(
            e => e.type === 'INVALID_JSON' || e.type === 'SECURITY_VIOLATION'
        );

        logger.debug('Validation complete', {
            mappingCount: mappings.length,
            errorCount: errors.length,
            warningCount: warnings.length,
        });

        return {
            valid: !hasBlockingErrors && mappings.length > 0,
            mappings,
            errors,
            warnings,
        };
    }

    /**
     * Parse JSON from LLM response, handling markdown code blocks
     */
    private parseJSON(rawResponse: string): Record<string, string> {
        let jsonStr = rawResponse.trim();

        // Handle markdown code blocks
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        // Try to find JSON object if not starting with {
        if (!jsonStr.startsWith('{')) {
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonStr = jsonMatch[0];
            }
        }

        try {
            const parsed = JSON.parse(jsonStr);

            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new Error('Response must be a JSON object');
            }

            // Ensure all values are strings
            const result: Record<string, string> = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (value !== null && value !== undefined) {
                    result[key] = String(value);
                }
            }

            return result;
        } catch (error) {
            throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate value against expected field type
     */
    private validateValueType(
        value: string,
        field: FieldSignature
    ): { confidence: number; warning?: ValidationWarning } {
        const trimmedValue = value.trim();
        let confidence = 0.9; // Default high confidence for LLM responses
        let warning: ValidationWarning | undefined;

        switch (field.inputType) {
            case 'email':
                if (!EMAIL_PATTERN.test(trimmedValue)) {
                    confidence = 0.5;
                    warning = {
                        type: 'TYPE_MISMATCH',
                        message: `Value "${trimmedValue}" may not be a valid email`,
                        fieldId: field.id,
                    };
                }
                break;

            case 'tel':
                if (!PHONE_PATTERN.test(trimmedValue)) {
                    confidence = 0.6;
                    warning = {
                        type: 'TYPE_MISMATCH',
                        message: `Value "${trimmedValue}" may not be a valid phone number`,
                        fieldId: field.id,
                    };
                }
                break;

            case 'url':
                if (!URL_PATTERN.test(trimmedValue)) {
                    confidence = 0.5;
                    warning = {
                        type: 'TYPE_MISMATCH',
                        message: `Value "${trimmedValue}" may not be a valid URL`,
                        fieldId: field.id,
                    };
                }
                break;

            case 'date':
                if (!DATE_PATTERN.test(trimmedValue)) {
                    confidence = 0.6;
                    warning = {
                        type: 'TYPE_MISMATCH',
                        message: `Value "${trimmedValue}" may not be in expected date format`,
                        fieldId: field.id,
                    };
                }
                break;

            case 'number':
                if (isNaN(Number(trimmedValue))) {
                    confidence = 0.4;
                    warning = {
                        type: 'TYPE_MISMATCH',
                        message: `Value "${trimmedValue}" is not a valid number`,
                        fieldId: field.id,
                    };
                }
                break;
        }

        // Additional semantic validation
        if (field.semanticClass === 'zip' && !ZIP_PATTERN.test(trimmedValue)) {
            confidence = Math.min(confidence, 0.6);
        }

        if (field.semanticClass === 'email' && !EMAIL_PATTERN.test(trimmedValue)) {
            confidence = Math.min(confidence, 0.5);
        }

        return { confidence, warning };
    }

    /**
     * Merge LLM mappings with static mappings, preferring higher confidence
     */
    mergeWithStaticMappings(
        llmMappings: FieldMapping[],
        staticMappings: FieldMapping[]
    ): FieldMapping[] {
        const result = new Map<string, FieldMapping>();

        // Add static mappings first
        for (const mapping of staticMappings) {
            result.set(mapping.fieldSignature.id, mapping);
        }

        // Override with LLM mappings if higher confidence
        for (const mapping of llmMappings) {
            const existing = result.get(mapping.fieldSignature.id);
            if (!existing || mapping.confidence > existing.confidence) {
                result.set(mapping.fieldSignature.id, mapping);
            }
        }

        return Array.from(result.values());
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const responseValidator = new ResponseValidator();
