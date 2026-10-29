import { Registry, Histogram, Counter, Gauge } from 'prom-client';
import { HandleSummary } from '../utils/systemInfo.js';

/**
 * Prometheus metrics registry
 * Can be bound to existing app global registry if provided
 */
export class PrometheusExporter {
  private registry: Registry;
  private eventLoopLagHistogram: Histogram<string>;
  private heapAnomaliesCounter: Counter<string>;
  private heapSnapshotsCounter: Counter<string>;
  private activeHandlesGauge: any;
  private activeRequestsGauge: Gauge<string>;

  constructor(register: Registry = new Registry()) {
    this.registry = register;

    // Event-loop lag histogram with buckets for common delays
    this.eventLoopLagHistogram = new Histogram({
      name: 'nodejs_eventloop_lag_seconds',
      help: 'Event-loop delay in seconds with percentile buckets',
      labelNames: ['percentile'] as const,
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    // Heap anomalies counter
    this.heapAnomaliesCounter = new Counter({
      name: 'nodejs_heap_memory_anomalies_total',
      help: 'Total number of heap memory anomalies detected',
      labelNames: ['type'] as const,
      registers: [this.registry],
    });

    // Heap snapshots captured counter
    this.heapSnapshotsCounter = new Counter({
      name: 'nodejs_heap_snapshots_captured_total',
      help: 'Total number of heap snapshots captured',
      registers: [this.registry],
    });

    // Active handles gauge with type labels
    this.activeHandlesGauge = new Gauge({
      name: 'nodejs_active_handles_total',
      help: 'Number of active handles by type',
      labelNames: ['type'] as any,
      registers: [this.registry],
    });

    // Active requests gauge
    this.activeRequestsGauge = new Gauge({
      name: 'nodejs_active_requests_total',
      help: 'Number of active requests',
      registers: [this.registry],
    });
  }

  /**
   * Update event-loop lag histogram with percentile values
   *
   * @param p50 - 50th percentile delay in seconds
   * @param p90 - 90th percentile delay in seconds
   * @param p95 - 95th percentile delay in seconds
   * @param p99 - 99th percentile delay in seconds
   * @param max - Maximum delay in seconds
   */
  updateEventLoopLag(p50: number, p90: number, p95: number, p99: number, max: number): void {
    this.eventLoopLagHistogram.observe({ percentile: 'p50' }, p50);
    this.eventLoopLagHistogram.observe({ percentile: 'p90' }, p90);
    this.eventLoopLagHistogram.observe({ percentile: 'p95' }, p95);
    this.eventLoopLagHistogram.observe({ percentile: 'p99' }, p99);
    this.eventLoopLagHistogram.observe({ percentile: 'max' }, max);
  }

  /**
   * Increment heap anomalies counter
   *
   * @param type - Type of anomaly (e.g., 'growth', 'limit', 'gc')
   */
  incrementHeapAnomalies(type: string): void {
    this.heapAnomaliesCounter.inc({ type });
  }

  /**
   * Increment heap snapshots captured counter
   */
  incrementHeapSnapshots(): void {
    this.heapSnapshotsCounter.inc();
  }

  /**
   * Update active handles gauge with handle summary
   *
   * @param summary - Handle summary by type
   */
  updateActiveHandles(summary: HandleSummary): void {
    // Reset gauge
    this.activeHandlesGauge.reset();

    // Set values for each handle type
    for (const [type, count] of Object.entries(summary)) {
      this.activeHandlesGauge.set({ type: type as string }, count);
    }
  }

  /**
   * Update active requests gauge
   *
   * @param count - Number of active requests
   */
  updateActiveRequests(count: number): void {
    this.activeRequestsGauge.set(count);
  }

  /**
   * Get the Prometheus registry
   *
   * @returns Registry instance
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get metrics as string for Prometheus scraping
   *
   * @returns Prometheus metrics string
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Create Express middleware for /metrics endpoint
   *
   * @returns Express middleware function
   */
  createMetricsMiddleware() {
    return async (req: any, res: any) => {
      res.set('Content-Type', this.registry.contentType);
      res.end(await this.getMetrics());
    };
  }
}

/**
 * Singleton instance for easy access
 */
let exporterInstance: PrometheusExporter | null = null;

/**
 * Get or create the singleton Prometheus exporter instance
 *
 * @param register - Optional custom registry
 * @returns Prometheus exporter instance
 */
export function getPrometheusExporter(register?: Registry): PrometheusExporter {
  if (!exporterInstance) {
    exporterInstance = new PrometheusExporter(register);
  }
  return exporterInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetPrometheusExporter(): void {
  if (exporterInstance) {
    exporterInstance.getRegistry().clear();
    exporterInstance = null;
  }
}
