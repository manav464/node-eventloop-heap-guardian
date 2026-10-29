import { monitorEventLoopDelay } from 'node:perf_hooks';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { getPrometheusExporter } from '../metrics/prometheusExporter.js';
import type { GuardianConfig } from '../config.js';

/**
 * Event-loop delay statistics
 */
export interface EventLoopStats {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/**
 * Event-loop breach event payload
 */
export interface EventLoopBreachEvent {
  threshold: number;
  actual: number;
  consecutiveBreaches: number;
  timestamp: number;
}

/**
 * Event-loop monitor configuration
 */
export interface EventLoopMonitorConfig {
  enabled: boolean;
  resolution: number;
  p99ThresholdMs: number;
  consecutiveBreaches: number;
  sampleIntervalMs: number;
}

/**
 * Event-loop monitor using perf_hooks.monitorEventLoopDelay
 * Tracks p50, p90, p95, p99, and max delay statistics
 * Emits events when p99 threshold is breached consecutively
 */
export class EventLoopMonitor extends EventEmitter {
  private config: EventLoopMonitorConfig;
  private histogram: ReturnType<typeof monitorEventLoopDelay>;
  private sampleInterval: NodeJS.Timeout | null = null;
  private consecutiveBreachCount = 0;
  private isRunning = false;

  constructor(config: EventLoopMonitorConfig) {
    super();
    this.config = config;
    this.histogram = monitorEventLoopDelay({ resolution: config.resolution });
    this.histogram.enable();
  }

  /**
   * Start monitoring event-loop delay
   */
  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    logger.info({
      resolution: this.config.resolution,
      p99Threshold: this.config.p99ThresholdMs,
      consecutiveBreaches: this.config.consecutiveBreaches,
    }, 'Starting event-loop monitor');

    // Sample histogram at configured interval
    this.sampleInterval = setInterval(() => {
      this.sampleAndCheck();
    }, this.config.sampleIntervalMs);
  }

  /**
   * Stop monitoring event-loop delay
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping event-loop monitor');

    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }

    this.histogram.disable();
  }

  /**
   * Sample histogram and check for threshold breaches
   */
  private sampleAndCheck(): void {
    const stats = this.calculateStats();

    // Update Prometheus metrics
    const exporter = getPrometheusExporter();
    exporter.updateEventLoopLag(
      stats.p50 / 1000, // Convert to seconds
      stats.p90 / 1000,
      stats.p95 / 1000,
      stats.p99 / 1000,
      stats.max / 1000
    );

    // Check if p99 exceeds threshold
    if (stats.p99 > this.config.p99ThresholdMs) {
      this.consecutiveBreachCount++;
      logger.warn({
        p99: stats.p99,
        threshold: this.config.p99ThresholdMs,
        consecutiveBreaches: this.consecutiveBreachCount,
      }, 'Event-loop lag breach detected');

      // Emit event if consecutive breaches threshold reached
      if (this.consecutiveBreachCount >= this.config.consecutiveBreaches) {
        const event: EventLoopBreachEvent = {
          threshold: this.config.p99ThresholdMs,
          actual: stats.p99,
          consecutiveBreaches: this.consecutiveBreachCount,
          timestamp: Date.now(),
        };

        logger.error(event, 'Event-loop lag anomaly detected');
        this.emit('eventLoopLagBreach', event);

        // Reset counter after emitting
        this.consecutiveBreachCount = 0;
      }
    } else {
      // Reset counter if below threshold
      if (this.consecutiveBreachCount > 0) {
        this.consecutiveBreachCount = 0;
      }
    }
  }

  /**
   * Calculate percentile statistics from histogram
   *
   * @returns Event-loop delay statistics
   */
  private calculateStats(): EventLoopStats {
    // Get all delay values from histogram
    const delays: number[] = [];
    const entries = this.histogram;

    // Calculate percentiles manually
    // The histogram stores min, max, mean, and standard deviation
    // We'll use a simplified approach based on available data
    const min = entries.min;
    const max = entries.max;
    const mean = entries.mean;
    const stddev = entries.stddev;

    // Estimate percentiles using normal distribution approximation
    // This is a simplified approach - for production, consider storing actual samples
    const p50 = mean;
    const p90 = mean + (1.28 * stddev);
    const p95 = mean + (1.645 * stddev);
    const p99 = mean + (2.33 * stddev);

    return {
      p50: Math.max(0, p50),
      p90: Math.max(0, p90),
      p95: Math.max(0, p95),
      p99: Math.max(0, p99),
      max: Math.max(0, max),
      mean: Math.max(0, mean),
    };
  }

  /**
   * Get current event-loop statistics
   *
   * @returns Current statistics
   */
  getStats(): EventLoopStats {
    return this.calculateStats();
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
 * Create event-loop monitor from Guardian config
 *
 * @param config - Guardian configuration
 * @returns EventLoopMonitor instance
 */
export function createEventLoopMonitor(config: GuardianConfig): EventLoopMonitor {
  return new EventLoopMonitor(config.eventLoop);
}
