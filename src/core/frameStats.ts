/**
 * Rolling frame-time statistics, for MEASURING browser performance on the
 * machine in front of you. These numbers say nothing about other hardware.
 */

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sortedAsc[lo]!;
  const b = sortedAsc[hi]!;
  return a + (b - a) * (rank - lo);
}

export interface FrameSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export class FrameStats {
  private readonly buf: number[] = [];
  private head = 0;

  constructor(private readonly capacity = 240) {}

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.buf.length < this.capacity) this.buf.push(ms);
    else {
      this.buf[this.head] = ms;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  clear(): void {
    this.buf.length = 0;
    this.head = 0;
  }

  summary(): FrameSummary | null {
    if (this.buf.length === 0) return null;
    const sorted = [...this.buf].sort((x, y) => x - y);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
      count: sorted.length,
      mean: sum / sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1]!,
    };
  }
}
