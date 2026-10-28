import { test } from "bun:test";
import { compilerHttp } from "./http-fixture";
import { portableCompilerDomain } from "./portable-domain";

test("portable compiler atomically claims and fences artifact/completion transactions", async () => {
  await using app = await compilerHttp();
  await portableCompilerDomain(app);
}, 90000);
