import { expect, test } from "bun:test";
import { migrations } from "../../../services/core/git";

test("T11 preserves the accepted native Git migration bytes and supplies explicit PostgreSQL DDL", async () => {
  const child = Bun.spawn(["git", "show", "3fe3a23:services/core/git/migrations.ts"], { stdout: "pipe", stderr: "pipe" });
  const [source, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(code, error).toBe(0);
  const original = /sql: `([\s\S]*?)`,/.exec(source)?.[1];
  if (!original) throw new TypeError("Accepted Git migration not found");
  const migration = migrations[0];
  if (!migration) throw new TypeError("Git migration missing");
  expect(migration.id).toBe("024-k-git-named-intents");
  expect(new Bun.CryptoHasher("sha256").update(migration.sql).digest("hex"))
    .toBe(new Bun.CryptoHasher("sha256").update(original).digest("hex"));
  expect(migration.postgres).toBeDefined();
});
