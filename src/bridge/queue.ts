import { toolError } from "../errors.ts";

/**
 * FIFO queue serializing all bridge calls (the Etch API is stateful —
 * selection, component edit mode, buffered saves). One call at a time,
 * each with a hard timeout. A timed-out call rejects with E_TIMEOUT but
 * does not block subsequent calls.
 */
export class CallQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly timeoutMs: number) {}

  run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const task = this.tail.then(
      () => this.withTimeout(label, fn),
      () => this.withTimeout(label, fn),
    );
    // The queue advances regardless of this call's outcome.
    this.tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(toolError("E_TIMEOUT", `'${label}' did not complete within ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      fn().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
