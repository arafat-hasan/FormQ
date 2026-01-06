// Message Types
// Type-safe message passing between extension components

import type { FormSignature, FieldMapping, FillResult } from './form';
import type { Profile } from './profile';
import type { FillState, ErrorCode } from './state';

export interface Message<T extends MessageType = MessageType> {
    id: string;
    type: T;
    payload: MessagePayloadMap[T];
    timestamp: number;
}

export type MessageType =
    // Content -> Background
    | 'FORM_DETECTED'
    | 'REQUEST_FILL'
    | 'REPORT_EDIT'
    | 'REQUEST_CANCEL'

    // Background -> Content
    | 'FILL_COMMAND'
    | 'FILL_PROGRESS'
    | 'FILL_COMPLETE'
    | 'FILL_ERROR'

    // Popup/Options -> Background
    | 'GET_STATE'
    | 'GET_PROFILES'
    | 'CREATE_PROFILE'
    | 'UPDATE_PROFILE'
    | 'DELETE_PROFILE'
    | 'SET_ACTIVE_PROFILE'
    | 'TRIGGER_FILL'

    // Background -> Popup/Options
    | 'STATE_UPDATE'
    | 'PROFILES_UPDATE'

    // AI-specific messages
    | 'REQUEST_AI_FILL'
    | 'GET_AI_STATUS'
    | 'AI_STATUS'
    | 'SET_API_KEY'
    | 'TEST_API_CONNECTION'
    | 'EMBED_KNOWLEDGE_BASE';  // Added for knowledge base embedding

export interface FillOptions {
    skipConfirmation?: boolean;
    humanize?: boolean;
    delayMs?: number;
}

export interface MessagePayloadMap {
    // Form Detection
    FORM_DETECTED: { formSignature: FormSignature };

    // Fill Request
    REQUEST_FILL: {
        formSignature: FormSignature;
        profileId?: string;
        options?: FillOptions;
    };
    REQUEST_CANCEL: void;

    // Fill Commands
    FILL_COMMAND: { mappings: FieldMapping[]; options?: FillOptions };
    FILL_PROGRESS: { completed: number; total: number; currentField: string };
    FILL_COMPLETE: { result: FillResult };
    FILL_ERROR: { error: string; code: ErrorCode };

    // Edit Reporting
    REPORT_EDIT: {
        formSignature: FormSignature;
        originalMapping: FieldMapping;
        newValue: string;
    };

    // Profile Management
    GET_PROFILES: void;
    CREATE_PROFILE: { profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'version'> };
    UPDATE_PROFILE: { profile: Profile };
    DELETE_PROFILE: { profileId: string };
    SET_ACTIVE_PROFILE: { profileId: string };
    PROFILES_UPDATE: { profiles: Profile[] };

    // State
    GET_STATE: void;
    STATE_UPDATE: { state: FillState };
    TRIGGER_FILL: { profileId?: string };

    // AI-specific
    REQUEST_AI_FILL: { profileId?: string; useCache?: boolean };
    GET_AI_STATUS: void;
    AI_STATUS: { available: boolean; chatModel: string; embeddingModel: string };
    SET_API_KEY: { apiKey: string };
    TEST_API_CONNECTION: void;
    EMBED_KNOWLEDGE_BASE: { profileId: string };  // Added for knowledge base embedding
}

export interface MessageResponseMap {
    GET_STATE: { state: FillState };
    GET_PROFILES: { profiles: Profile[] };
    CREATE_PROFILE: { profile: Profile };
    UPDATE_PROFILE: { profile: Profile };
    DELETE_PROFILE: { success: boolean };
    REQUEST_FILL: { success: boolean };
    REQUEST_AI_FILL: { success: boolean; source?: string; fallbackReason?: string };
    GET_AI_STATUS: { available: boolean; chatModel: string; embeddingModel: string };
    SET_API_KEY: { success: boolean };
    TEST_API_CONNECTION: { success: boolean; error?: string };
    EMBED_KNOWLEDGE_BASE: { success: boolean; chunks?: number; error?: string };  // Added
}

export type MessageResponse<T extends MessageType> = T extends keyof MessageResponseMap
    ? MessageResponseMap[T]
    : void;
