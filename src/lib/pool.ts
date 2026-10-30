import type { WorkerRequest, WorkerResponse, WorkerResult } from '../workers/protocol';

interface Job {
  id: number;
  req: WorkerRequest;
  transfer: Transferable[];
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** Runs codec jobs on a fixed set of workers, one job per worker at a time. */
export class CodecPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private nextId = 1;
  private created = 0;

  constructor(private readonly size = defaultPoolSize()) {}

  run<R extends WorkerRequest>(req: R, transfer: Transferable[] = []): Promise<WorkerResult<R>> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, req, transfer, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Runs `req` ahead of everything queued (used for interactive previews). */
  runNext<R extends WorkerRequest>(req: R, transfer: Transferable[] = []): Promise<WorkerResult<R>> {
    return new Promise((resolve, reject) => {
      this.queue.unshift({ id: this.nextId++, req, transfer, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.queue.length) {
      const worker = this.idle.pop() ?? this.spawn();
      if (!worker) return;
      const job = this.queue.shift()!;
      this.busy.set(worker, job);
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
      const job = this.busy.get(worker);
      this.busy.delete(worker);
      worker.terminate();
      this.created--;
      job?.reject(new Error(e.message || 'Worker crashed'));
      this.pump();
    };
    return worker;
  }

  private finish(worker: Worker, res: WorkerResponse) {
    const job = this.busy.get(worker);
    this.busy.delete(worker);
    this.idle.push(worker);
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
