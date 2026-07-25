export interface StageProgressPayload {
  phase: "starting" | "running" | "done";
  source: string;
  quarter?: string;
  done?: number;
  total?: number;
  percentage?: number;
  currentItem?: string;
  stats?: Record<string, number>;
  elapsedSeconds?: number;
  etaSeconds?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface StageProgressTracker {
  path: string;
  start(total: number): Promise<void>;
  update(delta: {
    done: number;
    total?: number;
    currentItem?: string;
    stats?: Record<string, number>;
  }): void;
  done(final: { stats?: Record<string, number> }): Promise<void>;
}

export function stageProgressPathForSnapshot(snapshotPath: string): string {
  return snapshotPath.endsWith(".json")
    ? `${snapshotPath.slice(0, -".json".length)}.progress.json`
    : `${snapshotPath}.progress.json`;
}

export async function writeStageProgress(
  path: string,
  payload: StageProgressPayload,
): Promise<void> {
  try {
    await Deno.writeTextFile(
      path,
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  } catch {
    // Progress is best-effort and must never fail the ingest run.
  }
}

export function createStageProgressTracker(config: {
  path: string;
  source: string;
  quarter?: string;
}): StageProgressTracker {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let totalCached = 0;

  return {
    path: config.path,

    async start(total) {
      totalCached = total;
      await writeStageProgress(config.path, {
        phase: "starting",
        source: config.source,
        quarter: config.quarter,
        total,
        startedAt: startedAtIso,
      });
    },

    update(delta) {
      const total = delta.total ?? totalCached;
      const elapsedMs = Date.now() - startedAt;
      const rate = delta.done > 0 ? elapsedMs / delta.done : 0;
      const etaMs = rate * Math.max(total - delta.done, 0);
      const percentage = total > 0
        ? Math.round((delta.done / total) * 1000) / 10
        : 0;

      void writeStageProgress(config.path, {
        phase: "running",
        source: config.source,
        quarter: config.quarter,
        done: delta.done,
        total,
        percentage,
        currentItem: delta.currentItem,
        stats: delta.stats,
        elapsedSeconds: Math.round(elapsedMs / 1000),
        etaSeconds: Math.round(etaMs / 1000),
        startedAt: startedAtIso,
      });
    },

    async done(final) {
      await writeStageProgress(config.path, {
        phase: "done",
        source: config.source,
        quarter: config.quarter,
        done: totalCached,
        total: totalCached,
        percentage: 100,
        stats: final.stats,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        startedAt: startedAtIso,
        finishedAt: new Date().toISOString(),
      });
    },
  };
}
