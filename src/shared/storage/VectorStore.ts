// Vector Store
// In-memory vector store with IndexedDB persistence for RAG

import type { VectorEntry } from '@shared/types';
import { storageService } from './StorageService';
import { createLogger } from '@shared/utils';

const logger = createLogger('VectorStore');

// ============================================================================
// Types
// ============================================================================

export interface SearchResult extends VectorEntry {
    similarity: number;
}

export interface VectorStoreStats {
    profileId: string;
    vectorCount: number;
    byType: {
        learned_example: number;
        document: number;
        knowledge_base: number;  // Added knowledge_base
    };
}

// ============================================================================
// Vector Store
// ============================================================================

export class VectorStore {
    // In-memory cache: profileId -> vectors
    private cache: Map<string, VectorEntry[]> = new Map();
    private initialized: boolean = false;

    /**
     * Initialize the vector store
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await storageService.init();
        this.initialized = true;
        logger.debug('Vector store initialized');
    }

    /**
     * Get all vectors for a profile (with caching)
     */
    async getVectors(profileId: string): Promise<VectorEntry[]> {
        await this.init();

        // Check cache
        const cached = this.cache.get(profileId);
        if (cached) {
            return cached;
        }

        // Load from IndexedDB
        const vectors = await storageService.getVectorsByProfile(profileId);
        this.cache.set(profileId, vectors);

        logger.debug('Loaded vectors from storage', {
            profileId,
            count: vectors.length,
        });

        return vectors;
    }

    /**
     * Search for similar vectors using cosine similarity
     */
    async search(
        profileId: string,
        queryEmbedding: number[],
        topK: number = 5,
        threshold: number = 0.0
    ): Promise<SearchResult[]> {
        const vectors = await this.getVectors(profileId);

        if (vectors.length === 0) {
            return [];
        }

        // Compute similarity for each vector
        const results: SearchResult[] = vectors.map((v) => ({
            ...v,
            similarity: this.cosineSimilarity(queryEmbedding, v.embedding),
        }));

        // Filter and sort
        const filtered = results
            .filter((r) => r.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);

        logger.debug('Vector search complete', {
            profileId,
            totalVectors: vectors.length,
            aboveThreshold: filtered.length,
            topSimilarity: filtered[0]?.similarity ?? 0,
        });

        return filtered;
    }

    /**
     * Add or update a vector
     */
    async upsert(entry: VectorEntry): Promise<void> {
        await this.init();

        // Save to IndexedDB
        await storageService.saveVector(entry);

        // Update cache
        const cached = this.cache.get(entry.profileId);
        if (cached) {
            const index = cached.findIndex((v) => v.id === entry.id);
            if (index >= 0) {
                cached[index] = entry;
            } else {
                cached.push(entry);
            }
        }

        logger.debug('Vector upserted', {
            id: entry.id,
            profileId: entry.profileId,
            sourceType: entry.sourceType,
        });
    }

    /**
     * Add multiple vectors in batch
     */
    async upsertBatch(entries: VectorEntry[]): Promise<void> {
        await this.init();

        for (const entry of entries) {
            await storageService.saveVector(entry);
        }

        // Invalidate affected profile caches
        const affectedProfiles = new Set(entries.map((e) => e.profileId));
        for (const profileId of affectedProfiles) {
            this.cache.delete(profileId);
        }

        logger.debug('Batch vector upsert', { count: entries.length });
    }

    /**
     * Delete a vector by ID
     */
    async delete(id: string, profileId: string): Promise<void> {
        await this.init();

        // Update cache
        const cached = this.cache.get(profileId);
        if (cached) {
            const index = cached.findIndex((v) => v.id === id);
            if (index >= 0) {
                cached.splice(index, 1);
            }
        }

        // Note: StorageService doesn't have single vector delete,
        // we'd need to add it or reload the cache after profile vector deletion
        logger.debug('Vector deleted from cache', { id, profileId });
    }

    /**
     * Delete all vectors for a profile
     */
    async deleteByProfile(profileId: string): Promise<void> {
        await this.init();

        await storageService.deleteVectorsByProfile(profileId);
        this.cache.delete(profileId);

        logger.debug('All vectors deleted for profile', { profileId });
    }

    /**
     * Delete vectors by source type for a profile
     */
    async deleteBySourceType(
        profileId: string,
        sourceType: 'learned_example' | 'document' | 'knowledge_base'
    ): Promise<void> {
        await this.init();

        // Get current vectors
        const vectors = await this.getVectors(profileId);

        // Filter out vectors of the specified type
        const remaining = vectors.filter(v => v.sourceType !== sourceType);

        // Clear all existing vectors for this profile
        await storageService.deleteVectorsByProfile(profileId);

        // Re-insert remaining vectors
        if (remaining.length > 0) {
            await this.upsertBatch(remaining);
        } else {
            // Invalidate cache
            this.cache.delete(profileId);
        }

        logger.debug('Vectors deleted by source type', {
            profileId,
            sourceType,
            deleted: vectors.length - remaining.length,
        });
    }

    /**
     * Get statistics for a profile's vectors
     */
    async getStats(profileId: string): Promise<VectorStoreStats> {
        const vectors = await this.getVectors(profileId);

        const byType = {
            learned_example: 0,
            document: 0,
            knowledge_base: 0,  // Added knowledge_base
        };

        for (const v of vectors) {
            if (v.sourceType in byType) {
                byType[v.sourceType as keyof typeof byType]++;
            }
        }

        return {
            profileId,
            vectorCount: vectors.length,
            byType,
        };
    }

    /**
     * Clear the in-memory cache
     */
    clearCache(): void {
        this.cache.clear();
        logger.debug('Vector store cache cleared');
    }

    /**
     * Compute cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            logger.warn('Embedding dimension mismatch', {
                aLength: a.length,
                bLength: b.length,
            });
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        if (magnitude === 0) return 0;

        return dotProduct / magnitude;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const vectorStore = new VectorStore();
