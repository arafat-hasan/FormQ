import { useEffect, useState } from 'react';
import type { Profile, FillState } from '@shared/types';
import { MessageBus } from '@shared/messaging';
import './styles.css';

interface ProfilesResponse {
    profiles: Profile[];
}

interface StateResponse {
    state: FillState;
}

function App() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const [state, setState] = useState<FillState>({ type: 'IDLE', tabId: -1, timestamp: Date.now() });
    const [loading, setLoading] = useState(true);
    const [aiAvailable, setAiAvailable] = useState(false);
    const [lastFillSource, setLastFillSource] = useState<string | null>(null);

    useEffect(() => {
        // Load initial data
        loadData();

        // Subscribe to updates
        const unsubscribe = MessageBus.subscribe(
            ['PROFILES_UPDATE', 'STATE_UPDATE'],
            (message) => {
                const payload = message.payload as Record<string, unknown>;
                if (message.type === 'PROFILES_UPDATE' && 'profiles' in payload) {
                    setProfiles(payload.profiles as Profile[]);
                } else if (message.type === 'STATE_UPDATE' && 'state' in payload) {
                    setState(payload.state as FillState);
                }
            }
        );

        return () => unsubscribe();
    }, []);

    async function loadData() {
        try {
            const [profilesRes, stateRes, aiStatusRes] = await Promise.all([
                MessageBus.sendToBackground('GET_PROFILES', undefined as never),
                MessageBus.sendToBackground('GET_STATE', undefined as never),
                MessageBus.sendToBackground('GET_AI_STATUS', undefined as never),
            ]);

            const profilesResult = profilesRes as ProfilesResponse | undefined;
            const stateResult = stateRes as StateResponse | undefined;
            const aiStatus = aiStatusRes as { available: boolean } | undefined;

            if (profilesResult?.profiles) {
                setProfiles(profilesResult.profiles);
                if (profilesResult.profiles.length > 0 && !activeProfileId) {
                    setActiveProfileId(profilesResult.profiles[0].id);
                }
            }

            if (stateResult?.state) {
                setState(stateResult.state);
            }

            if (aiStatus) {
                setAiAvailable(aiStatus.available);
            }
        } catch (error) {
            console.error('Failed to load data:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleFill() {
        if (!activeProfileId) return;

        try {
            // Use AI fill - it will automatically fallback to static if API key not set
            const result = await MessageBus.sendToBackground('REQUEST_AI_FILL', {
                profileId: activeProfileId,
                useCache: true,
            });

            // Track what source was used
            const fillResult = result as { success: boolean; source?: string; fallbackReason?: string } | undefined;
            if (fillResult?.source) {
                setLastFillSource(fillResult.source);
            }
        } catch (error) {
            console.error('Failed to trigger AI fill:', error);
        }
    }

    async function handleProfileChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const profileId = e.target.value;
        setActiveProfileId(profileId);
        await MessageBus.sendToBackground('SET_ACTIVE_PROFILE', { profileId });
    }

    function openOptions() {
        chrome.runtime.openOptionsPage();
    }

    if (loading) {
        return (
            <div className="popup-container">
                <div className="loading">Loading...</div>
            </div>
        );
    }

    return (
        <div className="popup-container">
            {/* Header */}
            <header className="popup-header">
                <h1>
                    <span className="logo">🎯</span>
                    FormQ
                </h1>
                <button className="settings-btn" onClick={openOptions} title="Settings">
                    ⚙️
                </button>
            </header>

            {profiles.length === 0 ? (
                /* No Profile State */
                <div className="no-profile">
                    <div className="no-profile-icon">📋</div>
                    <h3>No Profiles Yet</h3>
                    <p>Create a profile to start auto-filling forms with your information.</p>
                    <button className="create-profile-btn" onClick={openOptions}>
                        Create Profile
                    </button>
                </div>
            ) : (
                <>
                    {/* Profile Selector */}
                    <section className="section">
                        <div className="section-title">Active Profile</div>
                        <div className="profile-selector">
                            <select
                                className="profile-select"
                                value={activeProfileId || ''}
                                onChange={handleProfileChange}
                            >
                                {profiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                        {profile.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </section>

                    {/* Fill Button */}
                    <section className="section">
                        <button
                            className="fill-btn"
                            onClick={handleFill}
                            disabled={state.type === 'FILLING' || state.type === 'INFERRING'}
                        >
                            {state.type === 'FILLING' ? (
                                <>⏳ Filling...</>
                            ) : state.type === 'INFERRING' ? (
                                <>🤖 AI thinking...</>
                            ) : aiAvailable ? (
                                <>✨ AI Fill</>
                            ) : (
                                <>✨ Fill Form</>
                            )}
                        </button>
                        {/* AI Status Badge */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '8px',
                            marginTop: '8px',
                            fontSize: '12px',
                        }}>
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                background: aiAvailable ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 100, 100, 0.15)',
                                color: aiAvailable ? '#22c55e' : '#888',
                                borderRadius: '10px',
                            }}>
                                <span style={{
                                    width: '6px',
                                    height: '6px',
                                    borderRadius: '50%',
                                    background: aiAvailable ? '#22c55e' : '#888',
                                }} />
                                {aiAvailable ? 'AI Enabled' : 'Static Mode'}
                            </span>
                            {lastFillSource && (
                                <span style={{
                                    padding: '2px 8px',
                                    background: 'rgba(100, 100, 100, 0.15)',
                                    color: '#888',
                                    borderRadius: '10px',
                                }}>
                                    Last: {lastFillSource}
                                </span>
                            )}
                        </div>
                    </section>


                    {/* Status */}
                    <section className="section">
                        <div className="section-title">Status</div>
                        <div className="status-card">
                            <div className="status-row">
                                <span className={`status-dot ${getStatusClass(state.type)}`} />
                                <span className="status-text">{getStatusText(state)}</span>
                            </div>
                        </div>
                    </section>
                </>
            )}

            {/* Footer */}
            <footer className="popup-footer">
                <a href="#" className="footer-link" onClick={openOptions}>
                    Manage Profiles
                </a>
                <a href="#" className="footer-link" onClick={openOptions}>
                    Settings
                </a>
            </footer>
        </div>
    );
}

function getStatusClass(stateType: FillState['type']): string {
    switch (stateType) {
        case 'FILLING':
        case 'DETECTING':
        case 'ANALYZING':
        case 'RETRIEVING':
        case 'INFERRING':
            return 'active';
        case 'ERROR':
            return 'error';
        default:
            return '';
    }
}

function getStatusText(state: FillState): string {
    switch (state.type) {
        case 'IDLE':
            return 'Ready to fill';
        case 'DETECTING':
            return 'Detecting forms...';
        case 'ANALYZING':
            return 'Analyzing form fields...';
        case 'RETRIEVING':
            return 'Retrieving context...';
        case 'INFERRING':
            return 'AI is thinking...';
        case 'FILLING':
            if ('progress' in state && state.progress) {
                return `Filling ${state.progress.completed}/${state.progress.total} fields...`;
            }
            return 'Filling form...';
        case 'AWAITING_REVIEW':
            return 'Waiting for review...';
        case 'LEARNING':
            return 'Learning from edits...';
        case 'ERROR':
            return `Error: ${state.error}`;
        default:
            return 'Unknown state';
    }
}

export default App;
