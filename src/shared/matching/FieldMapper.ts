// Field Mapper
// Map profile fields to form fields using semantic matching

import type { FieldSignature, FieldMapping, Profile, SemanticClass, ContextField } from '@shared/types';
import { createLogger, normalizeText } from '@shared/utils';

const logger = createLogger('FieldMapper');

/**
 * Mapping from semantic classes to profile field keys
 */
const SEMANTIC_TO_PROFILE_KEY: Record<SemanticClass, string[]> = {
    // Personal
    first_name: ['firstName', 'first_name', 'givenName'],
    last_name: ['lastName', 'last_name', 'familyName', 'surname'],
    full_name: ['fullName', 'full_name', 'name'],
    date_of_birth: ['dateOfBirth', 'dob', 'birthDate'],

    // Contact
    email: ['email', 'emailAddress', 'email_address'],
    phone: ['phone', 'phoneNumber', 'phone_number', 'mobile', 'telephone'],

    // Address
    address_line1: ['address', 'addressLine1', 'address_line1', 'street', 'streetAddress'],
    address_line2: ['addressLine2', 'address_line2', 'apt', 'suite', 'unit'],
    city: ['city', 'town', 'locality'],
    state: ['state', 'province', 'region'],
    zip: ['zip', 'zipCode', 'zip_code', 'postalCode', 'postal_code'],
    country: ['country', 'countryName'],

    // Professional
    company: ['company', 'organization', 'employer', 'companyName'],
    job_title: ['jobTitle', 'job_title', 'title', 'position', 'role'],
    website: ['website', 'url', 'homepage', 'personalWebsite'],

    // Credentials
    username: ['username', 'user', 'login'],
    password: [], // Never auto-fill

    // Other
    message: ['message', 'comment', 'note', 'description'],
    unknown: [],
};

/**
 * Create field mappings from a profile to form fields
 */
export function mapFieldsToProfile(
    fields: FieldSignature[],
    profile: Profile
): FieldMapping[] {
    const mappings: FieldMapping[] = [];
    const profileFields = profile.staticContext.fields;

    for (const field of fields) {
        // Skip password fields (security)
        if (field.semanticClass === 'password') {
            continue;
        }

        let mapping: FieldMapping | null = null;

        // Try semantic class matching first
        if (field.semanticClass !== 'unknown') {
            const potentialKeys = SEMANTIC_TO_PROFILE_KEY[field.semanticClass] ?? [];

            // Find first matching key in profile fields
            for (const key of potentialKeys) {
                const profileField = profileFields.find(f => f.key === key);
                if (profileField?.value) {
                    mapping = {
                        fieldSignature: field,
                        value: profileField.value,
                        confidence: 1.0, // High confidence for semantic matches
                        source: 'static',
                    };
                    break;
                }
            }
        }

        // If no semantic match, try fuzzy matching
        if (!mapping) {
            mapping = tryFuzzyMatch(field, profileFields);
        }

        if (mapping) {
            mappings.push(mapping);
        }
    }

    logger.debug('Mapped fields', {
        totalFields: fields.length,
        mappedCount: mappings.length
    });

    return mappings;
}

/**
 * Try to fuzzy match a field to a profile field
 */
function tryFuzzyMatch(
    field: FieldSignature,
    profileFields: ContextField[]
): FieldMapping | null {
    const normalizedLabel = normalizeText(field.normalizedLabel).toLowerCase();

    // First, try exact key matching (case-insensitive)
    for (const profileField of profileFields) {
        const normalizedKey = normalizeText(profileField.key).toLowerCase();
        if (normalizedKey === normalizedLabel) {
            return {
                fieldSignature: field,
                value: profileField.value,
                confidence: 0.95, // Very high confidence for exact key match
                source: 'static',
            };
        }
    }

    // Common fuzzy patterns
    const fuzzyPatterns: Array<{ pattern: RegExp | string; keys: string[] }> = [
        { pattern: /first\s*name|fname|given/i, keys: ['firstName', 'first_name', 'givenName'] },
        { pattern: /last\s*name|lname|surname|family/i, keys: ['lastName', 'last_name', 'familyName'] },
        { pattern: /full\s*name|your\s*name/i, keys: ['fullName', 'full_name', 'name'] },
        { pattern: /e-?mail/i, keys: ['email', 'emailAddress', 'email_address'] },
        { pattern: /phone|mobile|cell|tel/i, keys: ['phone', 'phoneNumber', 'phone_number'] },
        { pattern: /company|organization|employer/i, keys: ['company', 'companyName'] },
        { pattern: /title|position|role/i, keys: ['jobTitle', 'job_title'] },
        { pattern: /city|town/i, keys: ['city'] },
        { pattern: /state|province/i, keys: ['state'] },
        { pattern: /zip|postal/i, keys: ['zip', 'zipCode', 'postalCode'] },
        { pattern: /address|street/i, keys: ['address', 'addressLine1', 'address_line1'] },
    ];

    for (const { pattern, keys } of fuzzyPatterns) {
        const matches = typeof pattern === 'string'
            ? normalizedLabel.includes(pattern)
            : pattern.test(normalizedLabel);

        if (matches) {
            for (const key of keys) {
                const profileField = profileFields.find(f => f.key === key);
                if (profileField?.value) {
                    return {
                        fieldSignature: field,
                        value: profileField.value,
                        confidence: 0.8, // Lower confidence for fuzzy matches
                        source: 'static',
                    };
                }
            }
        }
    }

    // Try partial key matching (e.g., "linkedin" matches "linkedinUrl")
    for (const profileField of profileFields) {
        const normalizedKey = normalizeText(profileField.key).toLowerCase();
        if (normalizedKey.includes(normalizedLabel) || normalizedLabel.includes(normalizedKey)) {
            return {
                fieldSignature: field,
                value: profileField.value,
                confidence: 0.7, // Medium confidence for partial match
                source: 'static',
            };
        }
    }

    return null;
}

/**
 * Create a suggested fill mapping with full name handling
 */
export function createSuggestedMappings(
    fields: FieldSignature[],
    profile: Profile
): FieldMapping[] {
    const mappings = mapFieldsToProfile(fields, profile);
    const profileFields = profile.staticContext.fields;

    // Handle full name splitting if needed
    const hasFirstNameField = fields.some(f => f.semanticClass === 'first_name');
    const hasLastNameField = fields.some(f => f.semanticClass === 'last_name');
    const hasFullNameField = fields.some(f => f.semanticClass === 'full_name');

    // Helper to find field by key
    const findField = (key: string) => profileFields.find(f => f.key === key);

    // If we have a full name in profile but form has first/last name fields
    if (!hasFullNameField && hasFirstNameField && hasLastNameField) {
        const fullName = findField('fullName')?.value || findField('full_name')?.value;
        if (fullName && !findField('firstName') && !findField('lastName')) {
            const parts = fullName.trim().split(/\s+/);
            if (parts.length >= 2) {
                const firstName = parts[0];
                const lastName = parts.slice(1).join(' ');

                // Add first name mapping
                const firstNameField = fields.find(f => f.semanticClass === 'first_name');
                if (firstNameField && !mappings.some(m => m.fieldSignature.id === firstNameField.id)) {
                    mappings.push({
                        fieldSignature: firstNameField,
                        value: firstName,
                        confidence: 0.9,
                        source: 'static',
                    });
                }

                // Add last name mapping
                const lastNameField = fields.find(f => f.semanticClass === 'last_name');
                if (lastNameField && !mappings.some(m => m.fieldSignature.id === lastNameField.id)) {
                    mappings.push({
                        fieldSignature: lastNameField,
                        value: lastName,
                        confidence: 0.9,
                        source: 'static',
                    });
                }
            }
        }
    }

    // If we have first/last name in profile but form has full name field
    if (hasFullNameField && !hasFirstNameField && !hasLastNameField) {
        const firstName = findField('firstName')?.value || findField('first_name')?.value;
        const lastName = findField('lastName')?.value || findField('last_name')?.value;
        if (firstName && lastName && !findField('fullName')) {
            const fullNameField = fields.find(f => f.semanticClass === 'full_name');
            if (fullNameField && !mappings.some(m => m.fieldSignature.id === fullNameField.id)) {
                mappings.push({
                    fieldSignature: fullNameField,
                    value: `${firstName} ${lastName}`,
                    confidence: 0.9,
                    source: 'static',
                });
            }
        }
    }

    return mappings;
}

/**
 * Filter mappings to only include high-confidence ones
 */
export function filterHighConfidenceMappings(
    mappings: FieldMapping[],
    threshold: number = 0.7
): FieldMapping[] {
    return mappings.filter(m => m.confidence >= threshold);
}

/**
 * Get a human-readable summary of what will be filled
 */
export function getFillSummary(mappings: FieldMapping[]): string {
    if (mappings.length === 0) {
        return 'No fields to fill';
    }

    const fieldNames = mappings
        .map(m => m.fieldSignature.normalizedLabel)
        .slice(0, 5);

    const remaining = mappings.length - fieldNames.length;

    if (remaining > 0) {
        return `${fieldNames.join(', ')} and ${remaining} more`;
    }

    return fieldNames.join(', ');
}
