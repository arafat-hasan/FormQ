// RAG Engine
// Retrieval-Augmented Generation for contextual form filling

import type { FormSignature, FieldSignature, LearnedExample, VectorEntry } from '@shared/types';
import { vectorStore } from '@shared/storage/VectorStore';
import { embeddingService } from './EmbeddingService';
import { createLogger } from '@shared/utils';

const logger = createLogger('RAGEngine');

// ============================================================================
// Types
// ============================================================================

export interface RAGConfig {
    topK: number;                    // Number of results to retrieve
    similarityThreshold: number;     // Minimum cosine similarity (0-1)
    maxContextTokens: number;        // Max tokens for context assembly
}

export interface RetrievalResult {
    context: string[];               // Retrieved context strings
    sources: Array<{
        id: string;
        type: 'learned_example' | 'document' | 'knowledge_base';  // Added knowledge_base
        similarity: number;
        text: string;
    }>;
    tokenEstimate: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: RAGConfig = {
    topK: 5,
    similarityThreshold: 0.5,
    maxContextTokens: 1500,
};

// Approximate characters per token
const CHARS_PER_TOKEN = 4;

// ============================================================================
// RAG Engine
// ============================================================================

export class RAGEngine {
    private config: RAGConfig;
    private initialized: boolean = false;

    constructor(config?: Partial<RAGConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the RAG engine
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await vectorStore.init();
        await embeddingService.init();
        this.initialized = true;
        logger.debug('RAG engine initialized');
    }

    /**
     * Retrieve relevant context for a form fill request
     */
    async retrieve(
        profileId: string,
        formSignature: FormSignature,
        options?: Partial<RAGConfig>
    ): Promise<RetrievalResult> {
        await this.init();

        const config = { ...this.config, ...options };

        // Build query text from form signature
        const queryText = this.buildQueryText(formSignature);

        // Generate query embedding
        const queryResult = await embeddingService.embed(queryText);

        // Search vector store
        const searchResults = await vectorStore.search(
            profileId,
            queryResult.embedding,
            config.topK * 2, // Over-fetch for filtering
            config.similarityThreshold
        );

        if (searchResults.length === 0) {
            logger.debug('No relevant context found', { profileId, formDomain: formSignature.domain });
            return { context: [], sources: [], tokenEstimate: 0 };
        }

        // Build context within token budget
        const { context, sources, tokenEstimate } = this.buildContext(
            searchResults,
            config.maxContextTokens
        );

        logger.info('RAG retrieval complete', {
            profileId,
            formDomain: formSignature.domain,
            candidatesFound: searchResults.length,
            contextItems: context.length,
            tokenEstimate,
        });

        return { context, sources, tokenEstimate };
    }

    /**
     * Ingest a learned example into the vector store
     */
    async ingestLearnedExample(
        profileId: string,
        example: LearnedExample
    ): Promise<void> {
        await this.init();

        // Build text representation of the example
        const text = this.buildExampleText(example);

        // Generate embedding
        const result = await embeddingService.embed(text);

        // Create vector entry
        const entry: VectorEntry = {
            id: `${profileId}_learned_${example.id}`,
            profileId,
            embedding: result.embedding,
            sourceType: 'learned_example',
            sourceId: example.id,
            text,
            createdAt: Date.now(),
        };

        // Store in vector store
        await vectorStore.upsert(entry);

        logger.debug('Learned example ingested', {
            profileId,
            exampleId: example.id,
            textLength: text.length,
        });
    }

    /**
     * Ingest a document (resume, cover letter) into the vector store
     */
    async ingestDocument(
        profileId: string,
        documentId: string,
        documentText: string,
        chunkSize: number = 500
    ): Promise<number> {
        await this.init();

        // Split document into chunks
        const chunks = this.chunkText(documentText, chunkSize);

        // Generate embeddings for all chunks
        const embedResults = await embeddingService.embedBatch(chunks);

        // Create and store vector entries
        const entries: VectorEntry[] = embedResults.embeddings.map((result, idx) => ({
            id: `${profileId}_doc_${documentId}_${idx}`,
            profileId,
            embedding: result.embedding,
            sourceType: 'document' as const,
            sourceId: documentId,
            text: result.text,
            createdAt: Date.now(),
        }));

        await vectorStore.upsertBatch(entries);

        logger.info('Document ingested', {
            profileId,
            documentId,
            chunks: chunks.length,
            totalTokens: embedResults.totalTokens,
        });

        return chunks.length;
    }

    /**
     * Ingest knowledge base into the vector store
     */
    async ingestKnowledgeBase(
        profileId: string,
        knowledgeBase: string,
        chunkSize: number = 500
    ): Promise<number> {
        await this.init();

        // Clear existing knowledge base vectors first
        await vectorStore.deleteBySourceType(profileId, 'knowledge_base');

        if (!knowledgeBase || !knowledgeBase.trim()) {
            logger.debug('Empty knowledge base, nothing to ingest', { profileId });
            return 0;
        }

        // Split knowledge base into chunks
        const chunks = this.chunkText(knowledgeBase, chunkSize);

        // Generate embeddings for all chunks
        const embedResults = await embeddingService.embedBatch(chunks);

        // Create and store vector entries
        const entries: VectorEntry[] = embedResults.embeddings.map((result, idx) => ({
            id: `${profileId}_kb_${idx}_${Date.now()}`,
            profileId,
            embedding: result.embedding,
            sourceType: 'knowledge_base' as const,
            sourceId: 'knowledge_base',
            text: result.text,
            createdAt: Date.now(),
        }));

        await vectorStore.upsertBatch(entries);

        logger.info('Knowledge base ingested', {
            profileId,
            chunks: chunks.length,
            totalTokens: embedResults.totalTokens,
        });

        return chunks.length;
    }

    /**
     * Remove all vectors for a profile
     */
    async clearProfile(profileId: string): Promise<void> {
        await this.init();
        await vectorStore.deleteByProfile(profileId);
        logger.info('Profile vectors cleared', { profileId });
    }

    /**
     * Build query text from form signature
     */
    private buildQueryText(formSignature: FormSignature): string {
        const fieldDescriptions = formSignature.fields
            .filter((f: FieldSignature) => f.semanticClass !== 'password' && f.semanticClass !== 'unknown')
            .map((f: FieldSignature) => `${f.normalizedLabel} (${f.semanticClass})`)
            .slice(0, 10) // Limit to top 10 fields
            .join(', ');

        return `Form on ${formSignature.domain}: ${fieldDescriptions}`;
    }

    /**
     * Build text representation of a learned example
     */
    private buildExampleText(example: LearnedExample): string {
        const mappings = example.fieldMappings
            .map(m => `${m.fieldSignature.normalizedLabel}: ${m.value}`)
            .join(', ');

        return `Form filled on ${example.formSignature.domain}: ${mappings}`;
    }

    /**
     * Build context from search results within token budget
     */
    private buildContext(
        results: Array<{ id: string; sourceType: 'learned_example' | 'document' | 'knowledge_base'; similarity: number; text: string }>,
        maxTokens: number
    ): { context: string[]; sources: Array<{ id: string; type: 'learned_example' | 'document' | 'knowledge_base'; similarity: number; text: string }>; tokenEstimate: number } {
        const context: string[] = [];
        const sources: Array<{ id: string; type: 'learned_example' | 'document' | 'knowledge_base'; similarity: number; text: string }> = [];
        let totalTokens = 0;

        for (const result of results) {
            const tokens = this.estimateTokens(result.text);

            if (totalTokens + tokens > maxTokens) {
                // Truncate text to fit remaining budget
                const remainingTokens = maxTokens - totalTokens;
                if (remainingTokens > 50) {
                    const truncatedText = result.text.slice(0, remainingTokens * CHARS_PER_TOKEN);
                    context.push(truncatedText + '...');
                    sources.push({
                        id: result.id,
                        type: result.sourceType,
                        similarity: result.similarity,
                        text: truncatedText,
                    });
                }
                break;
            }

            context.push(result.text);
            sources.push({
                id: result.id,
                type: result.sourceType,
                similarity: result.similarity,
                text: result.text,
            });
            totalTokens += tokens;
        }

        return { context, sources, tokenEstimate: totalTokens };
    }

    /**
     * Split text into chunks for embedding
     */
    private chunkText(text: string, chunkSize: number): string[] {
        const chunks: string[] = [];
        const sentences = text.split(/[.!?]+\s+/);
        let currentChunk = '';

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > chunkSize && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * Estimate token count for text
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }

    /**
     * Update configuration
     */
    setConfig(config: Partial<RAGConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): RAGConfig {
        return { ...this.config };
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const ragEngine = new RAGEngine();
