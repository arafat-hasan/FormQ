// Fill Executor
// Execute form fills with humanization and event dispatching

import type { FieldMapping, FieldSignature } from '@shared/types';
import { createLogger, sleep } from '@shared/utils';
import { isFieldDenylisted } from '@shared/constants';

const logger = createLogger('FillExecutor');

export interface FillOptions {
    humanize: boolean;
    delayMs: number;
    onProgress?: (completed: number, total: number, field: string) => void;
}

const DEFAULT_OPTIONS: FillOptions = {
    humanize: true,
    delayMs: 50,
};

/**
 * Execute a fill operation on detected form fields
 */
export async function executeFill(
    mappings: FieldMapping[],
    options: Partial<FillOptions> = {}
): Promise<{ success: boolean; filledCount: number; errors: string[] }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const errors: string[] = [];
    let filledCount = 0;

    for (let i = 0; i < mappings.length; i++) {
        const mapping = mappings[i];

        // Check denylist
        if (isFieldDenylisted(mapping.fieldSignature)) {
            logger.warn('Skipping denylisted field', {
                label: mapping.fieldSignature.normalizedLabel
            });
            continue;
        }

        try {
            const element = findFieldElement(mapping.fieldSignature);

            if (!element) {
                errors.push(`Field not found: ${mapping.fieldSignature.normalizedLabel}`);
                continue;
            }

            await fillField(element, mapping.value, opts);
            filledCount++;

            opts.onProgress?.(i + 1, mappings.length, mapping.fieldSignature.normalizedLabel);

            // Delay between fields
            if (opts.delayMs > 0 && i < mappings.length - 1) {
                await sleep(opts.delayMs + (opts.humanize ? randomJitter(20) : 0));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to fill ${mapping.fieldSignature.normalizedLabel}: ${message}`);
            logger.error('Fill error', { field: mapping.fieldSignature.normalizedLabel, error });
        }
    }

    logger.info('Fill complete', { filledCount, errorCount: errors.length });

    return {
        success: errors.length === 0,
        filledCount,
        errors,
    };
}

/**
 * Find a field element by its signature
 */
function findFieldElement(
    signature: FieldSignature
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
    // Try by DOM path first (most specific)
    try {
        const byPath = document.querySelector(signature.domPath);
        if (byPath && isMatchingElement(byPath, signature)) {
            return byPath as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        }
    } catch {
        // Invalid selector, continue to fallbacks
    }

    // Try by ID
    if (signature.attributes.id) {
        const byId = document.getElementById(signature.attributes.id);
        if (byId && isMatchingElement(byId, signature)) {
            return byId as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        }
    }

    // Try by name
    if (signature.attributes.name) {
        const byName = document.querySelector(
            `input[name="${CSS.escape(signature.attributes.name)}"], ` +
            `select[name="${CSS.escape(signature.attributes.name)}"], ` +
            `textarea[name="${CSS.escape(signature.attributes.name)}"]`
        );
        if (byName && isMatchingElement(byName, signature)) {
            return byName as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        }
    }

    return null;
}

/**
 * Check if an element matches a field signature
 */
function isMatchingElement(element: Element, signature: FieldSignature): boolean {
    // Basic type check
    const tagName = element.tagName.toLowerCase();
    if (tagName !== 'input' && tagName !== 'select' && tagName !== 'textarea') {
        return false;
    }

    // Check input type if applicable
    if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (signature.inputType !== 'unknown' && type !== signature.inputType) {
            return false;
        }
    }

    return true;
}

/**
 * Fill a single field with the given value
 */
async function fillField(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    value: string,
    options: FillOptions
): Promise<void> {
    // Focus the element
    element.focus();
    await sleep(10);

    if (element instanceof HTMLSelectElement) {
        await fillSelect(element, value);
    } else if (element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio')) {
        await fillCheckboxRadio(element, value);
    } else {
        await fillTextInput(element, value, options);
    }

    // Blur to trigger validation
    element.blur();
}

/**
 * Fill a text input with optional character-by-character typing
 */
async function fillTextInput(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    options: FillOptions
): Promise<void> {
    // Clear existing value
    element.value = '';
    dispatchInputEvent(element, 'input');

    if (options.humanize) {
        // Type character by character
        for (const char of value) {
            element.value += char;
            dispatchInputEvent(element, 'input');

            // Random typing delay
            await sleep(30 + randomJitter(50));
        }
    } else {
        // Set value directly
        element.value = value;
        dispatchInputEvent(element, 'input');
    }

    // Trigger change event
    dispatchInputEvent(element, 'change');
}

/**
 * Fill a select element
 */
async function fillSelect(element: HTMLSelectElement, value: string): Promise<void> {
    // Find matching option
    const options = Array.from(element.options);

    // Try exact value match
    let matchingOption = options.find((opt) => opt.value === value);

    // Try text match
    if (!matchingOption) {
        matchingOption = options.find(
            (opt) => opt.text.toLowerCase().includes(value.toLowerCase())
        );
    }

    // Try partial value match
    if (!matchingOption) {
        matchingOption = options.find(
            (opt) => opt.value.toLowerCase().includes(value.toLowerCase())
        );
    }

    if (matchingOption) {
        element.value = matchingOption.value;
        dispatchInputEvent(element, 'change');
    } else {
        logger.warn('No matching option found', { value, availableOptions: options.map((o) => o.text) });
    }
}

/**
 * Fill a checkbox or radio input
 */
async function fillCheckboxRadio(element: HTMLInputElement, value: string): Promise<void> {
    const shouldCheck = ['true', 'yes', '1', 'on', 'checked'].includes(value.toLowerCase());

    if (element.type === 'checkbox') {
        if (element.checked !== shouldCheck) {
            element.click();
        }
    } else if (element.type === 'radio' && shouldCheck) {
        element.click();
    }
}

/**
 * Dispatch input/change events
 */
function dispatchInputEvent(element: HTMLElement, eventType: 'input' | 'change'): void {
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);

    // Also dispatch InputEvent for React and other frameworks
    if (eventType === 'input') {
        const inputEvent = new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
        });
        element.dispatchEvent(inputEvent);
    }
}

/**
 * Generate random jitter for humanization
 */
function randomJitter(max: number): number {
    return Math.floor(Math.random() * max);
}
