import { parentPort, workerData } from 'node:worker_threads';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

/**
 * Worker thread message handler
 * Receives snapshot data and metadata, compresses with gzip, and saves to disk
 */
parentPort.on('message', async (message) => {
  try {
    const { type, snapshotPath, snapshotData, metadata, metadataPath, gzipCompression } = message;

    if (type === 'snapshot') {
      await handleSnapshot(snapshotPath, snapshotData, metadata, metadataPath, gzipCompression);
      parentPort.postMessage({ type: 'success', snapshotPath });
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
});

/**
 * Handle snapshot saving with optional gzip compression
 *
 * @param snapshotPath - Path to save snapshot file
 * @param snapshotData - Snapshot data (buffer or string)
 * @param metadata - Metadata object
 * @param metadataPath - Path to save metadata file
 * @param gzipCompression - Whether to compress with gzip
 */
async function handleSnapshot(snapshotPath, snapshotData, metadata, metadataPath, gzipCompression) {
  // Ensure directory exists
  const dir = path.dirname(snapshotPath);
  await fs.mkdir(dir, { recursive: true });

  // Save snapshot with optional compression
  if (gzipCompression) {
    const compressedPath = `${snapshotPath}.gz`;
    await saveCompressedSnapshot(snapshotData, compressedPath);
    // Return compressed path
    snapshotPath = compressedPath;
  } else {
    await fs.writeFile(snapshotPath, snapshotData);
  }

  // Save metadata file
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  return snapshotPath;
}

/**
 * Save snapshot with gzip compression
 *
 * @param data - Snapshot data
 * @param outputPath - Output file path
 */
async function saveCompressedSnapshot(data, outputPath) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const gzip = createGzip();
  const writeStream = createWriteStream(outputPath);

  await pipeline(
    async function* () {
      yield buffer;
    },
    gzip,
    writeStream
  );
}
