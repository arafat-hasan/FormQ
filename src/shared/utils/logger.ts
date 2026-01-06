// Logger Utility
// Consistent logging with levels and debug mode support

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
    private source: string;
    private static debugMode = false;

    constructor(source: string) {
        this.source = source;
    }

    static setDebugMode(enabled: boolean): void {
        Logger.debugMode = enabled;
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        // Skip debug logs if not in debug mode
        if (level === 'debug' && !Logger.debugMode) {
            return;
        }

        const prefix = `[FormQ:${this.source}]`;
        const formattedMessage = `${prefix} ${message}`;

        // Serialize data for better console output
        let serializedData: string | unknown = '';
        if (data !== undefined && data !== null) {
            try {
                if (typeof data === 'object') {
                    serializedData = JSON.stringify(data, null, 2);
                } else {
                    serializedData = data;
                }
            } catch {
                serializedData = String(data);
            }
        }

        switch (level) {
            case 'debug':
                console.debug(formattedMessage, serializedData);
                break;
            case 'info':
                console.info(formattedMessage, serializedData);
                break;
            case 'warn':
                console.warn(formattedMessage, serializedData);
                break;
            case 'error':
                console.error(formattedMessage, serializedData);
                break;
        }
    }

    debug(message: string, data?: unknown): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('error', message, data);
    }
}

/**
 * Create a logger for a specific source/module
 */
export function createLogger(source: string): Logger {
    return new Logger(source);
}

export { Logger };
