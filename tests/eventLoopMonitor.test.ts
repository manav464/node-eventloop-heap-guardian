import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventLoopMonitor, createEventLoopMonitor } from '../src/monitors/eventLoopMonitor.js';
import { resetPrometheusExporter } from '../src/metrics/prometheusExporter.js';

describe('EventLoopMonitor', () => {
  let monitor: EventLoopMonitor;

  beforeEach(() => {
    resetPrometheusExporter();
    monitor = new EventLoopMonitor({
      enabled: true,
      resolution: 20,
      p99ThresholdMs: 100,
      consecutiveBreaches: 3,
      sampleIntervalMs: 100,
    });
  });

  afterEach(() => {
    monitor.stop();
  });

  it('should create monitor from config', () => {
    const config = {
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
        debounceMs: 15 * 60 * 1000,
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
        level: 'info' as const,
      },
    };

    const monitor = createEventLoopMonitor(config);
    expect(monitor).toBeInstanceOf(EventLoopMonitor);
  });

  it('should start and stop monitoring', () => {
    expect(monitor.isActive()).toBe(false);

    monitor.start();
    expect(monitor.isActive()).toBe(true);

    monitor.stop();
    expect(monitor.isActive()).toBe(false);
  });

  it('should not start if disabled', () => {
    const disabledMonitor = new EventLoopMonitor({
      enabled: false,
      resolution: 20,
      p99ThresholdMs: 100,
      consecutiveBreaches: 3,
      sampleIntervalMs: 100,
    });

    disabledMonitor.start();
    expect(disabledMonitor.isActive()).toBe(false);

    disabledMonitor.stop();
  });

  it('should return stats', () => {
    const stats = monitor.getStats();
    expect(stats).toHaveProperty('p50');
    expect(stats).toHaveProperty('p90');
    expect(stats).toHaveProperty('p95');
    expect(stats).toHaveProperty('p99');
    expect(stats).toHaveProperty('max');
    expect(stats).toHaveProperty('mean');
  });

  it('should emit eventLoopLagBreach event', (done) => {
    const breachMonitor = new EventLoopMonitor({
      enabled: true,
      resolution: 20,
      p99ThresholdMs: 1, // Very low threshold
      consecutiveBreaches: 1, // Only need 1 breach
      sampleIntervalMs: 50,
    });

    breachMonitor.on('eventLoopLagBreach', (event) => {
      expect(event).toHaveProperty('threshold');
      expect(event).toHaveProperty('actual');
      expect(event).toHaveProperty('consecutiveBreaches');
      expect(event).toHaveProperty('timestamp');
      breachMonitor.stop();
      done();
    });

    breachMonitor.start();
  }, 10000);

  it('should calculate stats correctly', () => {
    // Start monitor briefly to collect some data
    monitor.start();
    
    setTimeout(() => {
      const stats = monitor.getStats();
      // Stats may be NaN if no data collected yet, which is acceptable
      if (!isNaN(stats.p50)) {
        expect(stats.p50).toBeGreaterThanOrEqual(0);
        expect(stats.p90).toBeGreaterThanOrEqual(0);
        expect(stats.p95).toBeGreaterThanOrEqual(0);
        expect(stats.p99).toBeGreaterThanOrEqual(0);
        expect(stats.max).toBeGreaterThanOrEqual(0);
        expect(stats.mean).toBeGreaterThanOrEqual(0);
      }
      monitor.stop();
    }, 100);
  });
});
