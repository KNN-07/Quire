import { ServiceError } from "@quire/runtime";
import type { ServiceModule } from "@quire/runtime";
import type { AdapterContribution, AdapterServices } from "../shared";
import { OpenAiChat } from "./provider";
import { AiService } from "./service";
import type { AiOptions } from "./service";
import { registerAiRoutes } from "./routes";
import { migrations } from "./migrations";
import { provideOperationEventReader } from "../../core/review/operation-events";
import { scopeOf } from "./model";

export function createAiModules(options: AiOptions = {}) {
  let services: AdapterServices | undefined;
  let ai: AiService | undefined;
  const contributions: readonly AdapterContribution[] = [shared => {
    services = shared;
    return new OpenAiChat(shared.http).definition();
  }];
  const module: ServiceModule = {
    id: "069-x-ai", lane: "X", order: 69, migrations,
    async register(context) {
      if (!services || ai) throw new ServiceError("AI_ASSEMBLY_ORDER", 500, "AI needs fresh shared adapter registration");
      ai = new AiService({ ...services, context }, options);
      await ai.start();
      registerAiRoutes(ai);
      const service = ai;
      provideOperationEventReader(context, async (actor, id) => {
        try { return scopeOf(await service.store.accessible(actor, id)); }
        catch (error) {
          if (error instanceof ServiceError && [401, 403, 404].includes(error.status)) return null;
          throw error;
        }
      });
    },
  };
  return { contributions, module,
    get service() {
      if (!ai) throw new ServiceError("AI_UNREGISTERED", 503, "Register AI module first");
      return ai;
    },
    async close() { await ai?.close(); },
  };
}
export { AiService } from "./service";
export type { AiOptions } from "./service";
export { OpenAiChat, missingConfiguration } from "./provider";
export { migrations } from "./migrations";
