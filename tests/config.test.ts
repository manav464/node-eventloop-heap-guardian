import { describe, it, expect, beforeEach } from '@jest/globals';
import { validateConfig, GuardianConfigSchema, defaultConfig } from '../src/config.js';

describe('Configuration Validation', () => {
  it('should accept valid configuration', () => {
    const config = {
      eventLoop: {
        enabled: true,
        resolution: 20,
        p99ThresholdMs: 150,
        consecutiveBreaches: 3,
        sampleIntervalMs: 1000,
      },
      heap: {
        enabled: true,
        heapLimitPercentage: 90,
        postGcGrowthWindows: 5,
        sampleIntervalMs: 1000,
      },
    };

    const result = validateConfig(config);
    expect(result.eventLoop.p99ThresholdMs).toBe(150);
    expect(result.heap.heapLimitPercentage).toBe(90);
  });

  it('should use defaults for missing values', () => {
    const result = validateConfig({});
    expect(result).toEqual(defaultConfig);
  });

  it('should merge user config with defaults', () => {
    const config = {
      eventLoop: {
        enabled: true,
        resolution: 20,
        p99ThresholdMs: 200,
        consecutiveBreaches: 3,
        sampleIntervalMs: 1000,
      },
    };

    const result = validateConfig(config);
    expect(result.eventLoop.p99ThresholdMs).toBe(200);
    expect(result.eventLoop.resolution).toBe(defaultConfig.eventLoop.resolution);
    expect(result.heap).toEqual(defaultConfig.heap);
  });

  it('should validate p99ThresholdMs is positive', () => {
    const config = {
      eventLoop: {
        enabled: true,
        resolution: 20,
        p99ThresholdMs: -10,
        consecutiveBreaches: 3,
        sampleIntervalMs: 1000,
      },
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should validate heapLimitPercentage is between 0 and 100', () => {
    const config = {
      heap: {
        enabled: true,
        heapLimitPercentage: 150,
        postGcGrowthWindows: 5,
        sampleIntervalMs: 1000,
      },
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should validate log level is valid', () => {
    const config = {
      logging: {
        level: 'invalid' as any,
      },
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should accept valid log levels', () => {
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

    for (const level of validLevels) {
      const config = {
        logging: {
          level: level as any,
        },
      };

      const result = validateConfig(config);
      expect(result.logging.level).toBe(level);
    }
  });

  it('should validate consecutiveBreaches is positive integer', () => {
    const config = {
      eventLoop: {
        enabled: true,
        resolution: 20,
        p99ThresholdMs: 100,
        consecutiveBreaches: 0,
        sampleIntervalMs: 1000,
      },
    };

    expect(() => validateConfig(config)).toThrow();
  });

  it('should validate maxPerHour is positive', () => {
    const config = {
      snapshot: {
        enabled: true,
        directory: './snapshots',
        debounceMs: 900000,
        maxPerHour: -1,
        maxTotalSnapshots: 10,
        maxDirectorySizeMb: 500,
        gzipCompression: true,
      },
    };

    expect(() => validateConfig(config)).toThrow();
  });
});
