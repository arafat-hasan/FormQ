// IndexedDB Storage Service
// Persistent storage with schema migrations

import type {
    Profile,
    VectorEntry,
    CacheEntry,
    MetadataEntry,
    AppSettings,
    StoreValueMap
} from '@shared/types';
import { createLogger } from '@shared/utils';
import { DATABASE_NAME, STORAGE_VERSION, STORES } from '@shared/types/storage';

const logger = createLogger('StorageService');

/**
 * IndexedDB storage service with typed stores and migration support
 */
export class StorageService {
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    /**
     * Initialize the database connection
     */
    async init(): Promise<void> {
        if (this.db) return;

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.openDatabase().then(async () => {
            // Run post-migration data transformations
            await this.runPostMigrations();
        });
        return this.initPromise;
    }

    /**
     * Open/create the database with migrations
     */
    private openDatabase(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE_NAME, STORAGE_VERSION);

            request.onerror = () => {
                logger.error('Failed to open database', { error: request.error });
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                logger.info('Database opened', { version: this.db.version });
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = request.result;
                const oldVersion = event.oldVersion;

                logger.info('Running migrations', { from: oldVersion, to: STORAGE_VERSION });
                this.runMigrations(db, oldVersion);
            };
        });
    }

    /**
     * Run database migrations
     */
    private runMigrations(db: IDBDatabase, oldVersion: number): void {
        // Version 0 -> 1: Initial schema
        if (oldVersion < 1) {
            // Profiles store
            const profileStore = db.createObjectStore(STORES.PROFILES, { keyPath: 'id' });
            profileStore.createIndex('name', 'name', { unique: false });
            profileStore.createIndex('updatedAt', 'updatedAt', { unique: false });

            // Vectors store (for RAG)
            const vectorStore = db.createObjectStore(STORES.VECTORS, { keyPath: 'id' });
            vectorStore.createIndex('profileId', 'profileId', { unique: false });
            vectorStore.createIndex('sourceType', 'sourceType', { unique: false });

            // Cache store (for LLM responses)
            const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
            cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false });

            // Metadata store (for app settings, etc.)
            db.createObjectStore(STORES.METADATA, { keyPath: 'key' });

            logger.info('Created initial schema (v1)');
        }

        // Version 1 -> 2: Convert fields from Record to Array
        if (oldVersion < 2) {
            logger.info('Migrating schema v1 -> v2: Converting profile fields to array');

            // Migration happens during transaction
            // Note: We can't directly query here, but the transaction context allows it
            // The actual migration will be done in a post-migration step in init()
        }

        // Future migrations go here:
        // if (oldVersion < 3) { ... }
    }

    /**
     * Run post-migration data transformations
     * This is called after the database is opened and schema is upgraded
     */
    private async runPostMigrations(): Promise<void> {
        if (!this.db) return;

        // Check if we need to migrate profile fields from Record to Array
        const migrationKey = 'migration_v1_to_v2_complete';
        const migrationComplete = await this.getMetadata(migrationKey);

        if (!migrationComplete) {
            logger.info('Running post-migration: Converting profile fields to array');

            try {
                const profiles = await this.getAllProfiles();
                let migratedCount = 0;

                for (const profile of profiles) {
                    // Check if fields is a Record (old format)
                    if (profile.staticContext.fields && !Array.isArray(profile.staticContext.fields)) {
                        // Convert Record to Array
                        const fieldsRecord = profile.staticContext.fields as unknown as Record<string, any>;
                        const fieldsArray = Object.entries(fieldsRecord).map(([key, field]) => ({
                            key,
                            value: field.value || '',
                            category: field.category || 'custom',
                            isEncrypted: field.isEncrypted || false,
                        }));

                        // Update profile with array-based fields
                        profile.staticContext.fields = fieldsArray;
                        await this.saveProfile(profile);
                        migratedCount++;
                    }
                }

                // Mark migration as complete
                await this.setMetadata(migrationKey, true);
                logger.info(`Migration complete: ${migratedCount} profiles converted`);
            } catch (error) {
                logger.error('Post-migration failed', { error });
            }
        }
    }


    /**
     * Ensure database is initialized
     */
    private async ensureInit(): Promise<IDBDatabase> {
        await this.init();
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        return this.db;
    }

    // ==================== Profile Operations ====================

    /**
     * Get all profiles
     */
    async getAllProfiles(): Promise<Profile[]> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.PROFILES, 'readonly');
            const store = tx.objectStore(STORES.PROFILES);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a profile by ID
     */
    async getProfile(id: string): Promise<Profile | undefined> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.PROFILES, 'readonly');
            const store = tx.objectStore(STORES.PROFILES);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save a profile (create or update)
     */
    async saveProfile(profile: Profile): Promise<void> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.PROFILES, 'readwrite');
            const store = tx.objectStore(STORES.PROFILES);
            const request = store.put(profile);

            request.onsuccess = () => {
                logger.debug('Profile saved', { id: profile.id });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a profile
     */
    async deleteProfile(id: string): Promise<void> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.PROFILES, 'readwrite');
            const store = tx.objectStore(STORES.PROFILES);
            const request = store.delete(id);

            request.onsuccess = () => {
                logger.debug('Profile deleted', { id });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== Vector Operations ====================

    /**
     * Get vectors by profile ID
     */
    async getVectorsByProfile(profileId: string): Promise<VectorEntry[]> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.VECTORS, 'readonly');
            const store = tx.objectStore(STORES.VECTORS);
            const index = store.index('profileId');
            const request = index.getAll(profileId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save a vector entry
     */
    async saveVector(vector: VectorEntry): Promise<void> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.VECTORS, 'readwrite');
            const store = tx.objectStore(STORES.VECTORS);
            const request = store.put(vector);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete vectors by profile ID
     */
    async deleteVectorsByProfile(profileId: string): Promise<void> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.VECTORS, 'readwrite');
            const store = tx.objectStore(STORES.VECTORS);
            const index = store.index('profileId');
            const request = index.openCursor(profileId);

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== Cache Operations ====================

    /**
     * Get a cached value
     */
    async getCache<T = unknown>(key: string): Promise<T | undefined> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.CACHE, 'readonly');
            const store = tx.objectStore(STORES.CACHE);
            const request = store.get(key);

            request.onsuccess = () => {
                const entry = request.result as CacheEntry | undefined;
                if (!entry) {
                    resolve(undefined);
                    return;
                }

                // Check expiration
                if (entry.expiresAt && entry.expiresAt < Date.now()) {
                    // Expired, delete async and return undefined
                    this.deleteCache(key).catch(() => { });
                    resolve(undefined);
                    return;
                }

                resolve(entry.value as T);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Set a cached value
     */
    async setCache(key: string, value: unknown, ttlMs?: number): Promise<void> {
        const db = await this.ensureInit();

        const entry: CacheEntry = {
            key,
            value,
            createdAt: Date.now(),
            expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.CACHE, 'readwrite');
            const store = tx.objectStore(STORES.CACHE);
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a cached value
     */
    async deleteCache(key: string): Promise<void> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.CACHE, 'readwrite');
            const store = tx.objectStore(STORES.CACHE);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear expired cache entries
     */
    async clearExpiredCache(): Promise<number> {
        const db = await this.ensureInit();
        const now = Date.now();
        let deletedCount = 0;

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.CACHE, 'readwrite');
            const store = tx.objectStore(STORES.CACHE);
            const index = store.index('expiresAt');
            const range = IDBKeyRange.upperBound(now);
            const request = index.openCursor(range);

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    logger.debug('Cleared expired cache', { count: deletedCount });
                    resolve(deletedCount);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== Metadata Operations ====================

    /**
     * Get a metadata value
     */
    async getMetadata<K extends keyof StoreValueMap['metadata']>(
        key: K
    ): Promise<StoreValueMap['metadata'][K] | undefined> {
        const db = await this.ensureInit();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.METADATA, 'readonly');
            const store = tx.objectStore(STORES.METADATA);
            const request = store.get(key);

            request.onsuccess = () => {
                const entry = request.result as MetadataEntry | undefined;
                resolve(entry?.value as StoreValueMap['metadata'][K] | undefined);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Set a metadata value
     */
    async setMetadata<K extends keyof StoreValueMap['metadata']>(
        key: K,
        value: StoreValueMap['metadata'][K]
    ): Promise<void> {
        const db = await this.ensureInit();

        const entry: MetadataEntry = { key: key as string, value };

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORES.METADATA, 'readwrite');
            const store = tx.objectStore(STORES.METADATA);
            const request = store.put(entry);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get app settings
     */
    async getSettings(): Promise<AppSettings> {
        const settings = await this.getMetadata('settings');
        return settings ?? {
            debugMode: false,
            autoFillEnabled: true,
            humanizeTyping: true,
            typingDelayMs: 50,
            showNotifications: true,
            encryptSensitiveFields: true,
        };
    }

    /**
     * Save app settings
     */
    async saveSettings(settings: AppSettings): Promise<void> {
        await this.setMetadata('settings', settings);
    }

    // ==================== Utility Methods ====================

    /**
     * Close the database connection
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initPromise = null;
            logger.debug('Database closed');
        }
    }

    /**
     * Delete the entire database (for testing/reset)
     */
    async deleteDatabase(): Promise<void> {
        this.close();

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DATABASE_NAME);
            request.onsuccess = () => {
                logger.info('Database deleted');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Singleton instance
export const storageService = new StorageService();
