// Profile Types
// Core data structures for user profiles and context

export interface Profile {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    version: number;

    staticContext: StaticContext;
    learnedExamples: LearnedExample[];
    urlBindings: URLBinding[];
    settings: ProfileSettings;
}

export interface StaticContext {
    fields: ContextField[];  // Changed from Record to Array for flexibility
    documents: ContextDocument[];
    knowledgeBase?: string;  // Free-text knowledge for AI context
    knowledgeBaseChunks?: number;  // Number of embedded chunks
}

export interface ContextField {
    key: string;
    value: string;
    category: FieldCategory;
    isEncrypted: boolean;
}

export type FieldCategory =
    | 'personal'
    | 'contact'
    | 'professional'
    | 'education'
    | 'custom';

export interface ContextDocument {
    id: string;
    name: string;
    content: string;
    type: 'resume' | 'cover_letter' | 'other';
    embedding?: number[];
}

export interface LearnedExample {
    id: string;
    timestamp: number;
    formSignature: FormSignature;
    fieldMappings: FieldMapping[];
    source: 'user_edit' | 'explicit_save';
    embedding?: number[];
}

export interface URLBinding {
    pattern: string;
    type: 'exact' | 'domain' | 'regex';
    priority: number;
}

export interface ProfileSettings {
    autoFill: boolean;
    confirmBeforeFill: boolean;
    humanizeTyping: boolean;
    typingDelayMs: number;
}

// Forward declarations for cross-references
import type { FormSignature, FieldMapping } from './form';
export type { FormSignature, FieldMapping };
