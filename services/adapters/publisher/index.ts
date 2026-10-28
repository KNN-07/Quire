import type { ServiceModule } from "@quire/runtime";
import { migrations } from "./migrations";

export const publisherModule: ServiceModule = {
  id: "066-x-publisher",
  lane: "X",
  order: 66,
  migrations,
  register() {},
};

export { publisherContribution } from "./contribution";
export {
  PublisherContractSchema,
  parsePublisherContract,
  publisherRequirements,
} from "./configuration";
export type {
  DirectPublisherContract,
  PublisherContract,
} from "./configuration";
export { migrations } from "./migrations";
