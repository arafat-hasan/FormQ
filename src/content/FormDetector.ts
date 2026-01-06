// Form Detector
// Detect and extract forms from the current page

import type { FormSignature, FieldSignature } from '@shared/types';
import { createLogger, extractDomain } from '@shared/utils';
import { isElementVisible } from './DOMUtils';
import { extractFieldSignature, generateFormHash } from './FieldSignature';

const logger = createLogger('FormDetector');

/**
 * Selectors for finding form fields
 */
const FIELD_SELECTORS = [
    'input:not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'select',
    'textarea',
];

/**
 * Detect all forms on the current page
 */
export function detectForms(): FormSignature[] {
    const forms: FormSignature[] = [];

    // Strategy 1: Detect explicit <form> elements
    const formElements = document.querySelectorAll('form');
    formElements.forEach((formEl, index) => {
        const formSignature = extractFormSignature(formEl, index);
        if (formSignature && formSignature.fields.length > 0) {
            forms.push(formSignature);
        }
    });

    // Strategy 2: Detect orphan fields (fields not inside a form)
    const orphanFields = findOrphanFields();
    if (orphanFields.length > 0) {
        const orphanForm = createOrphanFormSignature(orphanFields, forms.length);
        if (orphanForm.fields.length > 0) {
            forms.push(orphanForm);
        }
    }

    logger.info(`Detected ${forms.length} form(s)`, {
        fieldCounts: forms.map((f) => f.fields.length)
    });

    return forms;
}

/**
 * Extract a form signature from a form element
 */
function extractFormSignature(
    formElement: HTMLFormElement,
    formIndex: number
): FormSignature | null {
    const fields = extractFieldsFromContainer(formElement);

    // Filter to only visible fields
    const visibleFields = fields.filter((_, i) => {
        const elements = formElement.querySelectorAll(FIELD_SELECTORS.join(','));
        return elements[i] && isElementVisible(elements[i]);
    });

    if (visibleFields.length === 0) {
        return null;
    }

    const formId = generateFormHash(visibleFields);

    return {
        id: formId,
        url: window.location.href,
        domain: extractDomain(window.location.href),
        formIndex,
        fields: visibleFields,
        detectedAt: Date.now(),
    };
}

/**
 * Extract field signatures from a container element
 */
function extractFieldsFromContainer(container: Element): FieldSignature[] {
    const fields: FieldSignature[] = [];
    const selector = FIELD_SELECTORS.join(',');
    const elements = container.querySelectorAll(selector);

    elements.forEach((element) => {
        if (!isElementVisible(element)) {
            return;
        }

        const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

        // Skip hidden inputs (they're usually for CSRF tokens, etc.)
        if (input instanceof HTMLInputElement && input.type === 'hidden') {
            return;
        }

        try {
            const signature = extractFieldSignature(input);
            fields.push(signature);
        } catch (error) {
            logger.warn('Failed to extract field signature', { error, element });
        }
    });

    return fields;
}

/**
 * Find form fields that are not inside any <form> element
 */
function findOrphanFields(): Element[] {
    const allFields = document.querySelectorAll(FIELD_SELECTORS.join(','));
    const orphans: Element[] = [];

    allFields.forEach((field) => {
        if (!field.closest('form') && isElementVisible(field)) {
            orphans.push(field);
        }
    });

    return orphans;
}

/**
 * Create a form signature for orphan fields
 */
function createOrphanFormSignature(
    orphanElements: Element[],
    formIndex: number
): FormSignature {
    const fields: FieldSignature[] = [];

    orphanElements.forEach((element) => {
        const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

        // Skip hidden inputs
        if (input instanceof HTMLInputElement && input.type === 'hidden') {
            return;
        }

        try {
            const signature = extractFieldSignature(input);
            fields.push(signature);
        } catch (error) {
            logger.warn('Failed to extract orphan field signature', { error });
        }
    });

    const formId = generateFormHash(fields);

    return {
        id: formId,
        url: window.location.href,
        domain: extractDomain(window.location.href),
        formIndex,
        fields,
        detectedAt: Date.now(),
    };
}

/**
 * Create a mutation observer to detect dynamically added forms
 */
export function createFormObserver(
    callback: (forms: FormSignature[]) => void
): MutationObserver {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver((mutations) => {
        // Check if any mutations involve form-related elements
        const hasFormChanges = mutations.some((mutation) => {
            // Check added nodes
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    if (node.tagName === 'FORM' ||
                        node.tagName === 'INPUT' ||
                        node.tagName === 'SELECT' ||
                        node.tagName === 'TEXTAREA' ||
                        node.querySelector('form, input, select, textarea')) {
                        return true;
                    }
                }
            }
            return false;
        });

        if (hasFormChanges) {
            // Debounce to avoid excessive re-detection
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                const forms = detectForms();
                callback(forms);
                debounceTimer = null;
            }, 300);
        }
    });

    return observer;
}

/**
 * Start observing for form changes
 */
export function startFormObserver(
    callback: (forms: FormSignature[]) => void
): MutationObserver {
    const observer = createFormObserver(callback);

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    logger.debug('Started form observer');

    return observer;
}
