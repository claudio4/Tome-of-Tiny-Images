import type { WorkerRequest, WorkerResponse, WorkerResult } from '../workers/protocol';

interface Job {
  id: number;
  req: WorkerRequest;
  transfer: Transferable[];
  /** Megapixels; bounds how many large images are in memory at once. */
  cost: number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** Jobs above this size get a fresh worker afterwards: wasm memory never shrinks. */
const RETIRE_AFTER_MP = 16;

/**
 * Runs codec jobs on a fixed set of workers, one job per worker at a time,
 * keeping the summed size of running jobs under a megapixel budget. A job
 * larger than the whole budget runs alone.
 */
export class CodecPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private nextId = 1;
  private created = 0;
  private activeCost = 0;

  constructor(
    private readonly size = defaultPoolSize(),
    private readonly budgetMp = defaultBudgetMp(),
  ) {}

  run<R extends WorkerRequest>(req: R, transfer: Transferable[] = [], cost = 0): Promise<WorkerResult<R>> {
    return this.enqueue(req, transfer, cost, false);
  }

  /** Runs `req` ahead of everything queued (used for interactive previews). */
  runNext<R extends WorkerRequest>(req: R, transfer: Transferable[] = [], cost = 0): Promise<WorkerResult<R>> {
    return this.enqueue(req, transfer, cost, true);
  }

  private enqueue<R extends WorkerRequest>(req: R, transfer: Transferable[], cost: number, first: boolean) {
    return new Promise<WorkerResult<R>>((resolve, reject) => {
      const job = { id: this.nextId++, req, transfer, cost, resolve: resolve as (v: unknown) => void, reject };
      if (first) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    while (this.queue.length) {
      const i = this.queue.findIndex((j) => this.busy.size === 0 || this.activeCost + j.cost <= this.budgetMp);
      if (i < 0) return;
      const worker = this.idle.pop() ?? this.spawn();
      if (!worker) return;
      const job = this.queue.splice(i, 1)[0];
      this.busy.set(worker, job);
      this.activeCost += job.cost;
      worker.postMessage({ id: job.id, req: job.req }, job.transfer);
    }
  }

  private spawn(): Worker | undefined {
    if (this.created >= this.size) return undefined;
    this.created++;
    const worker = new Worker(new URL('../workers/codec.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.finish(worker, e.data);
    worker.onerror = (e) => {
      // A crashed worker (e.g. wasm out of memory) is replaced by a fresh one.
      e.preventDefault();
      const job = this.release(worker, true);
      job?.reject(new Error(e.message || 'Worker crashed'));
      this.pump();
    };
    return worker;
  }

  private release(worker: Worker, retire: boolean): Job | undefined {
    const job = this.busy.get(worker);
    this.busy.delete(worker);
    this.activeCost -= job?.cost ?? 0;
    if (retire) {
      worker.terminate();
      this.created--;
    } else {
      this.idle.push(worker);
    }
    return job;
  }

  private finish(worker: Worker, res: WorkerResponse) {
    const job = this.release(worker, (this.busy.get(worker)?.cost ?? 0) > RETIRE_AFTER_MP);
    if (job) {
      if (res.ok) job.resolve(res.result);
      else job.reject(new Error(res.error));
    }
    this.pump();
  }
}

function defaultPoolSize(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(6, cores - 1));
}

function defaultBudgetMp(): number {
  // Roughly 100 bytes per pixel while encoding. deviceMemory is Chromium-only
  // and capped at 8 (GB); assume a mid-range machine elsewhere.
  const gb = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  return gb >= 8 ? 48 : gb >= 4 ? 24 : 12;
}
