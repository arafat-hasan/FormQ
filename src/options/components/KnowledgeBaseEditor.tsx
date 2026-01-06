import { useState } from 'react';
import { MessageBus } from '@shared/messaging';

interface KnowledgeBaseEditorProps {
    profileId: string;
    knowledgeBase: string;
    knowledgeBaseChunks?: number;
    onChange: (knowledgeBase: string) => void;
}

export function KnowledgeBaseEditor({
    profileId,
    knowledgeBase,
    knowledgeBaseChunks,
    onChange,
}: KnowledgeBaseEditorProps) {
    const [embedding, setEmbedding] = useState(false);
    const [embedSuccess, setEmbedSuccess] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleEmbed = async () => {
        if (!knowledgeBase.trim()) {
            setError('Knowledge base is empty');
            return;
        }

        setEmbedding(true);
        setEmbedSuccess(null);
        setError(null);

        try {
            const response = await MessageBus.sendToBackground('EMBED_KNOWLEDGE_BASE', {
                profileId,
            });

            if (response?.success) {
                setEmbedSuccess(true);
                setTimeout(() => setEmbedSuccess(null), 3000);
            } else {
                setError(response?.error || 'Failed to embed knowledge base');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setEmbedding(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label className="form-label" style={{ marginBottom: 0 }}>
                        Knowledge Base
                    </label>
                    {knowledgeBaseChunks !== undefined && knowledgeBaseChunks > 0 && (
                        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                            {knowledgeBaseChunks} chunk{knowledgeBaseChunks !== 1 ? 's' : ''} embedded
                        </span>
                    )}
                </div>
                <textarea
                    className="form-input"
                    placeholder="Add contextual information for AI to use when filling forms...&#10;&#10;Example:&#10;I'm a senior software engineer specializing in React and Node.js. I prefer remote work and have 8 years of experience. My LinkedIn is linkedin.com/in/johndoe."
                    value={knowledgeBase}
                    onChange={(e) => onChange(e.target.value)}
                    rows={6}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                    The AI will use this information to answer fields not in your static profile.
                </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                    className="btn btn-secondary"
                    onClick={handleEmbed}
                    disabled={embedding || !knowledgeBase.trim()}
                >
                    {embedding ? 'Embedding...' : 'Embed Knowledge Base'}
                </button>

                {embedSuccess && (
                    <span style={{ fontSize: '14px', color: '#22c55e' }}>
                        ✓ Embedded successfully!
                    </span>
                )}

                {error && (
                    <span style={{ fontSize: '14px', color: '#ef4444' }}>
                        ✗ {error}
                    </span>
                )}
            </div>
        </div>
    );
}
