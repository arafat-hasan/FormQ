// Field Signature
// Normalize field attributes into a semantic signature

import type { FieldSignature, InputType, SemanticClass } from '@shared/types';
import { generateId, normalizeText } from '@shared/utils';
import {
    getElementPath,
    getLabelText,
    getSiblingText,
    getParentText,
    getElementPosition
} from './DOMUtils';

/**
 * Extract a normalized field signature from a form field element
 */
export function extractFieldSignature(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): FieldSignature {
    const inputType = getInputType(element);
    const attributes = extractAttributes(element);
    const context = extractContext(element);

    // Build normalized label from available sources
    const normalizedLabel = buildNormalizedLabel(element, attributes, context);

    // Infer semantic class from available signals
    const semanticClass = inferSemanticClass(normalizedLabel, attributes, inputType);

    return {
        id: generateId(),
        domPath: getElementPath(element),
        inputType,
        normalizedLabel,
        semanticClass,
        attributes,
        context,
    };
}

/**
 * Determine the input type from element
 */
function getInputType(element: HTMLElement): InputType {
    if (element instanceof HTMLSelectElement) {
        return 'select';
    }

    if (element instanceof HTMLTextAreaElement) {
        return 'textarea';
    }

    if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();

        const validTypes: InputType[] = [
            'text', 'email', 'tel', 'url', 'password',
            'number', 'date', 'datetime-local', 'time',
            'radio', 'checkbox', 'hidden', 'file'
        ];

        if (validTypes.includes(type as InputType)) {
            return type as InputType;
        }
    }

    return 'unknown';
}

/**
 * Extract relevant HTML attributes
 */
function extractAttributes(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): FieldSignature['attributes'] {
    return {
        name: element.name || undefined,
        id: element.id || undefined,
        placeholder: 'placeholder' in element ? element.placeholder || undefined : undefined,
        autocomplete: element.autocomplete || undefined,
        ariaLabel: element.getAttribute('aria-label') || undefined,
    };
}

/**
 * Extract contextual information from surrounding DOM
 */
function extractContext(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): FieldSignature['context'] {
    return {
        labelText: getLabelText(element),
        siblingText: getSiblingText(element),
        parentText: getParentText(element),
        position: getElementPosition(element),
    };
}

/**
 * Build a normalized, human-readable label from available sources
 */
function buildNormalizedLabel(
    _element: HTMLElement,
    attributes: FieldSignature['attributes'],
    context: FieldSignature['context']
): string {
    // Priority order for label sources
    const sources = [
        context.labelText,
        attributes.ariaLabel,
        attributes.placeholder,
        attributes.name,
        attributes.id,
    ];

    for (const source of sources) {
        if (source) {
            return normalizeText(source);
        }
    }

    // Fallback: use sibling or parent text
    if (context.siblingText) {
        return normalizeText(context.siblingText);
    }

    if (context.parentText) {
        return normalizeText(context.parentText.substring(0, 50));
    }

    return 'unknown field';
}

/**
 * Infer semantic class from field signals
 */
function inferSemanticClass(
    normalizedLabel: string,
    attributes: FieldSignature['attributes'],
    inputType: InputType
): SemanticClass {
    const label = normalizedLabel.toLowerCase();
    const autocomplete = (attributes.autocomplete || '').toLowerCase();

    // Check autocomplete attribute first (most reliable)
    const autocompleteMap: Record<string, SemanticClass> = {
        'given-name': 'first_name',
        'family-name': 'last_name',
        'name': 'full_name',
        'email': 'email',
        'tel': 'phone',
        'tel-national': 'phone',
        'address-line1': 'address_line1',
        'address-line2': 'address_line2',
        'address-level2': 'city',
        'address-level1': 'state',
        'postal-code': 'zip',
        'country': 'country',
        'country-name': 'country',
        'organization': 'company',
        'organization-title': 'job_title',
        'url': 'website',
        'username': 'username',
        'bday': 'date_of_birth',
    };

    if (autocomplete && autocompleteMap[autocomplete]) {
        return autocompleteMap[autocomplete];
    }

    // Check input type
    if (inputType === 'email') return 'email';
    if (inputType === 'tel') return 'phone';
    if (inputType === 'url') return 'website';
    if (inputType === 'password') return 'password';

    // Infer from label text
    const labelPatterns: Array<[RegExp, SemanticClass]> = [
        [/\b(first\s*name|given\s*name|fname)\b/, 'first_name'],
        [/\b(last\s*name|family\s*name|surname|lname)\b/, 'last_name'],
        [/\b(full\s*name|your\s*name|name)\b/, 'full_name'],
        [/\b(e-?mail|email\s*address)\b/, 'email'],
        [/\b(phone|mobile|cell|telephone|tel)\b/, 'phone'],
        [/\b(address|street)\b.*\b(1|one|line\s*1)\b/, 'address_line1'],
        [/\b(address|street)\b.*\b(2|two|line\s*2)\b/, 'address_line2'],
        [/\b(city|town)\b/, 'city'],
        [/\b(state|province|region)\b/, 'state'],
        [/\b(zip|postal|postcode)\b/, 'zip'],
        [/\b(country)\b/, 'country'],
        [/\b(company|organization|employer)\b/, 'company'],
        [/\b(job\s*title|position|role)\b/, 'job_title'],
        [/\b(website|url|homepage)\b/, 'website'],
        [/\b(username|user\s*id|login)\b/, 'username'],
        [/\b(date\s*of\s*birth|dob|birthday|birth\s*date)\b/, 'date_of_birth'],
        [/\b(message|comment|note|description)\b/, 'message'],
    ];

    for (const [pattern, semanticClass] of labelPatterns) {
        if (pattern.test(label)) {
            return semanticClass;
        }
    }

    return 'unknown';
}

/**
 * Generate a hash representing the form's field structure
 * Used for matching forms across page loads
 */
export function generateFormHash(fields: FieldSignature[]): string {
    const fieldDescriptors = fields
        .map((f) => `${f.semanticClass}:${f.inputType}`)
        .sort()
        .join('|');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < fieldDescriptors.length; i++) {
        const char = fieldDescriptors.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return Math.abs(hash).toString(36);
}
