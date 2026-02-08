/**
 * Serialized compile-scene client: at most one request in flight.
 * If a compile is requested while one is running, we store the latest params
 * (latest wins) and run exactly one more compile after the current one finishes.
 * All callers that requested during in-flight get a promise that resolves when
 * that single next compile completes.
 */

export type CompileSceneBody = {
  files?: Record<string, string>;
  includeDiagnostics?: boolean;
};

type Waiter = { resolve: (res: Response) => void; reject: (err: unknown) => void };

let inFlight: Promise<Response> | null = null;
let pendingParams: { body: CompileSceneBody; authHeaders: HeadersInit } | null = null;
let waiters: Waiter[] = [];

async function runOne(
  body: CompileSceneBody,
  authHeaders: HeadersInit
): Promise<Response> {
  const res = await fetch("/api/compile-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  return res;
}

function drainPending(): void {
  if (!pendingParams || waiters.length === 0) return;
  const params = pendingParams;
  const w = waiters;
  pendingParams = null;
  waiters = [];
  inFlight = runOne(params.body, params.authHeaders);
  inFlight
    .then((res) => {
      w.forEach((waiter) => waiter.resolve(res));
    })
    .catch((err) => {
      w.forEach((waiter) => waiter.reject(err));
    })
    .finally(() => {
      inFlight = null;
      drainPending();
    });
}

/**
 * Request a scene compile. If no compile is in flight, runs immediately.
 * If one is in flight, this request's params become the pending one (latest wins).
 * The returned promise resolves when the compile for this (or a later) request
 * completes—i.e. when the single next compile after the current one finishes.
 */
export function requestCompileScene(
  body: CompileSceneBody,
  authHeaders: HeadersInit
): Promise<Response> {
  if (inFlight === null) {
    inFlight = runOne(body, authHeaders);
    inFlight.finally(() => {
      inFlight = null;
      drainPending();
    });
    return inFlight;
  }

  pendingParams = { body, authHeaders };
  return new Promise<Response>((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
}
