// Cache Service
// LLM response caching to reduce API calls

import type { FormSignature, FieldMapping, FieldSignature } from '@shared/types';
import { storageService } from '@shared/storage';
import { createLogger } from '@shared/utils';

const logger = createLogger('CacheService');

// ============================================================================
// Types
// ============================================================================

export interface CachedFillResponse {
    mappings: FieldMapping[];
    tokensUsed: number;
    createdAt: number;
    hitCount: number;
}

export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    hitRate: number;
}

// ============================================================================
// Constants
// ============================================================================

// Default TTL: 7 days
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Cache key prefix
const CACHE_PREFIX = 'llm_fill_';

// In-memory stats
let cacheHits = 0;
let cacheMisses = 0;

// ============================================================================
// Cache Service
// ============================================================================

export class CacheService {
    private ttlMs: number;
    private initialized: boolean = false;

    constructor(ttlMs: number = DEFAULT_TTL_MS) {
        this.ttlMs = ttlMs;
    }

    /**
     * Initialize the cache service
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await storageService.init();

        // Clean up expired entries on init
        await this.cleanExpired();

        this.initialized = true;
        logger.debug('Cache service initialized');
    }

    /**
     * Get a cached fill response
     */
    async get(
        formSignature: FormSignature,
        profileId: string
    ): Promise<CachedFillResponse | null> {
        await this.init();

        const key = this.buildCacheKey(formSignature, profileId);
        const cached = await storageService.getCache<CachedFillResponse>(key);

        if (cached) {
            cacheHits++;

            // Update hit count
            cached.hitCount++;
            await storageService.setCache(key, cached, this.ttlMs);

            logger.debug('Cache hit', {
                key,
                hitCount: cached.hitCount,
                age: Date.now() - cached.createdAt,
            });

            return cached;
        }

        cacheMisses++;
        logger.debug('Cache miss', { key });
        return null;
    }

    /**
     * Store a fill response in cache
     */
    async set(
        formSignature: FormSignature,
        profileId: string,
        mappings: FieldMapping[],
        tokensUsed: number
    ): Promise<void> {
        await this.init();

        const key = this.buildCacheKey(formSignature, profileId);
        const entry: CachedFillResponse = {
            mappings,
            tokensUsed,
            createdAt: Date.now(),
            hitCount: 0,
        };

        await storageService.setCache(key, entry, this.ttlMs);

        logger.debug('Cached fill response', {
            key,
            mappingCount: mappings.length,
            tokensUsed,
        });
    }

    /**
     * Invalidate cache for a profile
     */
    async invalidateProfile(profileId: string): Promise<void> {
        // Note: This would require iterating all cache entries
        // For now, we rely on TTL expiration
        logger.debug('Profile cache invalidation requested', { profileId });
    }

    /**
     * Invalidate cache for a specific form + profile
     */
    async invalidate(
        formSignature: FormSignature,
        profileId: string
    ): Promise<void> {
        await this.init();

        const key = this.buildCacheKey(formSignature, profileId);
        await storageService.deleteCache(key);

        logger.debug('Cache entry invalidated', { key });
    }

    /**
     * Clean expired cache entries
     */
    async cleanExpired(): Promise<number> {
        await this.init();
        const count = await storageService.clearExpiredCache();

        if (count > 0) {
            logger.info('Cleaned expired cache entries', { count });
        }

        return count;
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = cacheHits + cacheMisses;
        return {
            hits: cacheHits,
            misses: cacheMisses,
            size: 0, // Would need to query storage
            hitRate: total > 0 ? cacheHits / total : 0,
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        cacheHits = 0;
        cacheMisses = 0;
    }

    /**
     * Build a cache key from form signature and profile
     */
    private buildCacheKey(
        formSignature: FormSignature,
        profileId: string
    ): string {
        // Create a stable key from form structure
        const formHash = this.hashFormSignature(formSignature);
        return `${CACHE_PREFIX}${profileId}_${formHash}`;
    }

    /**
     * Hash a form signature for cache key
     */
    private hashFormSignature(formSignature: FormSignature): string {
        // Hash based on domain and field structure
        const fieldIds = formSignature.fields
            .map((f: FieldSignature) => `${f.semanticClass}:${f.inputType}`)
            .sort()
            .join('|');

        const str = `${formSignature.domain}:${fieldIds}`;

        // Simple hash function
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return Math.abs(hash).toString(36);
    }

    /**
     * Set cache TTL
     */
    setTTL(ttlMs: number): void {
        this.ttlMs = ttlMs;
    }

    /**
     * Get current TTL
     */
    getTTL(): number {
        return this.ttlMs;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const cacheService = new CacheService();
