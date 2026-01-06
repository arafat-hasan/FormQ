// Form Types
// Data structures for form detection, field signatures, and fill operations

export interface FormSignature {
    id: string;
    url: string;
    domain: string;
    formIndex: number;
    fields: FieldSignature[];
    detectedAt: number;
}

export interface FieldSignature {
    id: string;
    domPath: string;
    inputType: InputType;
    normalizedLabel: string;
    semanticClass: SemanticClass;

    attributes: {
        name?: string;
        id?: string;
        placeholder?: string;
        autocomplete?: string;
        ariaLabel?: string;
    };

    context: {
        labelText?: string;
        siblingText?: string;
        parentText?: string;
        position: { x: number; y: number };
    };
}

export type InputType =
    | 'text' | 'email' | 'tel' | 'url' | 'password'
    | 'number' | 'date' | 'datetime-local' | 'time'
    | 'select' | 'radio' | 'checkbox' | 'textarea'
    | 'hidden' | 'file' | 'unknown';

export type SemanticClass =
    | 'first_name' | 'last_name' | 'full_name'
    | 'email' | 'phone' | 'address_line1' | 'address_line2'
    | 'city' | 'state' | 'zip' | 'country'
    | 'company' | 'job_title' | 'website'
    | 'username' | 'password'
    | 'date_of_birth' | 'message'
    | 'unknown';

export interface FieldMapping {
    fieldSignature: FieldSignature;
    value: string;
    confidence: number;
    source: 'llm' | 'cache' | 'static' | 'learned';
}

export interface FillResult {
    formSignature: FormSignature;
    mappings: FieldMapping[];
    skippedFields: SkippedField[];
    timestamp: number;
    source: 'llm' | 'cache' | 'static' | 'learned';
}

export interface SkippedField {
    fieldId: string;
    reason: 'denylist' | 'no_value' | 'user_skip' | 'error';
}
