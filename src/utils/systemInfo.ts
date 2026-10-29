import { logger } from './logger.js';

/**
 * Active handle summary by type
 */
export interface HandleSummary {
  [type: string]: number;
}

/**
 * System telemetry payload for snapshot metadata
 */
export interface SystemTelemetry {
  activeHandles: HandleSummary;
  activeHandlesTotal: number;
  activeRequestsTotal: number;
  timestamp: number;
  pid: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

/**
 * Safely extract active handles using guarded process._getActiveHandles()
 * Summarizes active resources by type (Socket, Server, Timeout, TCPWrap, etc.)
 *
 * @returns Summary of active handles by type
 */
export function getActiveHandlesSummary(): HandleSummary {
  const summary: HandleSummary = {};

  try {
    // @ts-ignore - _getActiveHandles is internal but widely used for diagnostics
    const handles = process._getActiveHandles?.() || [];

    for (const handle of handles) {
      const type = handle.constructor?.name || 'Unknown';
      summary[type] = (summary[type] || 0) + 1;
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to extract active handles');
  }

  return summary;
}

/**
 * Safely extract active requests count
 *
 * @returns Number of active requests
 */
export function getActiveRequestsCount(): number {
  try {
    // @ts-ignore - _getActiveRequests is internal but widely used for diagnostics
    return process._getActiveRequests?.()?.length || 0;
  } catch (error) {
    logger.warn({ error }, 'Failed to extract active requests');
    return 0;
  }
}

/**
 * Collect comprehensive system telemetry for snapshot metadata
 * Includes handle counts, memory usage, and process info
 *
 * @returns System telemetry object
 */
export function collectSystemTelemetry(): SystemTelemetry {
  return {
    activeHandles: getActiveHandlesSummary(),
    activeHandlesTotal: Object.values(getActiveHandlesSummary()).reduce((sum, count) => sum + count, 0),
    activeRequestsTotal: getActiveRequestsCount(),
    timestamp: Date.now(),
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  };
}
