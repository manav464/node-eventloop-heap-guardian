import express from 'express';
import { initGuardian } from '../src/index.js';

// Initialize Guardian with custom configuration
const guardian = initGuardian({
  eventLoop: {
    enabled: true,
    resolution: 20,
    p99ThresholdMs: 100, // Trigger snapshot if p99 lag > 100ms for 3 consecutive checks
    consecutiveBreaches: 3,
    sampleIntervalMs: 1000,
  },
  heap: {
    enabled: true,
    heapLimitPercentage: 85, // Trigger snapshot if heap > 85% of limit
    postGcGrowthWindows: 5, // Detect growth across 5 post-GC windows
    sampleIntervalMs: 1000,
  },
  snapshot: {
    enabled: true,
    directory: './snapshots',
    debounceMs: 15 * 60 * 1000, // 15 minutes between snapshots
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
});

const app = express();
const PORT = 3000;

// Global array to simulate memory leak
const leakyArray: any[] = [];

/**
 * GET /leak - Simulate memory leak by pushing large objects into global array
 * Call this multiple times to trigger heap growth anomaly detection
 */
app.get('/leak', (req: any, res: any) => {
  console.log('[/leak] Adding 100MB of data to leaky array');
  
  // Push large objects to simulate memory leak
  for (let i = 0; i < 100; i++) {
    // Create 1MB object
    const largeObject = new Array(1024 * 256).fill('x'.repeat(4));
    leakyArray.push(largeObject);
  }

  res.json({
    message: 'Added 100MB to leaky array',
    arraySize: leakyArray.length,
    approximateMemoryMB: leakyArray.length,
  });
});

/**
 * GET /block - Simulate event-loop block by running synchronous CPU-heavy loop
 * Call this to trigger event-loop lag anomaly detection
 */
app.get('/block', (req: any, res: any) => {
  console.log('[/block] Blocking event loop for 200ms');
  
  const start = Date.now();
  const duration = 200; // 200ms block
  
  // Synchronous CPU-heavy operation
  while (Date.now() - start < duration) {
    // Busy wait to block event loop
    Math.sqrt(Math.random() * 10000);
  }

  res.json({
    message: 'Event loop blocked for 200ms',
    actualDuration: Date.now() - start,
  });
});

/**
 * GET /metrics - Expose Prometheus metrics
 * Use this endpoint to scrape metrics with Prometheus
 */
app.get('/metrics', guardian.getMetricsExporter().createMetricsMiddleware());

/**
 * GET /stats - Get current Guardian statistics
 */
app.get('/stats', (req: any, res: any) => {
  res.json(guardian.getStats());
});

/**
 * GET /snapshot - Manually trigger a snapshot
 */
app.get('/snapshot', async (req: any, res: any) => {
  const snapshotPath = await guardian.triggerSnapshot('manual', { triggeredBy: 'api' });
  res.json({
    message: 'Snapshot triggered',
    path: snapshotPath,
  });
});

/**
 * GET / - Server info
 */
app.get('/', (req: any, res: any) => {
  res.json({
    message: 'Node EventLoop Heap Guardian Demo Server',
    endpoints: {
      '/': 'Server info',
      '/health': 'Health check endpoint',
      '/leak': 'Simulate memory leak (adds 100MB to global array)',
      '/block': 'Block event loop for 200ms',
      '/metrics': 'Prometheus metrics endpoint',
      '/stats': 'Current Guardian statistics',
      '/snapshot': 'Manual snapshot',
    },
    guardianActive: guardian.isActive(),
  });
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req: any, res: any) => {
  res.json({
    status: 'healthy',
    guardianActive: guardian.isActive(),
    uptime: process.uptime(),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log('[Server] Try these endpoints:');
  console.log(`  - GET http://localhost:${PORT}/          - Server info`);
  console.log(`  - GET http://localhost:${PORT}/health    - Health check`);
  console.log(`  - GET http://localhost:${PORT}/leak      - Simulate memory leak`);
  console.log(`  - GET http://localhost:${PORT}/block     - Block event loop`);
  console.log(`  - GET http://localhost:${PORT}/metrics   - Prometheus metrics`);
  console.log(`  - GET http://localhost:${PORT}/stats     - Guardian statistics`);
  console.log(`  - GET http://localhost:${PORT}/snapshot  - Manual snapshot`);
  console.log('[Server] Snapshots will be saved to ./snapshots/');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...');
  await guardian.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await guardian.stop();
  process.exit(0);
});
