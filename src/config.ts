import { z } from 'zod';

/**
 * Zod schema for Guardian configuration
 * Provides type-safe runtime validation with inferred TypeScript types
 */
export const GuardianConfigSchema = z.object({
  // Event-loop monitoring configuration
  eventLoop: z.object({
    enabled: z.boolean().default(true),
    resolution: z.number().int().positive().default(20), // Resolution in ms for monitorEventLoopDelay
    p99ThresholdMs: z.number().positive().default(100), // Threshold for p99 delay in ms
    consecutiveBreaches: z.number().int().positive().default(3), // Consecutive breaches to trigger anomaly
    sampleIntervalMs: z.number().int().positive().default(1000), // Interval to check thresholds
  }).default({}),

  // Heap monitoring configuration
  heap: z.object({
    enabled: z.boolean().default(true),
    heapLimitPercentage: z.number().positive().max(100).default(85), // Heap size limit percentage threshold
    postGcGrowthWindows: z.number().int().positive().default(5), // Number of post-GC windows to analyze
    sampleIntervalMs: z.number().int().positive().default(1000), // Interval to sample heap stats
  }).default({}),

  // Snapshot configuration
  snapshot: z.object({
    enabled: z.boolean().default(true),
    directory: z.string().default('./snapshots'), // Directory to store snapshots
    debounceMs: z.number().int().positive().default(15 * 60 * 1000), // 15 minutes debounce
    maxPerHour: z.number().int().positive().default(2), // Max snapshots per hour
    maxTotalSnapshots: z.number().int().positive().default(10), // Max total snapshots to keep
    maxDirectorySizeMb: z.number().int().positive().default(500), // Max directory size in MB
    gzipCompression: z.boolean().default(true), // Enable gzip compression
  }).default({}),

  // Monitoring module enable/disable flags
  monitors: z.object({
    eventLoop: z.boolean().default(true),
    heap: z.boolean().default(true),
  }).default({}),

  // Logging configuration
  logging: z.object({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }).default({}),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type GuardianConfig = z.infer<typeof GuardianConfigSchema>;

/**
 * Default configuration values
 */
export const defaultConfig: GuardianConfig = {
  eventLoop: {
    enabled: true,
    resolution: 20,
    p99ThresholdMs: 100,
    consecutiveBreaches: 3,
    sampleIntervalMs: 1000,
  },
  heap: {
    enabled: true,
    heapLimitPercentage: 85,
    postGcGrowthWindows: 5,
    sampleIntervalMs: 1000,
  },
  snapshot: {
    enabled: true,
    directory: './snapshots',
    debounceMs: 15 * 60 * 1000, // 15 minutes
    maxPerHour: 2,
    maxTotalSnapshots: 10,
    maxDirectorySizeMb: 500,
    gzipCompression: true,
  },
  monitors: {
    eventLoop: true,
    heap: true,
  },
  logging: {
    level: 'info',
  },
};

/**
 * Validate and parse configuration
 * Merges user config with defaults and validates against schema
 *
 * @param userConfig - Partial configuration object from user
 * @returns Validated GuardianConfig
 * @throws Error if configuration is invalid
 */
export function validateConfig(userConfig: Partial<GuardianConfig> = {}): GuardianConfig {
  const mergedConfig = deepMerge(defaultConfig, userConfig);
  const result = GuardianConfigSchema.safeParse(mergedConfig);

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid Guardian configuration: ${errors}`);
  }

  return result.data;
}

/**
 * Deep merge utility for nested objects
 * Recursively merges source into target
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key] as any, source[key] as any);
      } else {
        (result as any)[key] = source[key];
      }
    }
  }

  return result;
}
