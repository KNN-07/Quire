import type { FullConfig } from "@playwright/test";
import { rm } from "node:fs/promises";
import { z } from "zod";

export default async function cleanup(config: FullConfig): Promise<void> {
  const path = z.string().parse(config.metadata["dataDir"]);
  await rm(path, { recursive: true, force: true });
}
