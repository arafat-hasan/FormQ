// State Types
// Fill workflow state machine types

import type { FormSignature, FieldMapping } from './form';

export type FillState =
    | IdleState
    | DetectingState
    | AnalyzingState
    | RetrievingState
    | InferringState
    | FillingState
    | AwaitingReviewState
    | LearningState
    | ErrorState;

interface BaseState {
    type: string;
    tabId: number;
    timestamp: number;
}

export interface IdleState extends BaseState {
    type: 'IDLE';
}

export interface DetectingState extends BaseState {
    type: 'DETECTING';
}

export interface AnalyzingState extends BaseState {
    type: 'ANALYZING';
    formSignature: FormSignature;
}

export interface RetrievingState extends BaseState {
    type: 'RETRIEVING';
    formSignature: FormSignature;
    profileId: string;
}

export interface InferringState extends BaseState {
    type: 'INFERRING';
    formSignature: FormSignature;
    profileId: string;
    retrievedContext: string[];
}

export interface FillingState extends BaseState {
    type: 'FILLING';
    profileId?: string;
    formSignature: FormSignature;
    mappings: FieldMapping[];
    progress: { completed: number; total: number };
}

export interface AwaitingReviewState extends BaseState {
    type: 'AWAITING_REVIEW';
    formSignature: FormSignature;
    mappings: FieldMapping[];
}

export interface LearningState extends BaseState {
    type: 'LEARNING';
    formSignature: FormSignature;
    edits: Array<{ fieldId: string; oldValue: string; newValue: string }>;
}

export interface ErrorState extends BaseState {
    type: 'ERROR';
    error: string;
    code: ErrorCode;
    previousState?: FillState;
}

export type ErrorCode =
    | 'FORM_NOT_FOUND'
    | 'PROFILE_NOT_FOUND'
    | 'LLM_ERROR'
    | 'VALIDATION_ERROR'
    | 'SECURITY_BLOCK'
    | 'CANCELLED'
    | 'UNKNOWN';

// Transitions
export type FillEvent =
    | { type: 'FORM_FOUND'; formSignature: FormSignature }
    | { type: 'ANALYSIS_COMPLETE'; formSignature: FormSignature }
    | { type: 'CONTEXT_RETRIEVED'; context: string[] }
    | { type: 'INFERENCE_COMPLETE'; mappings: FieldMapping[] }
    | { type: 'FILL_PROGRESS'; completed: number; total: number }
    | { type: 'FILL_COMPLETE' }
    | { type: 'USER_APPROVED' }
    | { type: 'USER_CANCELLED' }
    | { type: 'EDITS_DETECTED'; edits: Array<{ fieldId: string; oldValue: string; newValue: string }> }
    | { type: 'LEARNING_COMPLETE' }
    | { type: 'ERROR'; error: string; code: ErrorCode }
    | { type: 'RESET' };
