import pino from 'pino';

/**
 * Logger level type
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Create a Pino logger instance with Guardian-specific configuration
 * Includes correlation tags for easy log filtering
 *
 * @param level - Log level (default: 'info')
 * @returns Configured Pino logger instance
 */
export function createLogger(level: LogLevel = 'info'): pino.Logger {
  return pino({
    level,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    // Add Guardian tag for easy log filtering
    base: {
      guardian: true,
    },
    // Use pretty output in development if desired
    transport: process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}

/**
 * Default logger instance
 * Can be configured via Guardian config logging.level
 */
export const logger = createLogger('info');

/**
 * Update logger level at runtime
 *
 * @param level - New log level
 */
export function setLogLevel(level: LogLevel): void {
  logger.level = level;
}
