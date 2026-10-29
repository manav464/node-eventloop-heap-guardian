# Node EventLoop Heap Guardian

A lightweight, enterprise-grade in-process diagnostic agent for detecting memory leaks, heap growth anomalies, and event-loop lag in Node.js microservices. Automatically captures V8 heap snapshots and event-loop delay metrics when threshold anomalies are breached.

## Features

- **Event-Loop Monitoring**: Tracks p50, p90, p95, p99, and max event-loop lag using `perf_hooks.monitorEventLoopDelay`
- **Heap Memory Anomaly Detection**: GC-aware monitoring with post-GC trend analysis to detect memory leaks
- **Automated Snapshot Capture**: Automatically generates V8 heap snapshots when anomalies are detected
- **Pluggable Storage**: Extensible storage adapter interface (includes local disk adapter, supports custom backends)
- **Prometheus Metrics**: Exposes standard Prometheus metrics for observability
- **Non-Intrusive**: Single-line initialization, minimal performance overhead
- **Gzip Compression**: Optional compression to reduce snapshot file sizes
- **Debouncing & Rate-Limiting**: Prevents snapshot cascades and disk exhaustion

## Installation

```bash
npm install node-eventloop-heap-guardian
```

## Quick Start

```typescript
import { initGuardian } from 'node-eventloop-heap-guardian';

// Initialize with default configuration
const guardian = initGuardian();

// Or with custom configuration
const guardian = initGuardian({
  eventLoop: {
    p99ThresholdMs: 100,      // Trigger if p99 lag > 100ms
    consecutiveBreaches: 3,    // For 3 consecutive checks
  },
  heap: {
    heapLimitPercentage: 85,  // Trigger if heap > 85% of limit
    postGcGrowthWindows: 5,   // Detect growth across 5 post-GC windows
  },
  snapshot: {
    directory: './snapshots',
    debounceMs: 15 * 60 * 1000, // 15 minutes between snapshots
    maxPerHour: 2,
    gzipCompression: true,
  },
  logging: {
    level: 'info',
  },
});
```

## Configuration

### Event-Loop Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable event-loop monitoring |
| `resolution` | number | `20` | Resolution in ms for `monitorEventLoopDelay` |
| `p99ThresholdMs` | number | `100` | Threshold for p99 delay in ms |
| `consecutiveBreaches` | number | `3` | Consecutive breaches to trigger anomaly |
| `sampleIntervalMs` | number | `1000` | Interval to check thresholds |

### Heap Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable heap monitoring |
| `heapLimitPercentage` | number | `85` | Heap size limit percentage threshold |
| `postGcGrowthWindows` | number | `5` | Number of post-GC windows to analyze |
| `sampleIntervalMs` | number | `1000` | Interval to sample heap stats |

### Snapshot Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable snapshot capture |
| `directory` | string | `'./snapshots'` | Directory to store snapshots |
| `debounceMs` | number | `900000` | Debounce interval (15 minutes) |
| `maxPerHour` | number | `2` | Max snapshots per hour |
| `maxTotalSnapshots` | number | `10` | Max total snapshots to keep |
| `maxDirectorySizeMb` | number | `500` | Max directory size in MB |
| `gzipCompression` | boolean | `true` | Enable gzip compression |

### Monitor Flags

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `monitors.eventLoop` | boolean | `true` | Enable event-loop monitor |
| `monitors.heap` | boolean | `true` | Enable heap monitor |

### Logging Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logging.level` | string | `'info'` | Log level (fatal, error, warn, info, debug, trace) |

## Prometheus Metrics

The agent exposes the following Prometheus metrics:

- `nodejs_eventloop_lag_seconds` (Histogram): Event-loop delay in seconds with percentile buckets (p50, p90, p95, p99, max)
- `nodejs_heap_memory_anomalies_total` (Counter): Total number of heap memory anomalies detected, labeled by type (growth, limit, gc)
- `nodejs_heap_snapshots_captured_total` (Counter): Total number of heap snapshots captured
- `nodejs_active_handles_total` (Gauge): Number of active handles by type (Socket, Server, Timeout, etc.)
- `nodejs_active_requests_total` (Gauge): Number of active requests

### Express Integration

```typescript
import express from 'express';
import { initGuardian } from 'node-eventloop-heap-guardian';

const app = express();
const guardian = initGuardian();

// Expose metrics endpoint
app.get('/metrics', guardian.getMetricsExporter().createMetricsMiddleware());
```

## Custom Storage Adapter

You can implement a custom storage adapter for cloud backends (S3, GCS, etc.):

```typescript
import { StorageAdapter, SnapshotMetadata } from 'node-eventloop-heap-guardian';

class S3StorageAdapter implements StorageAdapter {
  async save(snapshotData: Buffer | string, metadata: SnapshotMetadata, timestamp: number): Promise<string> {
    // Upload to S3
    const key = `snapshots/heap-${timestamp}.heapsnapshot`;
    await s3Client.putObject({
      Bucket: 'my-bucket',
      Key: key,
      Body: snapshotData,
    }).promise();
    return key;
  }
}

// Use custom adapter
const guardian = initGuardian({}, new S3StorageAdapter());
```

## API Reference

### `initGuardian(config?, storageAdapter?)`

Initialize Guardian with optional configuration and storage adapter.

**Parameters:**
- `config` (Partial<GuardianConfig>, optional): Configuration object
- `storageAdapter` (StorageAdapter, optional): Custom storage adapter

**Returns:** Guardian instance

### `guardian.start()`

Start all monitors.

### `guardian.stop()`

Stop all monitors and cleanup resources.

### `guardian.getMetricsExporter()`

Get the Prometheus metrics exporter instance.

**Returns:** PrometheusExporter

### `guardian.getConfig()`

Get current configuration.

**Returns:** GuardianConfig

### `guardian.triggerSnapshot(reason?, details?)`

Manually trigger a snapshot.

**Parameters:**
- `reason` (string, optional): Reason for snapshot (default: 'manual')
- `details` (any, optional): Additional details

**Returns:** Promise<string | null> - Path to saved snapshot or null

### `guardian.getStats()`

Get current statistics from all monitors.

**Returns:** Combined statistics object

### `guardian.isActive()`

Check if Guardian is running.

**Returns:** boolean

## Events

Guardian emits the following events:

- `eventLoopLagBreach`: Emitted when event-loop lag threshold is breached
- `heapAnomalyDetected`: Emitted when heap anomaly is detected
- `snapshotCaptured`: Emitted when snapshot is successfully captured
- `snapshotError`: Emitted when snapshot capture fails

```typescript
guardian.on('eventLoopLagBreach', (event) => {
  console.log('Event-loop lag breach:', event);
});

guardian.on('heapAnomalyDetected', (event) => {
  console.log('Heap anomaly:', event);
});

guardian.on('snapshotCaptured', (event) => {
  console.log('Snapshot captured:', event.path);
});
```

## Example Application

A complete example server is provided in `examples/leakyServer.ts`:

```bash
npm run build
node dist/examples/leakyServer.js
```

The example server includes:

- `GET /leak` - Simulate memory leak by adding data to global array
- `GET /block` - Block event loop with synchronous CPU task
- `GET /metrics` - Prometheus metrics endpoint
- `GET /stats` - Current Guardian statistics
- `GET /snapshot` - Manually trigger snapshot

## Performance Considerations

- **Worker Threads**: Snapshot generation is offloaded to worker threads to prevent main thread blocking
- **Debouncing**: Prevents snapshot cascades (default: 15 minutes)
- **Sampling Intervals**: Balance between detection sensitivity and overhead (default: 1000ms for heap, 20ms resolution for event-loop)
- **Sliding Window**: Memory-efficient trend analysis without storing full history
- **Gzip Compression**: Reduces disk usage and network transfer size

## Troubleshooting

### Snapshots not being generated

- Check that snapshot capture is enabled in configuration
- Verify the snapshot directory is writable
- Check logs for error messages
- Ensure debounce interval has elapsed since last snapshot

### High memory usage

- Reduce `postGcGrowthWindows` to decrease trend analysis memory
- Disable gzip compression if memory is constrained
- Increase debounce interval to reduce snapshot frequency

### Event-loop monitoring not working

- Ensure `monitors.eventLoop` is set to `true`
- Check that Node.js version supports `perf_hooks.monitorEventLoopDelay` (Node.js 14+)
- Verify `resolution` is appropriate for your workload

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
