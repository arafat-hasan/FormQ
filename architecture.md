# FormQ - System Architecture

## 1. Overview

**FormQ** is an AI-powered browser extension built on Manifest V3 that intelligently fills web forms using a combination of static profile data, machine learning, and Retrieval-Augmented Generation (RAG). The system operates in a client-heavy, local-first architecture with optional AI capabilities through OpenRouter APIs.

### Core Capabilities
- **Intelligent Form Detection**: Automatically detects and analyzes form fields using semantic classification
- **Hybrid Form Filling**: Combines static profile data with AI-generated responses
- **Learning System**: Learns from user corrections via RAG-based vector storage
- **Profile Management**: Multiple contextual profiles with URL bindings
- **Privacy-First**: Local storage, encryption support, sensitive field exclusion

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Extension                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌───────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Popup UI │    │  Options UI  │    │  Content Script  │  │
│  │  (React)  │    │   (React)    │    │  (DOM Analysis)  │  │
│  └─────┬─────┘    └──────┬───────┘    └────────┬─────────┘  │
│        │                 │                     │             │
│        └─────────────────┴──────────┬──────────┘             │
│                                    │                         │
│                         ┌──────────▼──────────┐              │
│                         │  Message Bus        │              │
│                         │  (chrome.runtime)   │              │
│                         └──────────┬──────────┘              │
│                                    │                         │
│              ┌─────────────────────▼─────────────────┐       │
│              │   Background Service Worker           │       │
│              ├───────────────────────────────────────┤       │
│              │  • Profile Manager                    │       │
│              │  • LLM Orchestrator                   │       │
│              │  • RAG Engine                         │       │
│              │  • Learning Service                   │       │
│              │  • State Management                   │       │
│              └──────────┬────────────┬──────────────┘        │
│                         │            │                       │
│                  ┌──────▼────┐  ┌────▼─────────┐            │
│                  │ IndexedDB  │  │  OpenRouter  │            │
│                  │  Storage   │  │  API (Cloud) │            │
│                  └────────────┘  └──────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Component Architecture

### 3.1 Content Script Layer
**Location**: `src/content/`

**Purpose**: Interacts with web page DOM, detects forms, executes fills

**Key Components**:
- **FormDetector**: Identifies HTML forms and form-like structures
- **FieldSignature**: Extracts semantic metadata from input fields
- **DOMUtils**: Provides safe DOM traversal and element access
- **FillExecutor**: Executes form filling with humanization

**Data Flow**:
1. Observes DOM for forms using MutationObserver
2. Extracts field signatures (labels, attributes, semantic class)
3. Sends `FORM_DETECTED` message to background
4. Receives `FILL_COMMAND` and executes filling
5. Reports progress and completion

### 3.2 Background Service Worker
**Location**: `src/background/`

**Purpose**: Central orchestration, state management, AI coordination

**Sub-components**:

#### 3.2.1 Profile Manager
**Location**: `src/shared/storage/ProfileService.ts`

**Responsibilities**:
- CRUD operations for profiles
- URL binding management
- Profile import/export
- Profile duplication

**Key Data Structure**:
```typescript
Profile {
  id: string
  name: string
  staticContext: {
    fields: Record<string, ContextField>  // Key-value pairs
    documents: ContextDocument[]          // Resumes, cover letters
  }
  learnedExamples: LearnedExample[]      // Learning history
  urlBindings: URLBinding[]              // Auto-trigger rules
  settings: ProfileSettings
}
```

#### 3.2.2 LLM Orchestrator
**Location**: `src/background/ai/LLMOrchestrator.ts`

**Responsibilities**:
- Coordinates LLM-powered form filling
- Fallback to static mapping on errors
- Response validation
- Hybrid mapping (merging LLM + static results)

**Current Flow**:
```
1. Check if LLM available (API key set)
2. Build prompt (system + user with context)
3. Call OpenRouter API
4. Validate response against form schema
5. Merge with static mappings
6. Return hybrid result OR fallback to static
```

#### 3.2.3 RAG Engine
**Location**: `src/background/ai/RAGEngine.ts`

**Responsibilities**:
- Vector search over learned examples
- Document ingestion and chunking
- Contextual retrieval for prompts

**Workflow**:
```
1. User fills form → Learned example created
2. Example text generated → Embedded via OpenRouter
3. Vector stored in IndexedDB
4. On new form → Query embedding created
5. k-NN search over profile vectors
6. Top-k results added to LLM prompt context
```

#### 3.2.4 Field Mapper (Static)
**Location**: `src/shared/matching/FieldMapper.ts`

**Responsibilities**:
- Static semantic mapping
- Profile field key → Form field semantic class
- Fuzzy matching for unknown fields
- Full name splitting/joining logic

**Mapping Strategy**:
```
SemanticClass → Profile Keys
first_name    → ['firstName', 'first_name', 'givenName']
email         → ['email', 'emailAddress', 'email_address']
phone         → ['phone', 'phoneNumber', 'mobile']
...
```

### 3.3 Storage Layer
**Location**: `src/shared/storage/`

**IndexedDB Schema (Version 1)**:

| Store      | Key Path | Indexes                    | Purpose                  |
|------------|----------|----------------------------|--------------------------|
| profiles   | id       | name, updatedAt            | User profiles            |
| vectors    | id       | profileId, sourceType      | Embeddings for RAG       |
| llm_cache  | key      | expiresAt                  | LLM response cache       |
| metadata   | key      | -                          | App settings             |

**VectorEntry Structure**:
```typescript
{
  id: string                                    // Unique ID
  profileId: string                             // Parent profile
  embedding: number[]                           // 1536-dim vector (OpenRouter)
  sourceType: 'learned_example' | 'document'   // Origin
  sourceId: string                              // Reference to source
  text: string                                  // Original text
  createdAt: number
}
```

### 3.4 UI Layer
**Location**: `src/popup/`, `src/options/`

**Technology**: React + TypeScript + CSS Modules

**Popup Features**:
- Profile selector
- Fill trigger (static/AI buttons)
- Fill state display
- Quick settings

**Options Features**:
- Profile creation/editing
- Static field configuration (currently fixed fields)
- API key management
- URL bindings

---

## 4. Data Flow Diagrams

### 4.1 Current Form Filling Flow (Dual Mode)

#### Static Fill (`TRIGGER_FILL`)
```
User clicks "Fill" 
  → Background: Get active profile
  → FieldMapper: createSuggestedMappings(fields, profile)
  → Lookup static fields by semantic class
  → Send mappings to content script
  → FillExecutor: Fill fields with humanization
```

#### AI Fill (`REQUEST_AI_FILL`)
```
User clicks "AI Fill"
  → Background: Get active profile
  → RAGEngine: Retrieve relevant vectors
  → LLMOrchestrator: Build prompt with context
  → OpenRouter API: Generate field values
  → ResponseValidator: Validate JSON response
  → Merge with static mappings (hybrid)
  → Send to content script
  → Execute fill
```

### 4.2 Learning Flow
```
User fills form
  → Content script detects form
  → User edits filled values
  → User confirms/submits
  → LearnedExample created
  → RAGEngine: Generate embedding
  → Store in vectors store
  → Future fills use this context
```

---

## 5. Current Architecture Issues & User Requirements

### 5.1 Current State
**Problem**: Dual fill modes (static vs AI) are separate pathways
- User must choose between static or AI fill
- No automatic fallback within a single fill operation
- Static fields are fixed in UI (firstName, lastName, email, etc.)

### 5.2 User Requirements
1. **Combined Fill Strategy**: 
   - If field available in static profile → use static
   - If not in static → use LLM to generate

2. **Flexible Profile Fields**:
   - Remove fixed field schema
   - Allow users to add arbitrary key-value pairs
   - Dynamic field creation in UI

3. **Knowledge Base Integration**:
   - Add free-text "knowledge base" field per profile
   - Embed knowledge base chunks into vector store
   - Use in RAG retrieval for LLM context
   - Enhances LLM's ability to answer unknown fields

---

## 6. Key Design Patterns

### 6.1 Service Worker Persistence
- Service workers can be terminated by browser
- State stored in `chrome.storage.session`
- Restored on worker restart via `restoreSessionState()`

### 6.2 Message Bus Pattern
- All cross-context communication via `MessageBus`
- Request-response pattern with unique message IDs
- Type-safe message payloads

### 6.3 Singleton Services
- All major services exported as singletons
- Lazy initialization on first call
- Prevents duplicate instances

### 6.4 RAG Pattern
- Embed-once, retrieve-many
- Cosine similarity search
- Token budget management for context

### 6.5 Fallback Chain
```
AI Fill Requested
  ↓
LLM Available? → No → Static Fill
  ↓ Yes
LLM Call Success? → No → Static Fill
  ↓ Yes
Response Valid? → No → Static Fill
  ↓ Yes
Hybrid Fill (LLM + Static)
```

---

## 7. Security & Privacy

### 7.1 Sensitive Field Handling
- **Denylist**: password, otp, 2fa, cvv, token
- Never auto-filled, never learned
- Enforced at multiple layers

### 7.2 Data Encryption
- Web Crypto API for sensitive field encryption
- User passphrase-derived keys
- Configurable per-field encryption

### 7.3 Data Isolation
- Profiles completely isolated
- No cross-profile data leakage
- User vectors never leave extension

---

## 8. External Dependencies

### 8.1 OpenRouter API
**Used For**:
- Chat completions (form filling)
- Text embeddings (RAG)

**Models**:
- Chat: GPT-4-class / Claude-class
- Embeddings: text-embedding-3-small equivalent

**Configuration**:
- API key stored in `chrome.storage.local`
- Model selection configurable
- Fallback to static on API failure

### 8.2 Browser APIs
- **chrome.storage**: Profile and settings persistence
- **chrome.runtime**: Message passing
- **chrome.scripting**: Content script injection
- **chrome.contextMenus**: Right-click actions
- **IndexedDB**: Vector storage

---

## 9. Technology Stack Summary

| Layer              | Technology                    |
|--------------------|-------------------------------|
| Extension Platform | Manifest V3 (Chromium)        |
| Language           | TypeScript (strict mode)      |
| UI Framework       | React                         |
| Build System       | Vite + esbuild                |
| Storage            | IndexedDB (via idb wrapper)   |
| AI Provider        | OpenRouter                    |
| Vector Search      | In-memory cosine similarity   |
| Encryption         | Web Crypto API                |
| Linting            | ESLint                        |

---

## 10. Future Enhancement Opportunities

1. **WASM Vector Index**: hnswlib-wasm for faster retrieval at scale
2. **On-Device LLM**: ONNX models for offline operation
3. **Multi-Language Support**: Internationalized form understanding
4. **Advanced Learning**: Reinforcement learning from corrections
5. **Shadow DOM Support**: Enhanced compatibility with modern web components

---

## 11. File Structure

```
src/
├── background/          # Service worker
│   ├── index.ts         # Main orchestration, message handlers
│   ├── ai/              # AI layer
│   │   ├── LLMOrchestrator.ts    # LLM coordination
│   │   ├── RAGEngine.ts          # Vector retrieval
│   │   ├── EmbeddingService.ts   # Embedding generation
│   │   ├── PromptBuilder.ts      # Prompt construction
│   │   └── ResponseValidator.ts  # LLM output validation
│   └── services/        # Utilities
│       ├── OpenRouterClient.ts   # API client
│       ├── CacheService.ts       # Response caching
│       └── LearningService.ts    # Learning logic
│
├── content/             # Content scripts
│   ├── index.ts         # Entry point, message handling
│   ├── FormDetector.ts  # Form discovery
│   ├── FieldSignature.ts # Field metadata extraction
│   ├── FillExecutor.ts   # Form filling execution
│   └── DOMUtils.ts      # DOM utilities
│
├── popup/               # Popup UI
│   ├── App.tsx          # Main component
│   └── styles.css       # Styles
│
├── options/             # Options page
│   └── App.tsx          # Settings UI
│
└── shared/              # Shared utilities
    ├── types/           # TypeScript types
    │   ├── profile.ts   # Profile types
    │   ├── form.ts      # Form types
    │   ├── storage.ts   # Storage types
    │   └── messages.ts  # Message types
    ├── storage/         # Storage layer
    │   ├── StorageService.ts  # IndexedDB wrapper
    │   ├── ProfileService.ts  # Profile CRUD
    │   └── VectorStore.ts     # Vector storage
    ├── matching/        # Static matching
    │   └── FieldMapper.ts     # Semantic matching
    ├── messaging/       # Message bus
    └── utils/           # Utilities
```

---

## 12. Critical Implementation Notes

### 12.1 Current Profile Schema Constraint
The `StaticContext.fields` is a `Record<string, ContextField>` where keys are predefined (e.g., "firstName", "email"). This limits flexibility. The user wants to make this fully dynamic.

### 12.2 Two Separate Fill Pathways
- **TRIGGER_FILL**: Pure static matching
- **REQUEST_AI_FILL**: AI with static fallback

The user wants a **single combined pathway** where static is tried first, then AI fills gaps.

### 12.3 No Knowledge Base Currently
Documents are stored but only embeddings are used for RAG. The user wants a dedicated free-text knowledge base field that enhances LLM prompts.

