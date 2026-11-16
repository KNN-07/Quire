import { describe, expect, test } from "bun:test";
import { isolatePythonWorker } from "../../../apps/web/src/features/editor/tools/python-isolation";

describe("browser Python worker isolation", () => {
  test("removes network and shared-storage capabilities from the scope and its prototypes", () => {
    // Given a worker-like scope whose capabilities live on the instance and on prototypes.
    const base = { fetch: () => "base", WebSocket: () => "socket", postMessage: () => "kept" };
    const scope: Record<string, unknown> = Object.create(base);
    scope["fetch"] = () => "own";
    scope["indexedDB"] = {};
    const navigatorBase = Object.defineProperty({}, "serviceWorker", { get: () => ({}), configurable: true });
    const navigator = Object.create(navigatorBase);
    // When the lockdown runs.
    isolatePythonWorker(scope, navigator);
    // Then every listed capability is gone and cannot be restored, while messaging remains.
    expect(scope["fetch"]).toBeUndefined();
    expect(scope["WebSocket"]).toBeUndefined();
    expect(scope["indexedDB"]).toBeUndefined();
    expect(navigator.serviceWorker).toBeUndefined();
    expect(Reflect.defineProperty(scope, "fetch", { value: () => "restored" })).toBe(false);
    expect(Reflect.get(scope, "postMessage")).toBe(base.postMessage);
  });
  test("fails closed when a capability cannot be removed", () => {
    // Given a scope with a locked network capability.
    const scope = Object.defineProperty({}, "fetch", { value: () => "locked", configurable: false });
    // Then the lockdown refuses to continue instead of running the script.
    expect(() => isolatePythonWorker(scope, undefined)).toThrow("could not remove fetch");
  });
});
