import { test } from "bun:test";
import { catalogFixture } from "./harness";
import { catalogConcurrency } from "./concurrency";

test("serializes bibliography edits, publication and version allocation with exact snapshot pinning", async () => {
  await using fixture = await catalogFixture();
  await catalogConcurrency(fixture);
});
