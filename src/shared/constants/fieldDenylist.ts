// Field Denylist
// Fields that should NEVER be auto-filled for security reasons

import type { FieldSignature } from '@shared/types';

/**
 * Security-critical denylist of field patterns.
 * These fields will never be auto-filled regardless of context.
 */
export const FIELD_DENYLIST: ReadonlySet<string> = new Set([
    // Authentication
    'password',
    'passwd',
    'pwd',
    'current-password',
    'new-password',
    'confirm-password',
    'confirmpassword',
    'password_confirmation',

    // Multi-factor Authentication
    'otp',
    '2fa',
    'totp',
    'verification-code',
    'verificationcode',
    'mfa',
    'pin',
    'security-code',
    'securitycode',

    // Payment Security
    'cvv',
    'cvc',
    'cvv2',
    'cvc2',
    'card-cvc',
    'card-cvv',
    'security-number',

    // Sensitive Tokens
    'token',
    'csrf',
    'nonce',
    'captcha',
    'recaptcha',
    'hcaptcha',

    // Banking & Identity
    'ssn',
    'social-security',
    'socialsecurity',
    'tax-id',
    'taxid',
    'routing-number',
    'routingnumber',
    'account-number',
    'accountnumber',
]);

/**
 * Autocomplete attribute values that indicate sensitive fields
 */
const AUTOCOMPLETE_DENYLIST: ReadonlySet<string> = new Set([
    'new-password',
    'current-password',
    'one-time-code',
    'cc-csc',
]);

/**
 * Check if a field should be skipped based on security rules
 */
export function isFieldDenylisted(field: FieldSignature): boolean {
    const { inputType, attributes, normalizedLabel } = field;

    // Always skip password fields
    if (inputType === 'password') {
        return true;
    }

    // Check autocomplete attribute
    if (attributes.autocomplete) {
        const autocomplete = attributes.autocomplete.toLowerCase().trim();
        if (AUTOCOMPLETE_DENYLIST.has(autocomplete)) {
            return true;
        }
    }

    // Check normalized label against denylist
    const labelLower = normalizedLabel.toLowerCase();
    for (const denied of FIELD_DENYLIST) {
        if (labelLower.includes(denied)) {
            return true;
        }
    }

    // Check name and id attributes
    const nameAttr = (attributes.name || '').toLowerCase();
    const idAttr = (attributes.id || '').toLowerCase();

    for (const denied of FIELD_DENYLIST) {
        if (nameAttr.includes(denied) || idAttr.includes(denied)) {
            return true;
        }
    }

    return false;
}

/**
 * Get the reason a field was denylisted (for logging/UI)
 */
export function getDenylistReason(field: FieldSignature): string | null {
    if (field.inputType === 'password') {
        return 'Password fields are never auto-filled';
    }

    if (field.attributes.autocomplete) {
        const autocomplete = field.attributes.autocomplete.toLowerCase().trim();
        if (AUTOCOMPLETE_DENYLIST.has(autocomplete)) {
            return `Autocomplete attribute "${autocomplete}" indicates sensitive field`;
        }
    }

    const labelLower = field.normalizedLabel.toLowerCase();
    for (const denied of FIELD_DENYLIST) {
        if (labelLower.includes(denied)) {
            return `Field label contains "${denied}"`;
        }
    }

    return null;
}
