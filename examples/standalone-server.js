import express from 'express';
import { Guardian } from '../dist/index.js';
// Create Guardian instance
const guardian = new Guardian({
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
        level: 'info',
    },
});
// Start Guardian
guardian.start();
const app = express();
const PORT = 3000;
// Global array to simulate memory leak
const leakyArray = [];
/**
 * GET /leak - Simulate memory leak
 */
app.get('/leak', (req, res) => {
    console.log('[/leak] Adding 100MB of data to leaky array');
    for (let i = 0; i < 100; i++) {
        const largeObject = new Array(1024 * 256).fill('x'.repeat(4));
        leakyArray.push(largeObject);
    }
    res.json({
        message: 'Added 100MB to leaky array',
        arraySize: leakyArray.length,
    });
});
/**
 * GET /block - Block event loop
 */
app.get('/block', (req, res) => {
    console.log('[/block] Blocking event loop for 200ms');
    const start = Date.now();
    const duration = 200;
    while (Date.now() - start < duration) {
        Math.sqrt(Math.random() * 10000);
    }
    res.json({
        message: 'Event loop blocked for 200ms',
        actualDuration: Date.now() - start,
    });
});
/**
 * GET /metrics - Prometheus metrics
 */
app.get('/metrics', guardian.getMetricsExporter().createMetricsMiddleware());
/**
 * GET /stats - Guardian statistics
 */
app.get('/stats', (req, res) => {
    res.json(guardian.getStats());
});
/**
 * GET /snapshot - Manual snapshot
 */
app.get('/snapshot', async (req, res) => {
    const snapshotPath = await guardian.triggerSnapshot('manual', { triggeredBy: 'api' });
    res.json({
        message: 'Snapshot triggered',
        path: snapshotPath,
    });
});
/**
 * GET / - Server info
 */
app.get('/', (req, res) => {
    res.json({
        message: 'Node EventLoop Heap Guardian Demo Server',
        endpoints: {
            '/': 'Server info',
            '/health': 'Health check',
            '/leak': 'Simulate memory leak',
            '/block': 'Block event loop',
            '/metrics': 'Prometheus metrics',
            '/stats': 'Guardian statistics',
            '/snapshot': 'Manual snapshot',
        },
        guardianActive: guardian.isActive(),
    });
});
/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
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
//# sourceMappingURL=standalone-server.js.map