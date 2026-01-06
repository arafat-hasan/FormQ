// Background Services Exports
// Re-export all services from this directory

export { OpenRouterClient, openRouterClient } from './OpenRouterClient';
export type {
    OpenRouterConfig,
    ChatMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    EmbeddingRequest,
    EmbeddingResponse,
    OpenRouterErrorCode,
} from './OpenRouterClient';
export { OpenRouterError } from './OpenRouterClient';

export { LearningService, learningService } from './LearningService';
export type { EditEvent, LearningConfig } from './LearningService';

export { CacheService, cacheService } from './CacheService';
export type { CachedFillResponse, CacheStats } from './CacheService';
