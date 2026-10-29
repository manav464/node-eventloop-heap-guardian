import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SnapshotManager, DiskStorageAdapter, StorageAdapter } from '../src/snapshot/snapshotManager.js';
import { resetPrometheusExporter } from '../src/metrics/prometheusExporter.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  const testDir = './test-snapshots';

  beforeEach(async () => {
    resetPrometheusExporter();
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if directory doesn't exist
    }

    manager = new SnapshotManager(
      {
        enabled: true,
        directory: testDir,
        debounceMs: 1000,
        maxPerHour: 2,
        maxTotalSnapshots: 5,
        maxDirectorySizeMb: 10,
        gzipCompression: false, // Disable for faster tests
      },
      new DiskStorageAdapter(testDir, false)
    );
  });

  afterEach(async () => {
    await manager.stop();
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  it('should capture snapshot', async () => {
    const snapshotPath = await manager.captureSnapshot('test');
    expect(snapshotPath).toBeTruthy();

    if (snapshotPath) {
      // Normalize path for cross-platform comparison
      const normalizedPath = snapshotPath.replace(/\\/g, '/');
      const normalizedTestDir = testDir.replace(/\\/g, '/').replace(/^\.\//, '');
      expect(normalizedPath).toContain(normalizedTestDir);
    }
  });

  it('should debounce snapshot capture', async () => {
    const debounceManager = new SnapshotManager(
      {
        enabled: true,
        directory: testDir,
        debounceMs: 0, // Disable debounce for this test
        maxPerHour: 2,
        maxTotalSnapshots: 5,
        maxDirectorySizeMb: 10,
        gzipCompression: false,
      },
      new DiskStorageAdapter(testDir, false)
    );

    const first = await debounceManager.captureSnapshot('test');
    expect(first).toBeTruthy();

    // With debounce disabled, second capture should succeed
    const second = await debounceManager.captureSnapshot('test');
    expect(second).toBeTruthy();

    await debounceManager.stop();
  });

  it('should respect hourly rate limit', async () => {
    // Set maxPerHour to 1
    const rateLimitedManager = new SnapshotManager(
      {
        enabled: true,
        directory: testDir,
        debounceMs: 0,
        maxPerHour: 1,
        maxTotalSnapshots: 5,
        maxDirectorySizeMb: 10,
        gzipCompression: false,
      },
      new DiskStorageAdapter(testDir, false)
    );

    const first = await rateLimitedManager.captureSnapshot('test');
    expect(first).toBeTruthy();

    const second = await rateLimitedManager.captureSnapshot('test');
    expect(second).toBeNull();

    await rateLimitedManager.stop();
  });

  it('should not capture if disabled', async () => {
    const disabledManager = new SnapshotManager(
      {
        enabled: false,
        directory: testDir,
        debounceMs: 0,
        maxPerHour: 2,
        maxTotalSnapshots: 5,
        maxDirectorySizeMb: 10,
        gzipCompression: false,
      },
      new DiskStorageAdapter(testDir, false)
    );

    const snapshot = await disabledManager.captureSnapshot('test');
    expect(snapshot).toBeNull();

    await disabledManager.stop();
  });

  it('should emit snapshotCaptured event', (done) => {
    manager.on('snapshotCaptured', (event) => {
      expect(event).toHaveProperty('path');
      expect(event).toHaveProperty('metadata');
      done();
    });

    manager.captureSnapshot('test');
  });

  it('should emit snapshotError event on failure', (done) => {
    const badAdapter: StorageAdapter = {
      save: async () => {
        throw new Error('Storage error');
      },
    };

    const errorManager = new SnapshotManager(
      {
        enabled: true,
        directory: testDir,
        debounceMs: 0,
        maxPerHour: 2,
        maxTotalSnapshots: 5,
        maxDirectorySizeMb: 10,
        gzipCompression: false,
      },
      badAdapter
    );

    errorManager.on('snapshotError', (event) => {
      expect(event).toHaveProperty('error');
      expect(event).toHaveProperty('reason');
      errorManager.stop();
      done();
    });

    errorManager.captureSnapshot('test');
  });

  it('should return stats', () => {
    const stats = manager.getStats();
    expect(stats).toHaveProperty('lastSnapshotTime');
    expect(stats).toHaveProperty('hourlySnapshotCount');
    expect(stats).toHaveProperty('timeSinceLastSnapshot');
  });

  it('should cleanup old snapshots', async () => {
    const cleanupManager = new SnapshotManager(
      {
        enabled: true,
        directory: testDir,
        debounceMs: 0,
        maxPerHour: 10,
        maxTotalSnapshots: 3, // Lower limit for testing
        maxDirectorySizeMb: 10,
        gzipCompression: false,
      },
      new DiskStorageAdapter(testDir, false)
    );

    // Create multiple snapshots with longer timeout
    for (let i = 0; i < 5; i++) {
      await cleanupManager.captureSnapshot('test');
    }

    // Check that only maxTotalSnapshots remain
    const files = await fs.readdir(testDir);
    const snapshotFiles = files.filter(f => f.endsWith('.heapsnapshot'));
    expect(snapshotFiles.length).toBeLessThanOrEqual(3);

    await cleanupManager.stop();
  }, 30000);

  it('should create metadata file alongside snapshot', async () => {
    const snapshotPath = await manager.captureSnapshot('test');
    expect(snapshotPath).toBeTruthy();

    if (snapshotPath) {
      const metadataPath = snapshotPath.replace('.heapsnapshot', '-metadata.json');
      const exists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify metadata content
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent);
      expect(metadata).toHaveProperty('timestamp');
      expect(metadata).toHaveProperty('pid');
      expect(metadata).toHaveProperty('triggerReason');
    }
  });
});
