// Background Service Worker Entry Point
// Main orchestration layer for the extension

import { createLogger } from '@shared/utils';
import { MessageBus } from '@shared/messaging';
import { profileService } from '@shared/storage';
import { createSuggestedMappings } from '@shared/matching';
import type { FillState, FormSignature } from '@shared/types';
import { llmOrchestrator } from './ai';
import { openRouterClient } from './services';

const logger = createLogger('Background');

// Current state (ephemeral, stored in session storage for service worker restarts)
let state: FillState = { type: 'IDLE', tabId: -1, timestamp: Date.now() };
let activeProfileId: string | null = null;
let currentFormSignature: FormSignature | null = null;

/**
 * Initialize the background service worker
 */
async function initialize(): Promise<void> {
    logger.info('Background service worker initializing');

    // Initialize persistent storage
    await profileService.init();

    // Initialize AI layer
    await llmOrchestrator.init();

    // Restore ephemeral state from session storage (for service worker restarts)
    await restoreSessionState();

    // Set up message handlers
    setupMessageHandlers();

    // Set up AI message handlers
    setupAIMessageHandlers();

    // Set up context menu
    setupContextMenu();

    logger.info('Background service worker ready', {
        aiAvailable: llmOrchestrator.isAvailable(),
    });
}

/**
 * Restore ephemeral state from session storage
 */
async function restoreSessionState(): Promise<void> {
    try {
        const stored = await chrome.storage.session.get(['state', 'activeProfileId', 'currentFormSignature']);

        if (stored.state) {
            state = stored.state;
        }
        if (stored.activeProfileId) {
            activeProfileId = stored.activeProfileId;
        }
        if (stored.currentFormSignature) {
            currentFormSignature = stored.currentFormSignature;
        }

        logger.debug('Session state restored', { activeProfileId });
    } catch (error) {
        logger.error('Failed to restore session state', { error });
    }
}

/**
 * Persist ephemeral state to session storage
 */
async function persistSessionState(): Promise<void> {
    try {
        await chrome.storage.session.set({ state, activeProfileId, currentFormSignature });
    } catch (error) {
        logger.error('Failed to persist session state', { error });
    }
}

/**
 * Set up message handlers
 */
function setupMessageHandlers(): void {
    // Handle state requests
    MessageBus.subscribe(['GET_STATE'], () => {
        return { state };
    });

    // Handle profile requests (from persistent storage)
    MessageBus.subscribe(['GET_PROFILES'], async () => {
        const profiles = await profileService.getAll();
        return { profiles };
    });

    // Handle profile creation
    MessageBus.subscribe(['CREATE_PROFILE'], async (message) => {
        const { profile: FormQata } = message.payload;

        const newProfile = await profileService.create({
            name: FormQata.name,
            staticContext: FormQata.staticContext,
            settings: FormQata.settings,
        });

        // If this is the first profile, set it as active
        const allProfiles = await profileService.getAll();
        if (allProfiles.length === 1) {
            activeProfileId = newProfile.id;
            await persistSessionState();
        }

        broadcastProfilesUpdate();

        return { profile: newProfile };
    });

    // Handle profile updates
    MessageBus.subscribe(['UPDATE_PROFILE'], async (message) => {
        const { profile: updatedProfile } = message.payload;

        const profile = await profileService.update(updatedProfile.id, {
            name: updatedProfile.name,
            staticContext: updatedProfile.staticContext,
            settings: updatedProfile.settings,
            urlBindings: updatedProfile.urlBindings,
        });

        broadcastProfilesUpdate();

        return { profile };
    });

    // Handle profile deletion
    MessageBus.subscribe(['DELETE_PROFILE'], async (message) => {
        const { profileId } = message.payload;

        await profileService.delete(profileId);

        // Update active profile if needed
        if (activeProfileId === profileId) {
            const allProfiles = await profileService.getAll();
            activeProfileId = allProfiles.length > 0 ? allProfiles[0].id : null;
            await persistSessionState();
        }

        broadcastProfilesUpdate();

        return { success: true };
    });

    // Handle active profile changes
    MessageBus.subscribe(['SET_ACTIVE_PROFILE'], async (message) => {
        activeProfileId = message.payload.profileId;
        await persistSessionState();
        return { success: true };
    });

    // Handle form detection from content script
    MessageBus.subscribe(['FORM_DETECTED'], async (message, sender) => {
        if (sender.tab?.id) {
            currentFormSignature = message.payload.formSignature;
            state = {
                type: 'DETECTING',
                tabId: sender.tab.id,
                timestamp: Date.now(),
            };
            await persistSessionState();
            broadcastStateUpdate();
        }
        logger.info('Form detected', {
            tabId: sender.tab?.id,
            fieldCount: message.payload.formSignature.fields.length,
        });
    });

    // Handle fill trigger - Combined static + AI strategy
    MessageBus.subscribe(['TRIGGER_FILL'], async (message, _sender) => {
        const profileId = message.payload.profileId || activeProfileId;

        if (!profileId) {
            return { success: false, error: 'No profile selected' };
        }

        const profile = await profileService.getById(profileId);
        if (!profile) {
            return { success: false, error: 'Profile not found' };
        }

        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
            return { success: false, error: 'No active tab' };
        }

        // Check if we have a form signature
        if (!currentFormSignature) {
            return { success: false, error: 'No form detected on page' };
        }

        // Step 1: Create static field mappings
        const staticMappings = createSuggestedMappings(currentFormSignature.fields, profile);

        logger.debug('Static mapping complete', {
            totalFields: currentFormSignature.fields.length,
            staticMapped: staticMappings.length,
        });

        // Step 2: Identify unmapped fields (fields not covered by static)
        const mappedFieldIds = new Set(staticMappings.map(m => m.fieldSignature.id));
        const unmappedFields = currentFormSignature.fields.filter(
            f => !mappedFieldIds.has(f.id) && f.semanticClass !== 'password'
        );

        let finalMappings = staticMappings;
        let fillSource: 'static' | 'combined' = 'static';

        // Step 3: Use AI for unmapped fields if available and needed
        if (unmappedFields.length > 0 && llmOrchestrator.isAvailable()) {
            logger.info('Using AI for unmapped fields', {
                unmappedCount: unmappedFields.length,
            });

            // Update state to INFERRING
            state = {
                type: 'INFERRING',
                tabId: tab.id,
                timestamp: Date.now(),
                profileId,
                formSignature: currentFormSignature,
                retrievedContext: [],
            };
            await persistSessionState();
            broadcastStateUpdate();

            try {
                // Call LLM with only unmapped fields
                const aiFormSignature = {
                    ...currentFormSignature,
                    fields: unmappedFields,
                };

                const fillResponse = await llmOrchestrator.fill({
                    formSignature: aiFormSignature,
                    profile,
                    useCache: true,
                });

                // Merge static + AI mappings
                finalMappings = [...staticMappings, ...fillResponse.mappings];
                fillSource = 'combined';

                logger.info('AI fill complete', {
                    staticCount: staticMappings.length,
                    aiCount: fillResponse.mappings.length,
                    totalCount: finalMappings.length,
                });
            } catch (error) {
                logger.warn('AI fill failed, using static only', { error });
                // Continue with static mappings only
            }
        }

        if (finalMappings.length === 0) {
            return { success: false, error: 'No fields could be mapped' };
        }

        // Update state to FILLING
        state = {
            type: 'FILLING',
            tabId: tab.id,
            timestamp: Date.now(),
            profileId,
            formSignature: currentFormSignature,
            mappings: finalMappings,
            progress: { completed: 0, total: finalMappings.length },
        };
        await persistSessionState();
        broadcastStateUpdate();

        logger.info('Fill triggered', {
            profileId,
            tabId: tab.id,
            source: fillSource,
            staticCount: staticMappings.length,
            totalCount: finalMappings.length,
        });

        // Send fill command to content script
        try {
            await MessageBus.sendToTab(tab.id, 'FILL_COMMAND', {
                mappings: finalMappings,
                options: {
                    humanize: profile.settings.humanizeTyping,
                    delayMs: profile.settings.typingDelayMs,
                },
            });
            return { success: true, source: fillSource };
        } catch (error) {
            logger.error('Failed to send fill command', { error });
            return { success: false, error: 'Failed to communicate with page' };
        }
    });

    // Handle fill progress
    MessageBus.subscribe(['FILL_PROGRESS'], (message, sender) => {
        const { completed, total, currentField } = message.payload;
        logger.debug('Fill progress', { completed, total, currentField });

        if (sender.tab?.id && state.type === 'FILLING') {
            state = {
                ...state,
                progress: { completed, total },
            };
            broadcastStateUpdate();
        }
    });

    // Handle fill completion
    MessageBus.subscribe(['FILL_COMPLETE'], async (message, sender) => {
        logger.info('Fill complete', {
            filledCount: message.payload.result.mappings.length,
        });

        state = { type: 'IDLE', tabId: sender.tab?.id ?? -1, timestamp: Date.now() };
        await persistSessionState();
        broadcastStateUpdate();
    });

    // Handle fill errors
    MessageBus.subscribe(['FILL_ERROR'], async (message, sender) => {
        logger.error('Fill error', {
            error: message.payload.error,
            code: message.payload.code,
        });

        state = {
            type: 'ERROR',
            tabId: sender.tab?.id ?? -1,
            timestamp: Date.now(),
            error: message.payload.error,
            code: message.payload.code,
        };
        await persistSessionState();
        broadcastStateUpdate();
    });
}

/**
 * Set up AI-specific message handlers
 */
function setupAIMessageHandlers(): void {
    // Handle AI status requests
    MessageBus.subscribe(['GET_AI_STATUS'], () => {
        const status = llmOrchestrator.getStatus();
        return status;
    });

    // Handle API key updates
    MessageBus.subscribe(['SET_API_KEY'], async (message) => {
        try {
            await openRouterClient.setApiKey(message.payload.apiKey);
            logger.info('API key updated');
            return { success: true };
        } catch (error) {
            logger.error('Failed to set API key', { error });
            return { success: false };
        }
    });

    // Handle API connection test
    MessageBus.subscribe(['TEST_API_CONNECTION'], async () => {
        const result = await llmOrchestrator.testConnection();
        return result;
    });

    // Handle knowledge base embedding
    MessageBus.subscribe(['EMBED_KNOWLEDGE_BASE'], async (message) => {
        const { profileId } = message.payload;

        if (!profileId) {
            return { success: false, error: 'Profile ID required' };
        }

        const profile = await profileService.getById(profileId);
        if (!profile) {
            return { success: false, error: 'Profile not found' };
        }

        const knowledgeBase = profile.staticContext.knowledgeBase;
        if (!knowledgeBase || !knowledgeBase.trim()) {
            return { success: false, error: 'No knowledge base text to embed' };
        }

        try {
            const { ragEngine } = await import('./ai');
            const chunks = await ragEngine.ingestKnowledgeBase(profileId, knowledgeBase);

            // Update profile with chunk count
            await profileService.update(profileId, {
                staticContext: {
                    ...profile.staticContext,
                    knowledgeBaseChunks: chunks,
                },
            });

            logger.info('Knowledge base embedded', { profileId, chunks });
            return { success: true, chunks };
        } catch (error) {
            logger.error('Failed to embed knowledge base', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });
}

/**
 * Broadcast state update to all connected UIs
 */
function broadcastStateUpdate(): void {
    chrome.runtime.sendMessage({
        type: 'STATE_UPDATE',
        payload: { state },
        id: crypto.randomUUID(),
        timestamp: Date.now(),
    }).catch(() => {
        // Ignore - popup might not be open
    });
}

/**
 * Broadcast profiles update to all connected UIs
 */
async function broadcastProfilesUpdate(): Promise<void> {
    const profiles = await profileService.getAll();
    chrome.runtime.sendMessage({
        type: 'PROFILES_UPDATE',
        payload: { profiles },
        id: crypto.randomUUID(),
        timestamp: Date.now(),
    }).catch(() => {
        // Ignore - popup might not be open
    });
}

/**
 * Set up context menu for quick actions
 */
function setupContextMenu(): void {
    // Remove existing menu items first to avoid duplicates on service worker restart
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'FormQ-fill',
            title: 'Fill with FormQ',
            contexts: ['page', 'editable'],
        });
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === 'FormQ-fill' && tab?.id) {
            MessageBus.sendToTab(tab.id, 'TRIGGER_FILL', { profileId: activeProfileId ?? undefined } as { profileId?: string })
                .catch((error) => {
                    logger.error('Failed to trigger fill from context menu', { error: String(error) });
                });
        }
    });
}

// Initialize
initialize().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to initialize background service worker', { error: errorMessage });
});
