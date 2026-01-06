// LLM Orchestrator
// Coordinates the full LLM-powered form filling workflow

import type { FormSignature, FieldMapping, Profile } from '@shared/types';
import { createLogger } from '@shared/utils';
import { createSuggestedMappings } from '@shared/matching';
import { openRouterClient, OpenRouterError } from '../services/OpenRouterClient';
import { promptBuilder } from './PromptBuilder';
import { responseValidator } from './ResponseValidator';

const logger = createLogger('LLMOrchestrator');

// ============================================================================
// Types
// ============================================================================

export interface FillRequest {
    formSignature: FormSignature;
    profile: Profile;
    ragContext?: string[];
    useCache?: boolean;
}

export interface FillResponse {
    mappings: FieldMapping[];
    source: 'llm' | 'static' | 'cached' | 'hybrid';
    llmUsed: boolean;
    tokensUsed?: number;
    fallbackReason?: string;
}

export interface OrchestratorConfig {
    fallbackToStatic: boolean;
    maxRetries: number;
    timeout: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: OrchestratorConfig = {
    fallbackToStatic: true,
    maxRetries: 2,
    timeout: 30000, // 30 seconds
};

// ============================================================================
// LLM Orchestrator
// ============================================================================

export class LLMOrchestrator {
    private config: OrchestratorConfig;
    private initialized: boolean = false;

    constructor(config?: Partial<OrchestratorConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the orchestrator
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        await openRouterClient.init();
        this.initialized = true;
        logger.info('LLM Orchestrator initialized');
    }

    /**
     * Check if LLM is available (API key configured)
     */
    isAvailable(): boolean {
        return openRouterClient.isConfigured();
    }

    /**
     * Fill form fields using LLM with fallback to static mapping
     */
    async fill(request: FillRequest): Promise<FillResponse> {
        await this.init();

        const { formSignature, profile, ragContext } = request;

        // Check if LLM is available
        if (!this.isAvailable()) {
            logger.info('LLM not available, using static mapping');
            return this.staticFill(formSignature, profile, 'API key not configured');
        }

        try {
            // Build prompt
            const prompt = promptBuilder.buildPrompt({
                profile,
                formSignature,
                ragContext,
            });

            logger.debug('Prompt built', {
                estimatedTokens: prompt.estimatedTokens,
                fieldCount: formSignature.fields.length,
            });

            // Call LLM
            const response = await openRouterClient.chatCompletion({
                messages: [
                    { role: 'system', content: prompt.systemPrompt },
                    { role: 'user', content: prompt.userPrompt },
                ],
                temperature: 0.2,
                responseFormat: { type: 'json_object' },
            });

            const rawContent = response.choices[0]?.message?.content;
            if (!rawContent) {
                throw new Error('Empty response from LLM');
            }

            logger.debug('LLM response received', {
                tokensUsed: response.usage.totalTokens,
                contentLength: rawContent.length,
            });

            // Validate response
            const validationResult = responseValidator.validate(rawContent, formSignature);

            if (!validationResult.valid) {
                logger.warn('LLM response validation failed', {
                    errors: validationResult.errors,
                });

                if (this.config.fallbackToStatic) {
                    return this.staticFill(formSignature, profile, 'LLM response validation failed');
                }

                throw new Error('LLM response validation failed');
            }

            // Log warnings
            if (validationResult.warnings.length > 0) {
                logger.debug('Validation warnings', { warnings: validationResult.warnings });
            }

            // Get static mappings for comparison/merge
            const staticMappings = createSuggestedMappings(formSignature.fields, profile);

            // Merge LLM and static mappings
            const mergedMappings = responseValidator.mergeWithStaticMappings(
                validationResult.mappings,
                staticMappings
            );

            logger.info('LLM fill successful', {
                llmMappings: validationResult.mappings.length,
                staticMappings: staticMappings.length,
                mergedMappings: mergedMappings.length,
            });

            return {
                mappings: mergedMappings,
                source: staticMappings.length > 0 ? 'hybrid' : 'llm',
                llmUsed: true,
                tokensUsed: response.usage.totalTokens,
            };

        } catch (error) {
            logger.error('LLM fill failed', {
                error: error instanceof Error ? error.message : String(error),
            });

            // Handle specific error types
            if (error instanceof OpenRouterError) {
                if (error.code === 'INVALID_API_KEY') {
                    return this.staticFill(formSignature, profile, 'Invalid API key');
                }
                if (error.code === 'RATE_LIMITED') {
                    return this.staticFill(formSignature, profile, 'Rate limited');
                }
            }

            // Fallback to static mapping
            if (this.config.fallbackToStatic) {
                const reason = error instanceof Error ? error.message : 'Unknown error';
                return this.staticFill(formSignature, profile, reason);
            }

            throw error;
        }
    }

    /**
     * Perform static-only fill (fallback)
     */
    private staticFill(
        formSignature: FormSignature,
        profile: Profile,
        fallbackReason: string
    ): FillResponse {
        const mappings = createSuggestedMappings(formSignature.fields, profile);

        logger.info('Static fill performed', {
            mappingCount: mappings.length,
            reason: fallbackReason,
        });

        return {
            mappings,
            source: 'static',
            llmUsed: false,
            fallbackReason,
        };
    }

    /**
     * Test the LLM connection
     */
    async testConnection(): Promise<{ success: boolean; error?: string }> {
        await this.init();
        return openRouterClient.testConnection();
    }

    /**
     * Get current configuration status
     */
    getStatus(): {
        available: boolean;
        chatModel: string;
        embeddingModel: string;
    } {
        const config = openRouterClient.getConfig();
        return {
            available: config.hasApiKey,
            chatModel: config.chatModel,
            embeddingModel: config.embeddingModel,
        };
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const llmOrchestrator = new LLMOrchestrator();
