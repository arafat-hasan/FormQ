// Content Script Entry Point
// Initializes form detection and message handling

import { createLogger } from '@shared/utils';
import { MessageBus } from '@shared/messaging';
import { detectForms, startFormObserver } from './FormDetector';
import { executeFill } from './FillExecutor';
import type { FormSignature } from '@shared/types';

const logger = createLogger('ContentScript');

// Current detected forms
let currentForms: FormSignature[] = [];

/**
 * Initialize the content script
 */
function initialize(): void {
    logger.info('Initializing content script', { url: window.location.href });

    // Initial form detection
    currentForms = detectForms();

    if (currentForms.length > 0) {
        // Notify background about detected forms
        MessageBus.sendToBackground('FORM_DETECTED', {
            formSignature: currentForms[0]
        }).catch((error) => {
            logger.error('Failed to notify form detection', { error });
        });
    }

    // Start observing for dynamic forms
    startFormObserver((forms) => {
        currentForms = forms;
        if (forms.length > 0) {
            MessageBus.sendToBackground('FORM_DETECTED', {
                formSignature: forms[0]
            }).catch((error) => {
                logger.error('Failed to notify dynamic form detection', { error });
            });
        }
    });

    // Set up message handlers
    setupMessageHandlers();

    logger.info('Content script initialized', {
        formCount: currentForms.length
    });
}

/**
 * Set up message handlers for background communication
 */
function setupMessageHandlers(): void {
    // Handle fill commands
    MessageBus.subscribe(['FILL_COMMAND'], async (message, _sender) => {
        logger.info('Received fill command', {
            fieldCount: message.payload.mappings.length
        });

        const result = await executeFill(message.payload.mappings, {
            humanize: true,
            delayMs: 50,
            onProgress: (completed, total, field) => {
                MessageBus.sendToBackground('FILL_PROGRESS', {
                    completed,
                    total,
                    currentField: field,
                }).catch(() => {
                    // Ignore progress notification errors
                });
            },
        });

        if (result.success) {
            await MessageBus.sendToBackground('FILL_COMPLETE', {
                result: {
                    formSignature: currentForms[0],
                    mappings: message.payload.mappings,
                    skippedFields: [],
                    timestamp: Date.now(),
                    source: 'static',
                },
            });
        } else {
            await MessageBus.sendToBackground('FILL_ERROR', {
                error: result.errors.join('; '),
                code: 'UNKNOWN',
            });
        }

        return { success: result.success };
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
