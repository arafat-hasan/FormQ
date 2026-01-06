// Profile Service
// CRUD operations for profiles with persistence

import type { Profile, StaticContext, LearnedExample, URLBinding, ProfileSettings } from '@shared/types';
import { storageService } from './StorageService';
import { createLogger, generateId } from '@shared/utils';

const logger = createLogger('ProfileService');

/**
 * Default profile settings
 */
const DEFAULT_SETTINGS: ProfileSettings = {
    autoFill: false,
    confirmBeforeFill: true,
    humanizeTyping: true,
    typingDelayMs: 50,
};

/**
 * Service for managing user profiles
 */
export class ProfileService {
    /**
     * Initialize the service (and underlying storage)
     */
    async init(): Promise<void> {
        await storageService.init();
        logger.info('ProfileService initialized');
    }

    /**
     * Get all profiles
     */
    async getAll(): Promise<Profile[]> {
        return storageService.getAllProfiles();
    }

    /**
     * Get a profile by ID
     */
    async getById(id: string): Promise<Profile | undefined> {
        return storageService.getProfile(id);
    }

    /**
     * Create a new profile
     */
    async create(data: {
        name: string;
        staticContext?: Partial<StaticContext>;
        settings?: Partial<ProfileSettings>;
    }): Promise<Profile> {
        const now = Date.now();

        const profile: Profile = {
            id: generateId(),
            name: data.name,
            staticContext: {
                fields: [],  // Initialize as empty array
                documents: [],
                knowledgeBase: '',  // Initialize empty knowledge base
                knowledgeBaseChunks: 0,
                ...data.staticContext,
            },
            learnedExamples: [],
            urlBindings: [],
            settings: {
                ...DEFAULT_SETTINGS,
                ...data.settings,
            },
            createdAt: now,
            updatedAt: now,
            version: 1,
        };

        await storageService.saveProfile(profile);
        logger.info('Profile created', { id: profile.id, name: profile.name });

        return profile;
    }

    /**
     * Update an existing profile
     */
    async update(id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>): Promise<Profile> {
        const existing = await this.getById(id);

        if (!existing) {
            throw new Error(`Profile not found: ${id}`);
        }

        const updated: Profile = {
            ...existing,
            ...updates,
            id: existing.id, // Ensure ID doesn't change
            createdAt: existing.createdAt, // Ensure createdAt doesn't change
            updatedAt: Date.now(),
            version: existing.version + 1,
        };

        await storageService.saveProfile(updated);
        logger.info('Profile updated', { id, version: updated.version });

        return updated;
    }

    /**
     * Delete a profile
     */
    async delete(id: string): Promise<void> {
        // Also delete associated vectors
        await storageService.deleteVectorsByProfile(id);
        await storageService.deleteProfile(id);
        logger.info('Profile deleted', { id });
    }

    /**
     * Duplicate a profile
     */
    async duplicate(id: string, newName?: string): Promise<Profile> {
        const existing = await this.getById(id);

        if (!existing) {
            throw new Error(`Profile not found: ${id}`);
        }

        return this.create({
            name: newName ?? `${existing.name} (Copy)`,
            staticContext: { ...existing.staticContext },
            settings: { ...existing.settings },
        });
    }

    /**
     * Add a learned example to a profile
     */
    async addLearnedExample(profileId: string, example: Omit<LearnedExample, 'timestamp'>): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        const learnedExample: LearnedExample = {
            ...example,
            timestamp: Date.now(),
        };

        // Add to beginning (most recent first)
        const learnedExamples = [learnedExample, ...profile.learnedExamples];

        // Limit to 100 examples per profile
        if (learnedExamples.length > 100) {
            learnedExamples.splice(100);
        }

        await this.update(profileId, { learnedExamples });
        logger.debug('Learned example added', { profileId, exampleCount: learnedExamples.length });
    }

    /**
     * Add a URL binding to a profile
     */
    async addUrlBinding(profileId: string, binding: URLBinding): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        // Check for duplicate patterns
        const exists = profile.urlBindings.some(b => b.pattern === binding.pattern);
        if (exists) {
            logger.warn('URL binding already exists', { profileId, pattern: binding.pattern });
            return;
        }

        await this.update(profileId, {
            urlBindings: [...profile.urlBindings, binding],
        });
        logger.debug('URL binding added', { profileId, pattern: binding.pattern });
    }

    /**
     * Remove a URL binding from a profile
     */
    async removeUrlBinding(profileId: string, pattern: string): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        await this.update(profileId, {
            urlBindings: profile.urlBindings.filter(b => b.pattern !== pattern),
        });
        logger.debug('URL binding removed', { profileId, pattern });
    }

    /**
     * Find profiles that match a URL
     */
    async findByUrl(url: string): Promise<Profile[]> {
        const allProfiles = await this.getAll();

        return allProfiles.filter(profile => {
            // Check if any URL binding matches
            return profile.urlBindings.some(binding => {
                if (binding.type === 'exact') {
                    return url === binding.pattern;
                } else if (binding.type === 'domain') {
                    try {
                        const urlDomain = new URL(url).hostname;
                        return urlDomain === binding.pattern || urlDomain.endsWith('.' + binding.pattern);
                    } catch {
                        return false;
                    }
                } else if (binding.type === 'regex') {
                    try {
                        const regex = new RegExp(binding.pattern);
                        return regex.test(url);
                    } catch {
                        return false;
                    }
                }
                return false;
            });
        });
    }

    /**
     * Export a profile as a JSON object (for backup/sharing)
     */
    async exportProfile(id: string): Promise<object> {
        const profile = await this.getById(id);

        if (!profile) {
            throw new Error(`Profile not found: ${id}`);
        }

        return {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            profile: {
                ...profile,
                // Exclude sensitive data from exports
                settings: {
                    ...profile.settings,
                },
            },
        };
    }

    /**
     * Import a profile from a JSON object
     */
    async importProfile(data: { profile: Partial<Profile> }): Promise<Profile> {
        const { profile: imported } = data;

        if (!imported.name) {
            throw new Error('Invalid profile: missing name');
        }

        return this.create({
            name: imported.name,
            staticContext: imported.staticContext,
            settings: imported.settings,
        });
    }

    /**
     * Add a field to a profile
     */
    async addField(profileId: string, field: Omit<import('@shared/types').ContextField, 'isEncrypted'>): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        // Check for duplicate keys
        const exists = profile.staticContext.fields.some(f => f.key === field.key);
        if (exists) {
            throw new Error(`Field with key "${field.key}" already exists`);
        }

        const newField: import('@shared/types').ContextField = {
            ...field,
            isEncrypted: false,
        };

        await this.update(profileId, {
            staticContext: {
                ...profile.staticContext,
                fields: [...profile.staticContext.fields, newField],
            },
        });

        logger.debug('Field added', { profileId, key: field.key });
    }

    /**
     * Remove a field from a profile
     */
    async removeField(profileId: string, fieldKey: string): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        await this.update(profileId, {
            staticContext: {
                ...profile.staticContext,
                fields: profile.staticContext.fields.filter(f => f.key !== fieldKey),
            },
        });

        logger.debug('Field removed', { profileId, key: fieldKey });
    }

    /**
     * Update a field value in a profile
     */
    async updateField(profileId: string, fieldKey: string, updates: Partial<Omit<import('@shared/types').ContextField, 'key'>>): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        const fieldIndex = profile.staticContext.fields.findIndex(f => f.key === fieldKey);
        if (fieldIndex === -1) {
            throw new Error(`Field with key "${fieldKey}" not found`);
        }

        const updatedFields = [...profile.staticContext.fields];
        updatedFields[fieldIndex] = {
            ...updatedFields[fieldIndex],
            ...updates,
        };

        await this.update(profileId, {
            staticContext: {
                ...profile.staticContext,
                fields: updatedFields,
            },
        });

        logger.debug('Field updated', { profileId, key: fieldKey });
    }

    /**
     * Update knowledge base for a profile
     */
    async updateKnowledgeBase(profileId: string, knowledgeBase: string): Promise<void> {
        const profile = await this.getById(profileId);

        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        await this.update(profileId, {
            staticContext: {
                ...profile.staticContext,
                knowledgeBase,
                knowledgeBaseChunks: 0,  // Reset chunks (will be re-embedded)
            },
        });

        logger.debug('Knowledge base updated', { profileId, length: knowledgeBase.length });
    }
}

// Singleton instance
export const profileService = new ProfileService();
