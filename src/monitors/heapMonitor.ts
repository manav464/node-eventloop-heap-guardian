import { performance, PerformanceObserver } from 'node:perf_hooks';
import { EventEmitter } from 'events';
import v8 from 'node:v8';
import { logger } from '../utils/logger.js';
import { getPrometheusExporter } from '../metrics/prometheusExporter.js';
import type { GuardianConfig } from '../config.js';

/**
 * Heap statistics snapshot
 */
export interface HeapStats {
  usedHeapSize: number;
  totalHeapSize: number;
  heapSizeLimit: number;
  usedPercentage: number;
  timestamp: number;
}

/**
 * Post-GC trend analysis result
 */
export interface GcTrendAnalysis {
  currentHeapSize: number;
  previousHeapSizes: number[];
  isMonotonicGrowth: boolean;
  growthRate: number;
  windowsAnalyzed: number;
}

/**
 * Heap anomaly event payload
 */
export interface HeapAnomalyEvent {
  type: 'limit' | 'growth' | 'gc';
  threshold?: number;
  actual: number;
  timestamp: number;
  details?: any;
}

/**
 * Heap monitor configuration
 */
export interface HeapMonitorConfig {
  enabled: boolean;
  heapLimitPercentage: number;
  postGcGrowthWindows: number;
  sampleIntervalMs: number;
}

/**
 * Heap & GC monitor with post-GC trend analysis
 * Uses PerformanceObserver to track Major GC events
 * Implements sliding window analysis for leak detection
 */
export class HeapMonitor extends EventEmitter {
  private config: HeapMonitorConfig;
  private sampleInterval: NodeJS.Timeout | null = null;
  private perfObserver: PerformanceObserver | null = null;
  private isRunning = false;
  private postGcHeapSizes: number[] = []; // Sliding window of post-GC heap sizes
  private lastHeapStats: HeapStats | null = null;

  constructor(config: HeapMonitorConfig) {
    super();
    this.config = config;
  }

  /**
   * Start monitoring heap and GC events
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    logger.info({
      heapLimitPercentage: this.config.heapLimitPercentage,
      postGcGrowthWindows: this.config.postGcGrowthWindows,
    }, 'Starting heap monitor');

    // Set up PerformanceObserver for GC events
    this.setupGcObserver();

    // Sample heap statistics at configured interval
    this.sampleInterval = setInterval(() => {
      this.sampleHeapStats();
    }, this.config.sampleIntervalMs);
  }

  /**
   * Stop monitoring heap and GC events
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping heap monitor');

    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }

    if (this.perfObserver) {
      this.perfObserver.disconnect();
      this.perfObserver = null;
    }

    this.postGcHeapSizes = [];
  }

  /**
   * Set up PerformanceObserver to track Major GC events
   */
  private setupGcObserver(): void {
    this.perfObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();

      for (const entry of entries) {
        // @ts-ignore - entry.kind is available in Node.js
        if (entry.kind === 'gc' && entry.detail?.type === 'major') {
          this.handleMajorGc();
        }
      }
    });

    this.perfObserver.observe({ entryTypes: ['gc'] });
  }

  /**
   * Handle Major GC event - record post-GC heap size
   */
  private handleMajorGc(): void {
    const heapStats = this.getCurrentHeapStats();

    logger.debug({
      usedHeapSize: heapStats.usedHeapSize,
      usedPercentage: heapStats.usedPercentage,
    }, 'Major GC event');

    // Add to sliding window
    this.postGcHeapSizes.push(heapStats.usedHeapSize);

    // Keep only the last N samples
    if (this.postGcHeapSizes.length > this.config.postGcGrowthWindows) {
      this.postGcHeapSizes.shift();
    }

    // Analyze trend if we have enough samples
    if (this.postGcHeapSizes.length >= this.config.postGcGrowthWindows) {
      this.analyzePostGcTrend();
    }
  }

  /**
   * Analyze post-GC heap trend for monotonic growth
   */
  private analyzePostGcTrend(): void {
    const analysis = this.calculateGcTrend();

    logger.debug(analysis, 'Post-GC trend analysis');

    if (analysis.isMonotonicGrowth) {
      const event: HeapAnomalyEvent = {
        type: 'growth',
        actual: analysis.growthRate,
        timestamp: Date.now(),
        details: analysis,
      };

      logger.warn(event, 'Heap growth anomaly detected');
      this.emit('heapAnomalyDetected', event);

      // Update Prometheus metrics
      const exporter = getPrometheusExporter();
      exporter.incrementHeapAnomalies('growth');
    }
  }

  /**
   * Calculate GC trend analysis
   *
   * @returns Trend analysis result
   */
  private calculateGcTrend(): GcTrendAnalysis {
    const sizes = this.postGcHeapSizes;
    const current = sizes[sizes.length - 1];
    const previous = sizes.slice(0, -1);

    // Check for monotonic growth (each sample is larger than the previous)
    let isMonotonic = true;
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i] <= sizes[i - 1]) {
        isMonotonic = false;
        break;
      }
    }

    // Calculate growth rate (percentage increase from first to last)
    const firstSize = sizes[0];
    const growthRate = ((current - firstSize) / firstSize) * 100;

    return {
      currentHeapSize: current,
      previousHeapSizes: previous,
      isMonotonicGrowth: isMonotonic,
      growthRate,
      windowsAnalyzed: sizes.length,
    };
  }

  /**
   * Sample heap statistics and check thresholds
   */
  private sampleHeapStats(): void {
    const heapStats = this.getCurrentHeapStats();
    this.lastHeapStats = heapStats;

    // Check heap size limit percentage
    if (heapStats.usedPercentage > this.config.heapLimitPercentage) {
      const event: HeapAnomalyEvent = {
        type: 'limit',
        threshold: this.config.heapLimitPercentage,
        actual: heapStats.usedPercentage,
        timestamp: Date.now(),
      };

      logger.error(event, 'Heap size limit breach');
      this.emit('heapAnomalyDetected', event);

      // Update Prometheus metrics
      const exporter = getPrometheusExporter();
      exporter.incrementHeapAnomalies('limit');
    }
  }

  /**
   * Get current heap statistics
   *
   * @returns Heap statistics
   */
  private getCurrentHeapStats(): HeapStats {
    const v8Stats = v8.getHeapStatistics();
    const memUsage = process.memoryUsage();

    const usedHeapSize = v8Stats.used_heap_size;
    const heapSizeLimit = v8Stats.heap_size_limit;
    const usedPercentage = (usedHeapSize / heapSizeLimit) * 100;

    return {
      usedHeapSize,
      totalHeapSize: v8Stats.total_heap_size,
      heapSizeLimit,
      usedPercentage,
      timestamp: Date.now(),
    };
  }

  /**
   * Get current heap statistics
   *
   * @returns Current heap statistics
   */
  getStats(): HeapStats | null {
    return this.lastHeapStats;
  }

  /**
   * Get post-GC trend analysis
   *
   * @returns Trend analysis or null if insufficient data
   */
  getGcTrend(): GcTrendAnalysis | null {
    if (this.postGcHeapSizes.length < 2) {
      return null;
    }
    return this.calculateGcTrend();
  }

  /**
   * Check if monitor is running
   *
   * @returns true if running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Create heap monitor from Guardian config
 *
 * @param config - Guardian configuration
 * @returns HeapMonitor instance
 */
export function createHeapMonitor(config: GuardianConfig): HeapMonitor {
  return new HeapMonitor(config.heap);
}
