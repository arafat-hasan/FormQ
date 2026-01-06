# FormQ - AI Form Autofill

AI-powered form autofill browser extension with contextual profiles and learning.

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Build

```bash
# Build for production
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

## Project Structure

```
src/
├── background/     # Service worker (orchestration)
├── content/        # Content script (DOM interaction)
├── popup/          # Popup UI (React)
├── options/        # Options page (React)
├── shared/         # Shared types, utils, messaging
└── assets/         # Icons and styles
```

