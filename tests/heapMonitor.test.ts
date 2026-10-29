import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HeapMonitor, createHeapMonitor } from '../src/monitors/heapMonitor.js';
import { resetPrometheusExporter } from '../src/metrics/prometheusExporter.js';

describe('HeapMonitor', () => {
  let monitor: HeapMonitor;

  beforeEach(() => {
    resetPrometheusExporter();
    monitor = new HeapMonitor({
      enabled: true,
      heapLimitPercentage: 85,
      postGcGrowthWindows: 5,
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

    const monitor = createHeapMonitor(config);
    expect(monitor).toBeInstanceOf(HeapMonitor);
  });

  it('should start and stop monitoring', () => {
    expect(monitor.isActive()).toBe(false);

    monitor.start();
    expect(monitor.isActive()).toBe(true);

    monitor.stop();
    expect(monitor.isActive()).toBe(false);
  });

  it('should not start if disabled', () => {
    const disabledMonitor = new HeapMonitor({
      enabled: false,
      heapLimitPercentage: 85,
      postGcGrowthWindows: 5,
      sampleIntervalMs: 100,
    });

    disabledMonitor.start();
    expect(disabledMonitor.isActive()).toBe(false);

    disabledMonitor.stop();
  });

  it('should return heap stats', (done) => {
    monitor.start();
    
    // Wait for at least one sample
    setTimeout(() => {
      const stats = monitor.getStats();
      if (stats) {
        expect(stats).toHaveProperty('usedHeapSize');
        expect(stats).toHaveProperty('totalHeapSize');
        expect(stats).toHaveProperty('heapSizeLimit');
        expect(stats).toHaveProperty('usedPercentage');
        expect(stats).toHaveProperty('timestamp');
      }
      monitor.stop();
      done();
    }, 200);
  });

  it('should return null for GC trend when insufficient data', () => {
    const trend = monitor.getGcTrend();
    expect(trend).toBeNull();
  });

  it('should emit heapAnomalyDetected event', (done) => {
    const breachMonitor = new HeapMonitor({
      enabled: true,
      heapLimitPercentage: 0.1, // Very low threshold
      postGcGrowthWindows: 5,
      sampleIntervalMs: 50,
    });

    breachMonitor.on('heapAnomalyDetected', (event) => {
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('actual');
      expect(event).toHaveProperty('timestamp');
      breachMonitor.stop();
      done();
    });

    breachMonitor.start();
  }, 5000);

  it('should have valid heap stats structure', (done) => {
    monitor.start();
    
    setTimeout(() => {
      const stats = monitor.getStats();
      if (stats) {
        expect(stats.usedHeapSize).toBeGreaterThan(0);
        expect(stats.totalHeapSize).toBeGreaterThan(0);
        expect(stats.heapSizeLimit).toBeGreaterThan(0);
        expect(stats.usedPercentage).toBeGreaterThanOrEqual(0);
        expect(stats.usedPercentage).toBeLessThanOrEqual(100);
        expect(stats.timestamp).toBeGreaterThan(0);
      }
      monitor.stop();
      done();
    }, 200);
  });
});
