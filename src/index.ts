import { EventEmitter } from 'events';
import { validateConfig, GuardianConfig } from './config.js';
import { setLogLevel } from './utils/logger.js';
import { collectSystemTelemetry } from './utils/systemInfo.js';
import { getPrometheusExporter, PrometheusExporter } from './metrics/prometheusExporter.js';
import { createEventLoopMonitor, EventLoopMonitor } from './monitors/eventLoopMonitor.js';
import { createHeapMonitor, HeapMonitor } from './monitors/heapMonitor.js';
import { createSnapshotManager, SnapshotManager, StorageAdapter } from './snapshot/snapshotManager.js';

/**
 * Guardian instance - main orchestrator
 */
export class Guardian extends EventEmitter {
  private config: GuardianConfig;
  private eventLoopMonitor: EventLoopMonitor;
  private heapMonitor: HeapMonitor;
  private snapshotManager: SnapshotManager;
  private prometheusExporter: PrometheusExporter;
  private isRunning = false;

  constructor(config: Partial<GuardianConfig> = {}, storageAdapter?: StorageAdapter) {
    super();

    // Validate and merge configuration
    this.config = validateConfig(config);

    // Set log level
    setLogLevel(this.config.logging.level);

    // Initialize components
    this.prometheusExporter = getPrometheusExporter();
    this.eventLoopMonitor = createEventLoopMonitor(this.config);
    this.heapMonitor = createHeapMonitor(this.config);
    this.snapshotManager = createSnapshotManager(this.config, storageAdapter);

    // Wire up event listeners
    this.setupEventListeners();
  }

  /**
   * Set up event listeners between monitors and snapshot manager
   */
  private setupEventListeners(): void {
    // Event-loop lag breach -> capture snapshot
    this.eventLoopMonitor.on('eventLoopLagBreach', (event) => {
      this.emit('eventLoopLagBreach', event);
      this.snapshotManager.captureSnapshot('eventLoopLag', event);
    });

    // Heap anomaly -> capture snapshot
    this.heapMonitor.on('heapAnomalyDetected', (event) => {
      this.emit('heapAnomalyDetected', event);
      this.snapshotManager.captureSnapshot(event.type, event);
    });

    // Snapshot events
    this.snapshotManager.on('snapshotCaptured', (event) => {
      this.emit('snapshotCaptured', event);
    });

    this.snapshotManager.on('snapshotError', (event) => {
      this.emit('snapshotError', event);
    });
  }

  /**
   * Start all monitors
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[Guardian] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Guardian] Starting');

    // Start monitors based on configuration
    if (this.config.monitors.eventLoop) {
      this.eventLoopMonitor.start();
    }

    if (this.config.monitors.heap) {
      this.heapMonitor.start();
    }

    console.log('[Guardian] Started successfully');
  }

  /**
   * Stop all monitors and cleanup resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[Guardian] Stopping');

    this.isRunning = false;

    // Stop monitors
    this.eventLoopMonitor.stop();
    this.heapMonitor.stop();

    // Stop snapshot manager
    await this.snapshotManager.stop();

    console.log('[Guardian] Stopped successfully');
  }

  /**
   * Get Prometheus metrics exporter
   *
   * @returns Prometheus exporter instance
   */
  getMetricsExporter(): PrometheusExporter {
    return this.prometheusExporter;
  }

  /**
   * Get current configuration
   *
   * @returns Guardian configuration
   */
  getConfig(): GuardianConfig {
    return this.config;
  }

  /**
   * Manually trigger a snapshot
   *
   * @param reason - Reason for snapshot
   * @param details - Additional details
   * @returns Path to saved snapshot or null
   */
  async triggerSnapshot(reason: string = 'manual', details?: any): Promise<string | null> {
    return this.snapshotManager.captureSnapshot(reason, details);
  }

  /**
   * Get current statistics from all monitors
   *
   * @returns Combined statistics
   */
  getStats() {
    return {
      eventLoop: this.eventLoopMonitor.getStats(),
      heap: this.heapMonitor.getStats(),
      snapshot: this.snapshotManager.getStats(),
      system: collectSystemTelemetry(),
    };
  }

  /**
   * Check if Guardian is running
   *
   * @returns true if running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Global Guardian instance
 */
let guardianInstance: Guardian | null = null;

/**
 * Initialize Guardian with configuration
 * Creates a singleton instance for easy access
 *
 * @param config - Partial configuration object
 * @param storageAdapter - Optional custom storage adapter
 * @returns Guardian instance
 */
export function initGuardian(config?: Partial<GuardianConfig>, storageAdapter?: StorageAdapter): Guardian {
  if (guardianInstance) {
    console.warn('[Guardian] Already initialized, returning existing instance');
    return guardianInstance;
  }

  guardianInstance = new Guardian(config, storageAdapter);
  guardianInstance.start();

  return guardianInstance;
}

/**
 * Get the Guardian instance
 *
 * @returns Guardian instance or null if not initialized
 */
export function getGuardian(): Guardian | null {
  return guardianInstance;
}

/**
 * Stop and cleanup Guardian instance
 */
export async function stopGuardian(): Promise<void> {
  if (guardianInstance) {
    await guardianInstance.stop();
    guardianInstance = null;
  }
}

// Export types
export type { GuardianConfig } from './config.js';
export type { StorageAdapter, SnapshotMetadata } from './snapshot/snapshotManager.js';
export type { EventLoopStats, EventLoopBreachEvent } from './monitors/eventLoopMonitor.js';
export type { HeapStats, HeapAnomalyEvent } from './monitors/heapMonitor.js';
export type { SystemTelemetry } from './utils/systemInfo.js';
