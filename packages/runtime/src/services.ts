import type { ProjectPort, CompilePort, AiProvider, ExternalAdapter, Id, User, Policy, Scope } from "@quire/contracts";
import type { Server, WebSocketHandler } from "bun";
import { ServiceError } from "./errors";

export type Principal = {
  readonly user: User; readonly sessionId: Id; readonly csrfToken: string; readonly operator: boolean;
};
export interface IdentityPort {
  authenticate(request: Request): Promise<Principal | null>;
  require(request: Request): Promise<Principal>;
  verifyMutation(request: Request, principal: Principal): Promise<void>;
}
export interface PolicyPort {
  forProject(actorId: Id, projectId: Id): Promise<Policy>;
}
export type RealtimeSocketData = {
  readonly actorId: Id | null; readonly sessionId: Id | null; readonly connectionId: Id; readonly scope: Scope;
};
export interface RealtimePort {
  readonly handlers: WebSocketHandler<RealtimeSocketData>
    & Required<Pick<WebSocketHandler<RealtimeSocketData>, "message">>;
  upgrade(request: Request, server: Server<RealtimeSocketData>): Response | undefined | Promise<Response | undefined>;
}
export type ServicePorts = {
  readonly projects: ProjectPort; readonly compiler: CompilePort;
  readonly identity: IdentityPort; readonly policy: PolicyPort;
  readonly realtime: RealtimePort;
  readonly ai: AiProvider; readonly adapters: ReadonlyMap<string, ExternalAdapter>;
};
export class ServiceRegistry {
  private readonly values: { -readonly [K in keyof ServicePorts]?: ServicePorts[K] } = {};
  provide<K extends keyof ServicePorts>(name: K, service: ServicePorts[K]): void {
    if (this.values[name]) throw new ServiceError("DUPLICATE_SERVICE", 500, `Service ${name} already registered`);
    this.values[name] = service;
  }
  get<K extends keyof ServicePorts>(name: K): ServicePorts[K] {
    const service = this.values[name];
    if (!service) throw new ServiceError("SERVICE_UNAVAILABLE", 503, `Service ${name} is not registered`);
    return service;
  }
  has(name: keyof ServicePorts): boolean { return this.values[name] !== undefined; }
}
