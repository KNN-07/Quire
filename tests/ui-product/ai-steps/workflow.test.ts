import { test } from "bun:test";
import { exercise } from "./fixture";

test("native recorded steps arrive through authorized events and keep generation separate from review", async () => {
  await exercise("after");
}, 240_000);
