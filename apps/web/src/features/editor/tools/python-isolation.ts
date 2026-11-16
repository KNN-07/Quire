/** Project Python is untrusted relative to the person who runs it: a collaborator
 * may have written the script. The worker shares the application origin, so any
 * network or storage API it can reach would act with the viewer's session.
 * These capabilities are therefore removed after the runtime has loaded and
 * before the script starts. The lockdown fails closed. */
const globalCapabilities = [
  "fetch", "fetchLater", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport",
  "EventSource", "Worker", "SharedWorker", "importScripts", "BroadcastChannel",
  "indexedDB", "caches", "cookieStore", "FontFace", "Notification",
] as const;
const navigatorCapabilities = ["serviceWorker", "sendBeacon", "locks", "storage"] as const;

function deny(owner: object, name: string): void {
  // The same name may be defined on the instance and on several prototypes.
  for (let target: object | null = owner; target; target = Reflect.getPrototypeOf(target)) {
    if (!Object.hasOwn(target, name)) continue;
    if (!Reflect.defineProperty(target, name, { value: undefined, writable: false, configurable: false, enumerable: false })) {
      throw new TypeError(`Browser Python isolation could not remove ${name}.`);
    }
  }
  if (Reflect.get(owner, name) !== undefined) throw new TypeError(`Browser Python isolation could not remove ${name}.`);
}

export function isolatePythonWorker(scope: object, navigator: object | undefined): void {
  for (const name of globalCapabilities) deny(scope, name);
  if (navigator) for (const name of navigatorCapabilities) deny(navigator, name);
}
