// Embedding Service
// Generates text embeddings via OpenRouter API

import { openRouterClient } from '../services/OpenRouterClient';
import { createLogger } from '@shared/utils';

const logger = createLogger('EmbeddingService');

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
    embedding: number[];
    text: string;
    tokensUsed: number;
}

export interface BatchEmbeddingResult {
    embeddings: Array<{ text: string; embedding: number[] }>;
    totalTokens: number;
}

// ============================================================================
// Constants
// ============================================================================

// Maximum texts to embed in a single batch request
const MAX_BATCH_SIZE = 20;

// Simple in-memory cache for embeddings (text hash -> embedding)
const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

// ============================================================================
// Embedding Service
// ============================================================================

export class EmbeddingService {
    private initialized: boolean = false;

    /**
     * Initialize the embedding service
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await openRouterClient.init();
        this.initialized = true;
        logger.debug('Embedding service initialized');
    }

    /**
     * Generate embedding for a single text
     */
    async embed(text: string, useCache: boolean = true): Promise<EmbeddingResult> {
        await this.init();

        // Check cache first
        if (useCache) {
            const cacheKey = this.hashText(text);
            const cached = embeddingCache.get(cacheKey);
            if (cached) {
                logger.debug('Embedding cache hit', { textLength: text.length });
                return { embedding: cached, text, tokensUsed: 0 };
            }
        }

        // Call API
        const response = await openRouterClient.createEmbedding({
            input: text,
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding) {
            throw new Error('No embedding returned from API');
        }

        // Cache the result
        if (useCache) {
            this.cacheEmbedding(text, embedding);
        }

        logger.debug('Embedding generated', {
            textLength: text.length,
            dimensions: embedding.length,
            tokensUsed: response.usage.totalTokens,
        });

        return {
            embedding,
            text,
            tokensUsed: response.usage.totalTokens,
        };
    }

    /**
     * Generate embeddings for multiple texts in batch
     */
    async embedBatch(texts: string[], useCache: boolean = true): Promise<BatchEmbeddingResult> {
        await this.init();

        if (texts.length === 0) {
            return { embeddings: [], totalTokens: 0 };
        }

        const results: Array<{ text: string; embedding: number[] }> = [];
        const textsToEmbed: string[] = [];
        const textIndexMap: number[] = []; // Maps API response index to original index
        let totalTokens = 0;

        // Check cache for each text
        for (let i = 0; i < texts.length; i++) {
            const text = texts[i];
            if (useCache) {
                const cacheKey = this.hashText(text);
                const cached = embeddingCache.get(cacheKey);
                if (cached) {
                    results.push({ text, embedding: cached });
                    continue;
                }
            }
            textsToEmbed.push(text);
            textIndexMap.push(i);
        }

        // If all were cached, return early
        if (textsToEmbed.length === 0) {
            logger.debug('All embeddings from cache', { count: texts.length });
            return { embeddings: results, totalTokens: 0 };
        }

        // Batch embed remaining texts
        const batchResults: Array<{ text: string; embedding: number[] }> = [];

        for (let i = 0; i < textsToEmbed.length; i += MAX_BATCH_SIZE) {
            const batch = textsToEmbed.slice(i, i + MAX_BATCH_SIZE);

            const response = await openRouterClient.createEmbedding({
                input: batch,
            });

            totalTokens += response.usage.totalTokens;

            for (let j = 0; j < response.data.length; j++) {
                const text = batch[j];
                const embedding = response.data[j].embedding;

                batchResults.push({ text, embedding });

                // Cache the result
                if (useCache) {
                    this.cacheEmbedding(text, embedding);
                }
            }
        }

        // Combine cached and new results in original order
        const allResults: Array<{ text: string; embedding: number[] }> = [];
        let cachedIdx = 0;
        let newIdx = 0;

        for (let i = 0; i < texts.length; i++) {
            if (textIndexMap.includes(i)) {
                // This was embedded via API
                allResults.push(batchResults[newIdx]);
                newIdx++;
            } else {
                // This was cached
                allResults.push(results[cachedIdx]);
                cachedIdx++;
            }
        }

        logger.debug('Batch embedding complete', {
            total: texts.length,
            cached: texts.length - textsToEmbed.length,
            embedded: textsToEmbed.length,
            totalTokens,
        });

        return { embeddings: allResults, totalTokens };
    }

    /**
     * Compute cosine similarity between two embeddings
     */
    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Embedding dimensions must match');
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

    /**
     * Find the most similar embeddings to a query
     */
    findMostSimilar(
        queryEmbedding: number[],
        candidates: Array<{ id: string; embedding: number[] }>,
        topK: number = 5,
        threshold: number = 0.0
    ): Array<{ id: string; similarity: number }> {
        const scored = candidates.map((candidate) => ({
            id: candidate.id,
            similarity: this.cosineSimilarity(queryEmbedding, candidate.embedding),
        }));

        return scored
            .filter((s) => s.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    /**
     * Clear the embedding cache
     */
    clearCache(): void {
        embeddingCache.clear();
        logger.debug('Embedding cache cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; maxSize: number } {
        return {
            size: embeddingCache.size,
            maxSize: MAX_CACHE_SIZE,
        };
    }

    /**
     * Simple hash function for cache keys
     */
    private hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(36);
    }

    /**
     * Cache an embedding, evicting oldest if at capacity
     */
    private cacheEmbedding(text: string, embedding: number[]): void {
        const cacheKey = this.hashText(text);

        // Simple LRU: remove oldest entry if at capacity
        if (embeddingCache.size >= MAX_CACHE_SIZE) {
            const firstKey = embeddingCache.keys().next().value;
            if (firstKey !== undefined) {
                embeddingCache.delete(firstKey);
            }
        }

        embeddingCache.set(cacheKey, embedding);
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const embeddingService = new EmbeddingService();
