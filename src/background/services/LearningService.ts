// Learning Service
// Captures and stores user edits for learning

import type { FormSignature, FieldMapping, LearnedExample } from '@shared/types';
import { profileService } from '@shared/storage';
import { ragEngine } from '../ai/RAGEngine';
import { createLogger } from '@shared/utils';

const logger = createLogger('LearningService');

// ============================================================================
// Types
// ============================================================================

export interface EditEvent {
    formSignature: FormSignature;
    originalMapping: FieldMapping;
    newValue: string;
    timestamp: number;
}

export interface LearningConfig {
    enabled: boolean;
    minConfidenceToLearn: number;       // Only learn from edits where original confidence was below this
    maxExamplesPerProfile: number;      // Maximum learned examples to keep per profile
    deduplicationThreshold: number;     // Similarity threshold for deduplication
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: LearningConfig = {
    enabled: true,
    minConfidenceToLearn: 0.95,        // Learn when original fill wasn't perfect
    maxExamplesPerProfile: 100,
    deduplicationThreshold: 0.9,
};

// Pending edits buffer (per profile)
const pendingEdits = new Map<string, EditEvent[]>();

// ============================================================================
// Learning Service
// ============================================================================

export class LearningService {
    private config: LearningConfig;
    private initialized: boolean = false;

    constructor(config?: Partial<LearningConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the learning service
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await ragEngine.init();
        this.initialized = true;
        logger.debug('Learning service initialized');
    }

    /**
     * Record a user edit for potential learning
     */
    async recordEdit(
        profileId: string,
        edit: EditEvent
    ): Promise<void> {
        if (!this.config.enabled) {
            return;
        }

        // Only learn from edits where we weren't confident
        if (edit.originalMapping.confidence >= this.config.minConfidenceToLearn) {
            logger.debug('Edit ignored - original confidence too high', {
                confidence: edit.originalMapping.confidence,
                threshold: this.config.minConfidenceToLearn,
            });
            return;
        }

        // Add to pending edits buffer
        const edits = pendingEdits.get(profileId) ?? [];
        edits.push(edit);
        pendingEdits.set(profileId, edits);

        logger.debug('Edit recorded', {
            profileId,
            fieldId: edit.originalMapping.fieldSignature.id,
            oldValue: edit.originalMapping.value,
            newValue: edit.newValue,
        });
    }

    /**
     * Commit pending edits as a learned example
     */
    async commitEdits(profileId: string): Promise<LearnedExample | null> {
        await this.init();

        const edits = pendingEdits.get(profileId);
        if (!edits || edits.length === 0) {
            return null;
        }

        // Clear pending edits
        pendingEdits.delete(profileId);

        // Get the profile
        const profile = await profileService.getById(profileId);
        if (!profile) {
            logger.warn('Profile not found for learning', { profileId });
            return null;
        }

        // Create learned example from edits
        const formSignature = edits[0].formSignature;
        const fieldMappings: FieldMapping[] = edits.map((edit) => ({
            fieldSignature: edit.originalMapping.fieldSignature,
            value: edit.newValue,
            confidence: 1.0, // User-provided values have max confidence
            source: 'learned' as const,
        }));

        const example: LearnedExample = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            formSignature,
            fieldMappings,
            source: 'user_edit',
        };

        // Add to profile's learned examples
        const updatedExamples = [...profile.learnedExamples, example];

        // Enforce max examples limit (remove oldest)
        while (updatedExamples.length > this.config.maxExamplesPerProfile) {
            updatedExamples.shift();
        }

        // Update profile
        await profileService.update(profileId, {
            learnedExamples: updatedExamples,
        });

        // Ingest into RAG engine for future retrieval
        await ragEngine.ingestLearnedExample(profileId, example);

        logger.info('Learned example committed', {
            profileId,
            exampleId: example.id,
            mappingCount: fieldMappings.length,
            totalExamples: updatedExamples.length,
        });

        return example;
    }

    /**
     * Cancel pending edits without learning
     */
    cancelEdits(profileId: string): void {
        const hadEdits = pendingEdits.has(profileId);
        pendingEdits.delete(profileId);

        if (hadEdits) {
            logger.debug('Pending edits cancelled', { profileId });
        }
    }

    /**
     * Get pending edit count for a profile
     */
    getPendingEditCount(profileId: string): number {
        return pendingEdits.get(profileId)?.length ?? 0;
    }

    /**
     * Manually add a learned example (explicit save)
     */
    async addLearnedExample(
        profileId: string,
        formSignature: FormSignature,
        fieldMappings: FieldMapping[]
    ): Promise<LearnedExample> {
        await this.init();

        const profile = await profileService.getById(profileId);
        if (!profile) {
            throw new Error('Profile not found');
        }

        const example: LearnedExample = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            formSignature,
            fieldMappings: fieldMappings.map((m) => ({
                ...m,
                source: 'learned' as const,
            })),
            source: 'explicit_save',
        };

        // Add to profile
        const updatedExamples = [...profile.learnedExamples, example];

        // Enforce max examples limit
        while (updatedExamples.length > this.config.maxExamplesPerProfile) {
            updatedExamples.shift();
        }

        await profileService.update(profileId, {
            learnedExamples: updatedExamples,
        });

        // Ingest into RAG
        await ragEngine.ingestLearnedExample(profileId, example);

        logger.info('Learned example added explicitly', {
            profileId,
            exampleId: example.id,
        });

        return example;
    }

    /**
     * Remove a learned example
     */
    async removeLearnedExample(
        profileId: string,
        exampleId: string
    ): Promise<void> {
        const profile = await profileService.getById(profileId);
        if (!profile) {
            throw new Error('Profile not found');
        }

        const updatedExamples = profile.learnedExamples.filter(
            (e: LearnedExample) => e.id !== exampleId
        );

        await profileService.update(profileId, {
            learnedExamples: updatedExamples,
        });

        logger.debug('Learned example removed', { profileId, exampleId });
    }

    /**
     * Re-index all learned examples for a profile
     */
    async reindexProfile(profileId: string): Promise<number> {
        await this.init();

        const profile = await profileService.getById(profileId);
        if (!profile) {
            throw new Error('Profile not found');
        }

        // Clear existing vectors for this profile
        await ragEngine.clearProfile(profileId);

        // Re-ingest all learned examples
        let count = 0;
        for (const example of profile.learnedExamples) {
            await ragEngine.ingestLearnedExample(profileId, example);
            count++;
        }

        // Ingest documents
        for (const doc of profile.staticContext.documents) {
            if (doc.content) {
                await ragEngine.ingestDocument(profileId, doc.id, doc.content);
            }
        }

        logger.info('Profile reindexed', {
            profileId,
            learnedExamples: count,
            documents: profile.staticContext.documents.length,
        });

        return count;
    }

    /**
     * Update configuration
     */
    setConfig(config: Partial<LearningConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): LearningConfig {
        return { ...this.config };
    }

    /**
     * Check if learning is enabled
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const learningService = new LearningService();
