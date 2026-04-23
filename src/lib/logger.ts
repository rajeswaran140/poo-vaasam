/**
 * Centralized Logging Utility
 *
 * Provides structured logging with different log levels
 * and environment-aware behavior
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

interface LogMetadata {
  [key: string]: any;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: LogMetadata;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private isDevelopment: boolean;
  private isDebugEnabled: boolean;

  constructor() {
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isDebugEnabled = process.env.DEBUG === 'true' || this.isDevelopment;
  }

  /**
   * Format log entry as structured JSON
   */
  private formatLog(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Log debug messages (only in development or when DEBUG=true)
   */
  debug(message: string, metadata?: LogMetadata): void {
    if (!this.isDebugEnabled) return;

    const entry: LogEntry = {
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    console.log(this.formatLog(entry));
  }

  /**
   * Log informational messages
   */
  info(message: string, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      level: LogLevel.INFO,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    console.log(this.formatLog(entry));
  }

  /**
   * Log warning messages
   */
  warn(message: string, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      level: LogLevel.WARN,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    console.warn(this.formatLog(entry));
  }

  /**
   * Log error messages
   */
  error(message: string, error?: Error | unknown, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      level: LogLevel.ERROR,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };

    if (error instanceof Error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    } else if (error) {
      entry.error = {
        message: String(error),
      };
    }

    console.error(this.formatLog(entry));
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): ContextLogger {
    return new ContextLogger(this, context);
  }
}

/**
 * Context-aware logger that includes context in all log entries
 */
class ContextLogger {
  constructor(
    private parent: Logger,
    private context: string
  ) {}

  debug(message: string, metadata?: LogMetadata): void {
    this.parent.debug(message, { context: this.context, ...metadata });
  }

  info(message: string, metadata?: LogMetadata): void {
    this.parent.info(message, { context: this.context, ...metadata });
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.parent.warn(message, { context: this.context, ...metadata });
  }

  error(message: string, error?: Error | unknown, metadata?: LogMetadata): void {
    this.parent.error(message, error, { context: this.context, ...metadata });
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience method for creating context loggers
export function createLogger(context: string): ContextLogger {
  return logger.child(context);
}
