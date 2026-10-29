import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'events';
import v8 from 'node:v8';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { logger } from '../utils/logger.js';
import { collectSystemTelemetry } from '../utils/systemInfo.js';
import { getPrometheusExporter } from '../metrics/prometheusExporter.js';
import type { GuardianConfig } from '../config.js';

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  timestamp: number;
  pid: number;
  uptime: number;
  activeHandles: Record<string, number>;
  activeHandlesTotal: number;
  activeRequestsTotal: number;
  memoryUsage: NodeJS.MemoryUsage;
  triggerReason: string;
  triggerDetails?: any;
}

/**
 * Storage adapter interface for pluggable backends
 */
export interface StorageAdapter {
  /**
   * Save snapshot with metadata
   *
   * @param snapshotData - Snapshot data (buffer or string)
   * @param metadata - Snapshot metadata
   * @param timestamp - Snapshot timestamp
   * @returns Path or identifier of saved snapshot
   */
  save(snapshotData: Buffer | string, metadata: SnapshotMetadata, timestamp: number): Promise<string>;
}

/**
 * Disk storage adapter implementation
 */
export class DiskStorageAdapter implements StorageAdapter {
  private directory: string;
  private gzipCompression: boolean;

  constructor(directory: string, gzipCompression: boolean = true) {
    this.directory = directory;
    this.gzipCompression = gzipCompression;
  }

  /**
   * Save snapshot to disk
   *
   * @param snapshotData - Snapshot data
   * @param metadata - Snapshot metadata
   * @param timestamp - Snapshot timestamp
   * @returns Path to saved snapshot
   */
  async save(snapshotData: Buffer | string, metadata: SnapshotMetadata, timestamp: number): Promise<string> {
    const filename = `heap-${timestamp}.heapsnapshot`;
    const snapshotPath = path.join(this.directory, filename);
    const metadataFilename = `heap-${timestamp}-metadata.json`;
    const metadataPath = path.join(this.directory, metadataFilename);

    // Ensure directory exists
    await fs.mkdir(this.directory, { recursive: true });

    // Save snapshot
    await fs.writeFile(snapshotPath, snapshotData);

    // Save metadata
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Compress if enabled
    if (this.gzipCompression) {
      const compressedPath = `${snapshotPath}.gz`;
      // Note: For simplicity, we compress after writing. In production,
      // you might want to stream directly to gzip

      await pipeline(
        createReadStream(snapshotPath),
        createGzip(),
        createWriteStream(compressedPath)
      );

      // Remove uncompressed file
      await fs.unlink(snapshotPath);

      return compressedPath;
    }

    return snapshotPath;
  }
}

/**
 * Snapshot manager configuration
 */
export interface SnapshotManagerConfig {
  enabled: boolean;
  directory: string;
  debounceMs: number;
  maxPerHour: number;
  maxTotalSnapshots: number;
  maxDirectorySizeMb: number;
  gzipCompression: boolean;
}

/**
 * Snapshot manager with debouncing and rate-limiting
 * Coordinates snapshot generation using worker threads
 */
export class SnapshotManager extends EventEmitter {
  private config: SnapshotManagerConfig;
  private storageAdapter: StorageAdapter;
  private lastSnapshotTime = 0;
  private hourlySnapshotCount = 0;
  private hourlyResetInterval: NodeJS.Timeout | null = null;
  private worker: Worker | null = null;

  constructor(config: SnapshotManagerConfig, storageAdapter?: StorageAdapter) {
    super();
    this.config = config;
    this.storageAdapter = storageAdapter || new DiskStorageAdapter(config.directory, config.gzipCompression);

    // Set up hourly counter reset
    this.hourlyResetInterval = setInterval(() => {
      this.hourlySnapshotCount = 0;
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Capture snapshot with trigger reason
   *
   * @param reason - Reason for snapshot (e.g., 'eventLoopLag', 'heapGrowth')
   * @param details - Additional details about the trigger
   * @returns Path to saved snapshot or null if skipped
   */
  async captureSnapshot(reason: string, details?: any): Promise<string | null> {
    if (!this.config.enabled) {
      logger.debug('Snapshot capture disabled, skipping');
      return null;
    }

    const now = Date.now();

    // Check debounce
    if (now - this.lastSnapshotTime < this.config.debounceMs) {
      logger.debug({
        timeSinceLastSnapshot: now - this.lastSnapshotTime,
        debounceMs: this.config.debounceMs,
      }, 'Snapshot skipped due to debounce');
      return null;
    }

    // Check hourly rate limit
    if (this.hourlySnapshotCount >= this.config.maxPerHour) {
      logger.warn({
        count: this.hourlySnapshotCount,
        maxPerHour: this.config.maxPerHour,
      }, 'Snapshot skipped due to hourly rate limit');
      return null;
    }

    try {
      logger.info({ reason, details }, 'Capturing heap snapshot');

      // Collect telemetry
      const telemetry = collectSystemTelemetry();
      const metadata: SnapshotMetadata = {
        ...telemetry,
        triggerReason: reason,
        triggerDetails: details,
      };

      // Generate snapshot using v8.getHeapSnapshot() (stream-based)
      const snapshotData = await this.generateSnapshotStream();

      // Save snapshot using storage adapter
      const snapshotPath = await this.storageAdapter.save(snapshotData, metadata, now);

      // Update counters
      this.lastSnapshotTime = now;
      this.hourlySnapshotCount++;

      // Update Prometheus metrics
      const exporter = getPrometheusExporter();
      exporter.incrementHeapSnapshots();

      logger.info({ snapshotPath }, 'Snapshot captured successfully');

      // Emit event
      this.emit('snapshotCaptured', { path: snapshotPath, metadata });

      // Cleanup old snapshots
      await this.cleanupOldSnapshots();

      return snapshotPath;
    } catch (error) {
      logger.error({ error }, 'Failed to capture snapshot');
      this.emit('snapshotError', { error, reason });
      return null;
    }
  }

  /**
   * Generate heap snapshot using v8.getHeapSnapshot() stream
   *
   * @returns Snapshot data as string
   */
  private async generateSnapshotStream(): Promise<string> {
    return new Promise((resolve, reject) => {
      const snapshotStream = v8.getHeapSnapshot();
      const chunks: Buffer[] = [];

      snapshotStream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      snapshotStream.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      snapshotStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Cleanup old snapshots based on count and size limits
   */
  private async cleanupOldSnapshots(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.directory);
      const snapshotFiles = files
        .filter(f => f.endsWith('.heapsnapshot') || f.endsWith('.heapsnapshot.gz'))
        .map(f => ({
          name: f,
          path: path.join(this.config.directory, f),
        }));

      // Sort by modification time (oldest first)
      const fileStats = await Promise.all(
        snapshotFiles.map(async f => ({
          ...f,
          stats: await fs.stat(f.path),
        }))
      );

      fileStats.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);

      // Check count limit
      if (fileStats.length > this.config.maxTotalSnapshots) {
        const toDelete = fileStats.slice(0, fileStats.length - this.config.maxTotalSnapshots);
        for (const file of toDelete) {
          await fs.unlink(file.path);
          logger.debug({ path: file.path }, 'Deleted old snapshot');
        }
      }

      // Check directory size limit
      const totalSize = fileStats.reduce((sum, f) => sum + f.stats.size, 0);
      const maxSizeBytes = this.config.maxDirectorySizeMb * 1024 * 1024;

      if (totalSize > maxSizeBytes) {
        // Delete oldest files until under limit
        let currentSize = totalSize;
        for (const file of fileStats) {
          if (currentSize <= maxSizeBytes) break;
          await fs.unlink(file.path);
          currentSize -= file.stats.size;
          logger.debug({ path: file.path }, 'Deleted snapshot to reduce directory size');
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to cleanup old snapshots');
    }
  }

  /**
   * Stop snapshot manager and cleanup resources
   */
  async stop(): Promise<void> {
    if (this.hourlyResetInterval) {
      clearInterval(this.hourlyResetInterval);
      this.hourlyResetInterval = null;
    }

    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }

    logger.info('Snapshot manager stopped');
  }

  /**
   * Get current snapshot statistics
   *
   * @returns Snapshot statistics
   */
  getStats() {
    return {
      lastSnapshotTime: this.lastSnapshotTime,
      hourlySnapshotCount: this.hourlySnapshotCount,
      timeSinceLastSnapshot: this.lastSnapshotTime ? Date.now() - this.lastSnapshotTime : null,
    };
  }
}

/**
 * Create snapshot manager from Guardian config
 *
 * @param config - Guardian configuration
 * @param storageAdapter - Optional custom storage adapter
 * @returns SnapshotManager instance
 */
export function createSnapshotManager(config: GuardianConfig, storageAdapter?: StorageAdapter): SnapshotManager {
  return new SnapshotManager(config.snapshot, storageAdapter);
}
