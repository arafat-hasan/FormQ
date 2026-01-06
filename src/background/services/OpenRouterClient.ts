// OpenRouter API Client
// Unified client for OpenRouter chat completions and embeddings

import { createLogger } from '@shared/utils';

const logger = createLogger('OpenRouterClient');

// ============================================================================
// Types
// ============================================================================

export interface OpenRouterConfig {
    apiKey: string;
    chatModel?: string;
    embeddingModel?: string;
    baseUrl?: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatCompletionRequest {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: 'json_object' };
}

export interface ChatCompletionResponse {
    id: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finishReason: string;
    }>;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface EmbeddingRequest {
    input: string | string[];
    model?: string;
}

export interface EmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
    }>;
    usage: {
        promptTokens: number;
        totalTokens: number;
    };
}

export type OpenRouterErrorCode =
    | 'INVALID_API_KEY'
    | 'RATE_LIMITED'
    | 'MODEL_NOT_FOUND'
    | 'CONTEXT_LENGTH_EXCEEDED'
    | 'CONTENT_FILTERED'
    | 'SERVER_ERROR'
    | 'NETWORK_ERROR'
    | 'UNKNOWN';

export class OpenRouterError extends Error {
    constructor(
        message: string,
        public code: OpenRouterErrorCode,
        public status?: number,
        public retryable: boolean = false
    ) {
        super(message);
        this.name = 'OpenRouterError';
    }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_CHAT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

const STORAGE_KEY_API_KEY = 'openrouter_api_key';
const STORAGE_KEY_CHAT_MODEL = 'openrouter_chat_model';
const STORAGE_KEY_EMBEDDING_MODEL = 'openrouter_embedding_model';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRY_BACKOFF_MULTIPLIER = 2;

// ============================================================================
// OpenRouter Client
// ============================================================================

export class OpenRouterClient {
    private config: Required<OpenRouterConfig>;
    private initialized: boolean = false;

    constructor(config?: Partial<OpenRouterConfig>) {
        this.config = {
            apiKey: config?.apiKey ?? '',
            chatModel: config?.chatModel ?? DEFAULT_CHAT_MODEL,
            embeddingModel: config?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
            baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
        };
    }

    /**
     * Initialize client by loading config from storage
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        try {
            const stored = await chrome.storage.sync.get([
                STORAGE_KEY_API_KEY,
                STORAGE_KEY_CHAT_MODEL,
                STORAGE_KEY_EMBEDDING_MODEL,
            ]);

            if (stored[STORAGE_KEY_API_KEY]) {
                this.config.apiKey = stored[STORAGE_KEY_API_KEY];
            }
            if (stored[STORAGE_KEY_CHAT_MODEL]) {
                this.config.chatModel = stored[STORAGE_KEY_CHAT_MODEL];
            }
            if (stored[STORAGE_KEY_EMBEDDING_MODEL]) {
                this.config.embeddingModel = stored[STORAGE_KEY_EMBEDDING_MODEL];
            }

            this.initialized = true;
            logger.debug('OpenRouter client initialized', {
                hasApiKey: !!this.config.apiKey,
                chatModel: this.config.chatModel,
                embeddingModel: this.config.embeddingModel,
            });
        } catch (error) {
            logger.error('Failed to initialize OpenRouter client', { error });
            throw new OpenRouterError(
                'Failed to load configuration',
                'UNKNOWN'
            );
        }
    }

    /**
     * Check if API key is configured
     */
    isConfigured(): boolean {
        return !!this.config.apiKey;
    }

    /**
     * Update API key
     */
    async setApiKey(apiKey: string): Promise<void> {
        await chrome.storage.sync.set({ [STORAGE_KEY_API_KEY]: apiKey });
        this.config.apiKey = apiKey;
        logger.info('API key updated');
    }

    /**
     * Update chat model
     */
    async setChatModel(model: string): Promise<void> {
        await chrome.storage.sync.set({ [STORAGE_KEY_CHAT_MODEL]: model });
        this.config.chatModel = model;
        logger.info('Chat model updated', { model });
    }

    /**
     * Update embedding model
     */
    async setEmbeddingModel(model: string): Promise<void> {
        await chrome.storage.sync.set({ [STORAGE_KEY_EMBEDDING_MODEL]: model });
        this.config.embeddingModel = model;
        logger.info('Embedding model updated', { model });
    }

    /**
     * Get current configuration (without API key)
     */
    getConfig(): { chatModel: string; embeddingModel: string; hasApiKey: boolean } {
        return {
            chatModel: this.config.chatModel,
            embeddingModel: this.config.embeddingModel,
            hasApiKey: !!this.config.apiKey,
        };
    }

    /**
     * Test API connection
     */
    async testConnection(): Promise<{ success: boolean; error?: string }> {
        if (!this.config.apiKey) {
            return { success: false, error: 'API key not configured' };
        }

        try {
            // Simple test request
            await this.chatCompletion({
                messages: [{ role: 'user', content: 'Hi' }],
                maxTokens: 5,
            });
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: message };
        }
    }

    /**
     * Send a chat completion request
     */
    async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        if (!this.config.apiKey) {
            throw new OpenRouterError('API key not configured', 'INVALID_API_KEY');
        }

        const body = {
            model: this.config.chatModel,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 2048,
            ...(request.responseFormat && { response_format: request.responseFormat }),
        };

        const response = await this.makeRequest<OpenRouterChatResponse>(
            '/chat/completions',
            body
        );

        return {
            id: response.id,
            choices: response.choices.map((c) => ({
                message: {
                    role: c.message.role,
                    content: c.message.content,
                },
                finishReason: c.finish_reason,
            })),
            usage: {
                promptTokens: response.usage?.prompt_tokens ?? 0,
                completionTokens: response.usage?.completion_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
            },
        };
    }

    /**
     * Generate embeddings for text
     */
    async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
        if (!this.config.apiKey) {
            throw new OpenRouterError('API key not configured', 'INVALID_API_KEY');
        }

        const body = {
            model: request.model ?? this.config.embeddingModel,
            input: request.input,
        };

        const response = await this.makeRequest<OpenRouterEmbeddingResponse>(
            '/embeddings',
            body
        );

        return {
            data: response.data.map((d) => ({
                embedding: d.embedding,
                index: d.index,
            })),
            usage: {
                promptTokens: response.usage?.prompt_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
            },
        };
    }

    /**
     * Make an HTTP request with retry logic
     */
    private async makeRequest<T>(endpoint: string, body: object): Promise<T> {
        const url = `${this.config.baseUrl}${endpoint}`;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.apiKey}`,
                        'HTTP-Referer': 'https://FormQ-extension.local',
                        'X-Title': 'FormQ Form Autofill',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const error = await this.parseErrorResponse(response);

                    // Don't retry non-retryable errors
                    if (!error.retryable) {
                        throw error;
                    }

                    lastError = error;
                    logger.warn('Request failed, retrying', {
                        attempt: attempt + 1,
                        status: response.status,
                        error: error.message,
                    });
                } else {
                    const data = await response.json() as T;
                    return data;
                }
            } catch (error) {
                if (error instanceof OpenRouterError && !error.retryable) {
                    throw error;
                }

                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn('Request failed with network error', {
                    attempt: attempt + 1,
                    error: lastError.message,
                });
            }

            // Wait before retry with exponential backoff
            if (attempt < MAX_RETRIES - 1) {
                const delay = RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt);
                await this.sleep(delay);
            }
        }

        // All retries failed
        throw lastError ?? new OpenRouterError('Request failed', 'UNKNOWN');
    }

    /**
     * Parse error response from OpenRouter
     */
    private async parseErrorResponse(response: Response): Promise<OpenRouterError> {
        let errorMessage = `HTTP ${response.status}`;
        let code: OpenRouterErrorCode = 'UNKNOWN';
        let retryable = false;

        try {
            const errorBody = await response.json() as { error?: { message?: string; code?: string } };
            if (errorBody.error?.message) {
                errorMessage = errorBody.error.message;
            }
        } catch {
            // Ignore JSON parse errors
        }

        switch (response.status) {
            case 401:
                code = 'INVALID_API_KEY';
                errorMessage = 'Invalid API key';
                break;
            case 429:
                code = 'RATE_LIMITED';
                retryable = true;
                break;
            case 404:
                code = 'MODEL_NOT_FOUND';
                break;
            case 400:
                if (errorMessage.toLowerCase().includes('context length')) {
                    code = 'CONTEXT_LENGTH_EXCEEDED';
                } else if (errorMessage.toLowerCase().includes('content')) {
                    code = 'CONTENT_FILTERED';
                }
                break;
            case 500:
            case 502:
            case 503:
            case 504:
                code = 'SERVER_ERROR';
                retryable = true;
                break;
        }

        return new OpenRouterError(errorMessage, code, response.status, retryable);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// ============================================================================
// Internal API Response Types (snake_case from OpenRouter)
// ============================================================================

interface OpenRouterChatResponse {
    id: string;
    choices: Array<{
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface OpenRouterEmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
    }>;
    usage?: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const openRouterClient = new OpenRouterClient();
