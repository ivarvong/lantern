// A parse result. Callers branch on `ok` and never read a value that failed.

export type Fail = { readonly path: string; readonly message: string };

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly Fail[] };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (path: string, message: string): Result<never> => ({ ok: false, errors: [{ path, message }] });

/** Run several parses and keep every failure. */
export class Acc {
  private readonly errors: Fail[] = [];

  add<T>(result: Result<T>, use: (value: T) => void): void {
    if (result.ok) use(result.value);
    else this.errors.push(...result.errors);
  }

  done<T>(value: T): Result<T> {
    return this.errors.length ? { ok: false, errors: this.errors } : ok(value);
  }
}
