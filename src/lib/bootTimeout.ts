/**
 * Wraps a promise with a timeout. Rejects with a TimeoutError if not resolved in `ms`.
 */
export class BootTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Boot timeout: "${label}" did not resolve within ${ms}ms`);
    this.name = "BootTimeoutError";
  }
}

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BootTimeoutError(label, ms));
    }, ms);

    Promise.resolve(promise).then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
