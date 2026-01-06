import { useState } from 'react';
import type { ContextField } from '@shared/types';

interface FieldEditorProps {
    fields: ContextField[];
    onChange: (fields: ContextField[]) => void;
}

export function FieldEditor({ fields, onChange }: FieldEditorProps) {
    const [newFieldKey, setNewFieldKey] = useState('');
    const [newFieldValue, setNewFieldValue] = useState('');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    const handleAddField = () => {
        if (!newFieldKey.trim() || !newFieldValue.trim()) return;

        // Check for duplicate keys
        if (fields.some(f => f.key === newFieldKey.trim())) {
            alert('A field with this key already exists');
            return;
        }

        const newField: ContextField = {
            key: newFieldKey.trim(),
            value: newFieldValue.trim(),
            category: 'custom',
            isEncrypted: false,
        };

        onChange([...fields, newField]);
        setNewFieldKey('');
        setNewFieldValue('');
    };

    const handleRemoveField = (index: number) => {
        onChange(fields.filter((_, i) => i !== index));
    };

    const handleUpdateField = (index: number, updates: Partial<ContextField>) => {
        const updated = fields.map((field, i) =>
            i === index ? { ...field, ...updates } : field
        );
        onChange(updated);
        setEditingIndex(null);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Existing Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {fields.map((field, index) => (
                    <div
                        key={index}
                        style={{
                            display: 'flex',
                            gap: '8px',
                            padding: '8px',
                            background: 'var(--color-bg-secondary)',
                            borderRadius: 'var(--radius-sm)',
                            alignItems: 'center',
                        }}
                    >
                        {editingIndex === index ? (
                            <>
                                <input
                                    type="text"
                                    className="form-input"
                                    style={{ flex: 1 }}
                                    value={field.value}
                                    onChange={(e) =>
                                        handleUpdateField(index, { value: e.target.value })
                                    }
                                    onBlur={() => setEditingIndex(null)}
                                    autoFocus
                                />
                            </>
                        ) : (
                            <>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        {field.key}
                                    </div>
                                    <div style={{ fontSize: '14px', color: 'var(--color-text-primary)' }}>
                                        {field.value || '(empty)'}
                                    </div>
                                </div>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setEditingIndex(index)}
                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                >
                                    Edit
                                </button>
                                <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleRemoveField(index)}
                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                >
                                    ×
                                </button>
                            </>
                        )}
                    </div>
                ))}

                {fields.length === 0 && (
                    <div
                        style={{
                            padding: '16px',
                            textAlign: 'center',
                            color: 'var(--color-text-secondary)',
                            fontSize: '14px',
                        }}
                    >
                        No fields yet. Add your first field below.
                    </div>
                )}
            </div>

            {/* Add New Field */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                    Add New Field
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: '8px' }}>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Key (e.g., linkedin)"
                        value={newFieldKey}
                        onChange={(e) => setNewFieldKey(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddField()}
                    />
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Value (e.g., https://...)"
                        value={newFieldValue}
                        onChange={(e) => setNewFieldValue(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddField()}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={handleAddField}
                        disabled={!newFieldKey.trim() || !newFieldValue.trim()}
                    >
                        + Add
                    </button>
                </div>
            </div>
        </div>
    );
}
