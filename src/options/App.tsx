import { useEffect, useState } from 'react';
import type { Profile, StaticContext, ContextField } from '@shared/types';
import { MessageBus } from '@shared/messaging';
import { FieldEditor } from './components/FieldEditor';
import { KnowledgeBaseEditor } from './components/KnowledgeBaseEditor';
import './styles.css';

type Page = 'profiles' | 'settings' | 'privacy' | 'about';

function App() {
    const [currentPage, setCurrentPage] = useState<Page>('profiles');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

    useEffect(() => {
        loadProfiles();

        const unsubscribe = MessageBus.subscribe(['PROFILES_UPDATE'], (message) => {
            setProfiles(message.payload.profiles);
        });

        return () => unsubscribe();
    }, []);

    async function loadProfiles() {
        try {
            const response = await MessageBus.sendToBackground('GET_PROFILES', undefined as never);
            if (response?.profiles) {
                setProfiles(response.profiles);
            }
        } catch (error) {
            console.error('Failed to load profiles:', error);
        }
    }

    function openCreateModal() {
        setEditingProfile(null);
        setShowModal(true);
    }

    function openEditModal(profile: Profile) {
        setEditingProfile(profile);
        setShowModal(true);
    }

    async function handleDeleteProfile(profileId: string) {
        if (!confirm('Are you sure you want to delete this profile?')) return;

        try {
            await MessageBus.sendToBackground('DELETE_PROFILE', { profileId });
        } catch (error) {
            console.error('Failed to delete profile:', error);
        }
    }

    return (
        <div className="options-container">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <span className="sidebar-logo">🎯</span>
                    <span className="sidebar-title">FormQ</span>
                </div>

                <nav className="sidebar-nav">
                    <button
                        className={`nav-item ${currentPage === 'profiles' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('profiles')}
                    >
                        <span className="nav-item-icon">👤</span>
                        Profiles
                    </button>
                    <button
                        className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('settings')}
                    >
                        <span className="nav-item-icon">⚙️</span>
                        Settings
                    </button>
                    <button
                        className={`nav-item ${currentPage === 'privacy' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('privacy')}
                    >
                        <span className="nav-item-icon">🔒</span>
                        Privacy
                    </button>
                    <button
                        className={`nav-item ${currentPage === 'about' ? 'active' : ''}`}
                        onClick={() => setCurrentPage('about')}
                    >
                        <span className="nav-item-icon">ℹ️</span>
                        About
                    </button>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                {currentPage === 'profiles' && (
                    <ProfilesPage
                        profiles={profiles}
                        onCreateNew={openCreateModal}
                        onEdit={openEditModal}
                        onDelete={handleDeleteProfile}
                    />
                )}
                {currentPage === 'settings' && <SettingsPage />}
                {currentPage === 'privacy' && <PrivacyPage />}
                {currentPage === 'about' && <AboutPage />}
            </main>

            {/* Profile Modal */}
            {showModal && (
                <ProfileModal
                    profile={editingProfile}
                    onClose={() => setShowModal(false)}
                    onSave={() => {
                        setShowModal(false);
                        loadProfiles();
                    }}
                />
            )}
        </div>
    );
}

/* Profiles Page */
interface ProfilesPageProps {
    profiles: Profile[];
    onCreateNew: () => void;
    onEdit: (profile: Profile) => void;
    onDelete: (profileId: string) => void;
}

function ProfilesPage({ profiles, onCreateNew, onEdit, onDelete }: ProfilesPageProps) {
    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Profiles</h1>
                <p className="page-description">
                    Manage your form-filling profiles. Each profile contains information for a specific context.
                </p>
            </header>

            <div className="card">
                <div className="card-header">
                    <h2 className="card-title">Your Profiles</h2>
                    <button className="btn btn-primary" onClick={onCreateNew}>
                        + New Profile
                    </button>
                </div>

                {profiles.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📋</div>
                        <h3>No profiles yet</h3>
                        <p>Create your first profile to start auto-filling forms.</p>
                        <button className="btn btn-primary" onClick={onCreateNew}>
                            Create Profile
                        </button>
                    </div>
                ) : (
                    <div className="profile-list">
                        {profiles.map((profile) => (
                            <div key={profile.id} className="profile-card">
                                <div className="profile-info">
                                    <div className="profile-avatar">
                                        {profile.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="profile-name">{profile.name}</div>
                                        <div className="profile-meta">
                                            {profile.staticContext.fields.length} fields ·
                                            Updated {formatDate(profile.updatedAt)}
                                        </div>
                                    </div>
                                </div>
                                <div className="profile-actions">
                                    <button className="btn btn-secondary btn-sm" onClick={() => onEdit(profile)}>
                                        Edit
                                    </button>
                                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(profile.id)}>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

/* Profile Modal */
interface ProfileModalProps {
    profile: Profile | null;
    onClose: () => void;
    onSave: () => void;
}

function ProfileModal({ profile, onClose, onSave }: ProfileModalProps) {
    const [name, setName] = useState(profile?.name || '');
    const [fields, setFields] = useState<ContextField[]>(
        profile?.staticContext.fields || []
    );
    const [knowledgeBase, setKnowledgeBase] = useState(
        profile?.staticContext.knowledgeBase || ''
    );
    const [saving, setSaving] = useState(false);

    async function handleSave() {
        if (!name.trim()) return;

        setSaving(true);

        try {
            const staticContext: StaticContext = {
                fields,
                documents: profile?.staticContext.documents || [],
                knowledgeBase,
                knowledgeBaseChunks: profile?.staticContext.knowledgeBaseChunks || 0,
            };

            if (profile) {
                await MessageBus.sendToBackground('UPDATE_PROFILE', {
                    profile: {
                        ...profile,
                        name: name.trim(),
                        staticContext,
                    },
                });
            } else {
                await MessageBus.sendToBackground('CREATE_PROFILE', {
                    profile: {
                        name: name.trim(),
                        staticContext,
                    } as Omit<Profile, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
                });
            }

            onSave();
        } catch (error) {
            console.error('Failed to save profile:', error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        {profile ? 'Edit Profile' : 'Create Profile'}
                    </h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '0 24px' }}>
                    <div className="form-group">
                        <label className="form-label">Profile Name</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="e.g., Job Applications"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Fields</label>
                        <FieldEditor fields={fields} onChange={setFields} />
                    </div>

                    <div className="form-group">
                        <KnowledgeBaseEditor
                            profileId={profile?.id || ''}
                            knowledgeBase={knowledgeBase}
                            knowledgeBaseChunks={profile?.staticContext.knowledgeBaseChunks}
                            onChange={setKnowledgeBase}
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={saving || !name.trim()}
                    >
                        {saving ? 'Saving...' : (profile ? 'Save Changes' : 'Create Profile')}
                    </button>
                </div>
            </div>
        </div>
    );
}

/* Settings Page */
function SettingsPage() {
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean | null>(null);
    const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
    const [aiStatus, setAiStatus] = useState<{ available: boolean; chatModel: string; embeddingModel: string } | null>(null);

    // Load AI status on mount
    useEffect(() => {
        loadAIStatus();
    }, []);

    async function loadAIStatus() {
        try {
            const response = await MessageBus.sendToBackground('GET_AI_STATUS', undefined as never);
            if (response) {
                setAiStatus(response);
            }
        } catch (error) {
            console.error('Failed to load AI status:', error);
        }
    }

    async function handleSaveApiKey() {
        if (!apiKey.trim()) return;

        setSaving(true);
        setSaveSuccess(null);
        setTestResult(null);

        try {
            const response = await MessageBus.sendToBackground('SET_API_KEY', { apiKey: apiKey.trim() });
            setSaveSuccess(response?.success ?? false);

            if (response?.success) {
                // Reload AI status after saving
                await loadAIStatus();
                setApiKey(''); // Clear input after successful save
            }
        } catch (error) {
            console.error('Failed to save API key:', error);
            setSaveSuccess(false);
        } finally {
            setSaving(false);
        }
    }

    async function handleTestConnection() {
        setTesting(true);
        setTestResult(null);

        try {
            const result = await MessageBus.sendToBackground('TEST_API_CONNECTION', undefined as never);
            setTestResult(result ?? { success: false, error: 'No response' });
        } catch (error) {
            console.error('Failed to test connection:', error);
            setTestResult({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setTesting(false);
        }
    }

    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Settings</h1>
                <p className="page-description">Configure the extension behavior and API connections.</p>
            </header>

            <div className="card">
                <h2 className="card-title">AI Configuration</h2>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    Connect to OpenRouter for AI-powered form filling.
                </p>

                {/* AI Status */}
                <div style={{
                    padding: '12px',
                    background: aiStatus?.available ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                    }}>
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: aiStatus?.available ? '#22c55e' : '#ef4444',
                        }} />
                        <strong style={{ fontSize: '14px' }}>
                            {aiStatus?.available ? 'AI Enabled' : 'AI Disabled'}
                        </strong>
                    </div>
                    {aiStatus && (
                        <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: 0 }}>
                            Chat: {aiStatus.chatModel} | Embeddings: {aiStatus.embeddingModel}
                        </p>
                    )}
                </div>

                <div className="form-group">
                    <label className="form-label">OpenRouter API Key</label>
                    <input
                        type="password"
                        className="form-input"
                        placeholder="sk-or-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                    />
                    <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                        Get your API key from{' '}
                        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--color-primary)' }}>
                            openrouter.ai/keys
                        </a>
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleSaveApiKey}
                        disabled={saving || !apiKey.trim()}
                    >
                        {saving ? 'Saving...' : 'Save API Key'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleTestConnection}
                        disabled={testing || !aiStatus?.available}
                    >
                        {testing ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>

                {/* Feedback Messages */}
                {saveSuccess === true && (
                    <p style={{ color: '#22c55e', marginTop: '12px', fontSize: '14px' }}>
                        ✓ API key saved successfully!
                    </p>
                )}
                {saveSuccess === false && (
                    <p style={{ color: '#ef4444', marginTop: '12px', fontSize: '14px' }}>
                        ✗ Failed to save API key.
                    </p>
                )}
                {testResult && (
                    <p style={{
                        color: testResult.success ? '#22c55e' : '#ef4444',
                        marginTop: '12px',
                        fontSize: '14px',
                    }}>
                        {testResult.success
                            ? '✓ Connection successful!'
                            : `✗ Connection failed: ${testResult.error || 'Unknown error'}`}
                    </p>
                )}
            </div>

            <div className="card">
                <h2 className="card-title">Behavior</h2>

                <div className="toggle-group">
                    <div>
                        <div className="toggle-label">Auto-detect forms</div>
                        <div className="toggle-desc">Automatically detect forms when pages load</div>
                    </div>
                    <div className="toggle active" />
                </div>

                <div className="toggle-group">
                    <div>
                        <div className="toggle-label">Show notifications</div>
                        <div className="toggle-desc">Display notifications when forms are filled</div>
                    </div>
                    <div className="toggle active" />
                </div>

                <div className="toggle-group">
                    <div>
                        <div className="toggle-label">Humanize typing</div>
                        <div className="toggle-desc">Type characters one-by-one to avoid bot detection</div>
                    </div>
                    <div className="toggle active" />
                </div>
            </div>
        </>
    );
}

/* Privacy Page */
function PrivacyPage() {
    return (
        <>
            <header className="page-header">
                <h1 className="page-title">Privacy & Security</h1>
                <p className="page-description">Control your data and security settings.</p>
            </header>

            <div className="card">
                <h2 className="card-title">Data Storage</h2>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    All your data is stored locally in your browser. Nothing is sent to external servers
                    except for AI inference requests (when enabled).
                </p>

                <div className="toggle-group">
                    <div>
                        <div className="toggle-label">Encrypt sensitive fields</div>
                        <div className="toggle-desc">Encrypt passwords and other sensitive data at rest</div>
                    </div>
                    <div className="toggle active" />
                </div>
            </div>

            <div className="card">
                <h2 className="card-title">Field Denylist</h2>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                    These field types are never auto-filled for security reasons:
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {['password', 'otp', '2fa', 'cvv', 'ssn', 'pin', 'token'].map((field) => (
                        <span
                            key={field}
                            style={{
                                padding: '4px 12px',
                                background: 'var(--color-bg-tertiary)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '13px',
                                color: 'var(--color-text-secondary)',
                            }}
                        >
                            {field}
                        </span>
                    ))}
                </div>
            </div>

            <div className="card">
                <h2 className="card-title" style={{ color: 'var(--color-error)' }}>Danger Zone</h2>

                <button className="btn btn-danger" style={{ marginTop: '12px' }}>
                    Clear All Data
                </button>
            </div>
        </>
    );
}

/* About Page */
function AboutPage() {
    return (
        <>
            <header className="page-header">
                <h1 className="page-title">About</h1>
                <p className="page-description">FormQ - AI-Assisted Form Autofill</p>
            </header>

            <div className="card">
                <h2 className="card-title">Version</h2>
                <p style={{ color: 'var(--color-text-secondary)' }}>0.1.0 (Phase 1)</p>
            </div>

            <div className="card">
                <h2 className="card-title">Features</h2>
                <ul style={{
                    color: 'var(--color-text-secondary)',
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                }}>
                    <li>Form detection</li>
                    <li>Profile management</li>
                    <li>Static field mapping</li>
                    <li>AI-powered filling (Phase 3)</li>
                    <li>Learning from edits (Phase 3)</li>
                </ul>
            </div>
        </>
    );
}

/* Helpers */
function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

export default App;
