// Storage Types
// Database schema types for IndexedDB

import type { Profile } from './profile';

export const STORAGE_VERSION = 2;  // Incremented for schema migration
export const DATABASE_NAME = 'FormQ_db';

export const STORES = {
    PROFILES: 'profiles',
    VECTORS: 'vectors',
    CACHE: 'llm_cache',
    METADATA: 'metadata',
} as const;

export type StoreName = typeof STORES[keyof typeof STORES];

export interface VectorEntry {
    id: string;
    profileId: string;
    embedding: number[];
    sourceType: 'learned_example' | 'document' | 'knowledge_base';  // Added knowledge_base
    sourceId: string;
    text: string;
    createdAt: number;
}

export interface CacheEntry {
    key: string;
    value: unknown;
    createdAt: number;
    expiresAt?: number;
}

export interface MetadataEntry {
    key: string;
    value: unknown;
}

export interface AppSettings {
    debugMode: boolean;
    autoFillEnabled: boolean;
    humanizeTyping: boolean;
    typingDelayMs: number;
    showNotifications: boolean;
    encryptSensitiveFields: boolean;
}

// Type-safe store value mapping
export interface StoreValueMap {
    profiles: Profile;
    vectors: VectorEntry;
    llm_cache: CacheEntry;
    metadata: {
        settings: AppSettings;
        [key: string]: unknown;
    };
}
