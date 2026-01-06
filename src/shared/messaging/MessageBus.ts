// Message Bus
// Type-safe message passing between extension components

import type {
    Message,
    MessageType,
    MessagePayloadMap,
    MessageResponse
} from '@shared/types';

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Type-safe message bus for Chrome extension communication
 */
export class MessageBus {
    /**
     * Send a message to the background service worker
     */
    static async sendToBackground<T extends MessageType>(
        type: T,
        payload: MessagePayloadMap[T]
    ): Promise<MessageResponse<T>> {
        const message: Message<T> = {
            id: generateMessageId(),
            type,
            payload,
            timestamp: Date.now(),
        };

        return chrome.runtime.sendMessage(message);
    }

    /**
     * Send a message to a specific tab's content script
     */
    static async sendToTab<T extends MessageType>(
        tabId: number,
        type: T,
        payload: MessagePayloadMap[T]
    ): Promise<MessageResponse<T>> {
        const message: Message<T> = {
            id: generateMessageId(),
            type,
            payload,
            timestamp: Date.now(),
        };

        return chrome.tabs.sendMessage(tabId, message);
    }

    /**
     * Send a message to the active tab's content script
     */
    static async sendToActiveTab<T extends MessageType>(
        type: T,
        payload: MessagePayloadMap[T]
    ): Promise<MessageResponse<T>> {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
            throw new Error('No active tab found');
        }

        return this.sendToTab(tab.id, type, payload);
    }

    /**
     * Subscribe to messages of specific types
     * Returns an unsubscribe function
     */
    static subscribe<T extends MessageType>(
        types: T[],
        handler: (
            message: Message<T>,
            sender: chrome.runtime.MessageSender
        ) => unknown | Promise<unknown>
    ): () => void {
        const listener = (
            message: Message,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void
        ): boolean | undefined => {
            if (!types.includes(message.type as T)) {
                return undefined;
            }

            const result = handler(message as Message<T>, sender);

            if (result instanceof Promise) {
                result.then(sendResponse).catch((error) => {
                    console.error('[MessageBus] Handler error:', error);
                    sendResponse({ error: String(error) });
                });
                return true; // Keep channel open for async response
            }

            sendResponse(result);
            return undefined;
        };

        chrome.runtime.onMessage.addListener(listener);

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        };
    }

    /**
     * Subscribe to all messages (for logging/debugging)
     */
    static subscribeAll(
        handler: (message: Message, sender: chrome.runtime.MessageSender) => void
    ): () => void {
        const listener = (
            message: Message,
            sender: chrome.runtime.MessageSender
        ): void => {
            handler(message, sender);
        };

        chrome.runtime.onMessage.addListener(listener);

        return () => {
            chrome.runtime.onMessage.removeListener(listener);
        };
    }
}
