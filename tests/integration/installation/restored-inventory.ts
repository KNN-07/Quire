import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { S3Client } from "bun";
import { createPrivateKey } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DigestSchema, InstantSchema } from "@quire/contracts";
import { ControlReceiptSchema, BindingSchema } from "../../../services/operations/installation/model";
import type { InstallationBinding } from "../../../services/operations/installation/model";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { openMaintenanceBinding } from "../../../services/operations/installation/prepared-storage-host";
import { verifyBackup } from "../../../services/operations/backups/archive";
import { exportDatabase } from "../../../services/operations/backups/database";
import { gitCommand } from "../../../services/operations/backups/git-verify";

/** Invoke only at the peer-attested fresh prepared-health gate, before producers activate. */
export async function assertRestoredInventory(controlRoot: string, operationId: string, binding: InstallationBinding) {
  const control = new Database(join(controlRoot, "control.sqlite"), { readonly: true });
  let receipt;
  try {
    control.exec("PRAGMA busy_timeout=5000");
    const row = z.object({ receipt_json: z.string() }).parse(
      control.query("SELECT receipt_json FROM commands WHERE operation_id=?").get(operationId));
    receipt = ControlReceiptSchema.parse(JSON.parse(row.receipt_json));
  } finally { control.close(); }
  const backup = receipt.recovery?.backup;
  if (!backup || !receipt.recovery?.restoreResult) throw new Error("No actual durable completed restore result");
  const restored = z.object({ binding: BindingSchema }).parse(JSON.parse(receipt.recovery.restoreResult));
  expect(restored.binding).toEqual(binding);
  const root = binding.data.dialect === "sqlite" ? binding.data.dataRoot : dirname(binding.data.applicationSecretRef);
  const secret = Buffer.from(z.string().regex(/^[a-f0-9]{64}$/).parse(
    (await readFile(join(root, "secret.key"), "utf8")).trim()), "hex");
  const signer = createPrivateKey(await readFile(join(controlRoot, "secrets/archive.pem")));
  const verified = await verifyBackup(backup.path, secret, signer);
  expect(verified.manifestDigest).toBe(backup.digest);
  expect(verified.manifest.authority).toBe(controlDigest(secret));
  expect(verified.database.dialect).toBe(binding.data.dialect);
  const opened = await openMaintenanceBinding(binding, true);
  try {
    const actual = await exportDatabase(opened.context);
    const expected = {
      ...verified.database,
      tables: verified.database.tables.map(table => ({ ...table, rows: table.rows.map(row => ({ ...row })) })),
    };
    const lower = Date.parse(verified.manifest.createdAt);
    const upper = Date.now();
    const expiry = (value: unknown) => {
      const timestamp = InstantSchema.parse(value);
      expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(lower);
      expect(Date.parse(timestamp)).toBeLessThanOrEqual(upper);
      return timestamp;
    };
    for (const table of expected.tables) {
      const target = actual.tables.find(value => value.name === table.name);
      if (!target) throw new Error(`Restored table missing: ${table.name}`);
      for (const row of table.rows) {
        if (table.name === "branch_leases") {
          const next = target.rows.find(value => value["project_id"] === row["project_id"] && value["branch"] === row["branch"]);
          if (!next) throw new Error("Restored branch authority missing");
          row["expires_at"] = expiry(next["expires_at"]);
          const published = row["branch"] === "main" && verified.manifest.repositories.some(repository =>
            repository.projectId === row["project_id"] && repository.refs.length > 0);
          if (published) {
            expect(next["fence"]).toBe(z.number().parse(row["fence"]) + 1);
            expect(next["owner"]).not.toBe(row["owner"]);
            row["fence"] = next["fence"] ?? null;
            row["owner"] = z.string().uuid().parse(next["owner"]);
          }
        } else if (table.name === "workers") {
          row["state"] = "offline";
          row["job_id"] = null;
        } else if (table.name === "worker_leases" || table.name === "o_worker_controller") {
          const next = target.rows.find(value => value["id"] === row["id"] && value["job_id"] === row["job_id"]);
          if (!next) throw new Error(`Restored owner receipt missing: ${table.name}`);
          row["expires_at"] = expiry(next["expires_at"]);
        } else if (table.name === "o_worker_processes" && row["exited_at"] === null) {
          const next = target.rows.find(value => value["id"] === row["id"]);
          if (!next) throw new Error("Restored process receipt missing");
          row["pid"] = null;
          row["desired"] = "stopped";
          row["exited_at"] = expiry(next["exited_at"]);
          row["version"] = z.number().parse(row["version"]) + 1;
        } else if (table.name === "o_backup_receipts") {
          const operation = z.object({ status: z.string() }).parse(JSON.parse(z.string().parse(row["response_json"])));
          expect(["queued", "running"]).not.toContain(operation.status);
        }
      }
      table.rows.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    }
    expect(actual).toEqual(expected);
    const files = verified.manifest.files.filter(file => file.path.startsWith("blobs/"));
    for (const file of files) {
      const digest = DigestSchema.parse(file.path.slice("blobs/".length));
      const bytes = await opened.context.blobs.get(digest);
      expect(bytes.byteLength).toBe(file.bytes);
      expect(controlDigest(bytes)).toBe(file.sha256);
    }
    const keys = files.map(file => {
      const hash = file.path.slice("blobs/".length);
      return `${hash.slice(0, 2)}/${hash}`;
    }).sort();
    if (binding.data.dialect === "sqlite") {
      const blobRoot = join(root, "blobs");
      const actualKeys: string[] = [];
      for (const prefix of await readdir(blobRoot)) {
        for (const name of await readdir(join(blobRoot, prefix))) actualKeys.push(`${prefix}/${name}`);
      }
      expect(actualKeys.sort()).toEqual(keys);
    } else {
      const credentials = z.object({ accessKeyId: z.string(), secretAccessKey: z.string() }).parse(
        JSON.parse(await readFile(binding.data.blobs.credentialsSecretRef, "utf8")));
      const client = new S3Client({ ...credentials, endpoint: binding.data.blobs.endpoint,
        region: binding.data.blobs.region, bucket: binding.data.blobs.bucket });
      const listing = await client.list({ maxKeys: 1000 });
      expect(listing.isTruncated).toBe(false);
      expect((listing.contents ?? []).map(object => object.key).sort()).toEqual(keys);
    }
    for (const repository of verified.manifest.repositories) {
      const volume = binding.data.dialect === "sqlite" ? join(root, "git") : binding.data.repository.volume;
      const path = join(volume, `${repository.projectId}.git`);
      await gitCommand(path, ["fsck", "--full", "--strict", "--no-reflogs"]);
      const refs = new TextDecoder().decode(await gitCommand(path, ["for-each-ref", "--format=%(refname) %(objectname)"]))
        .trim().split("\n").filter(Boolean).sort();
      expect(refs).toEqual(repository.refs.map(ref => `${ref.ref} ${ref.oid.slice(5)}`).sort());
      const objects = new TextDecoder().decode(await gitCommand(path,
        ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"])).trim().split("\n").filter(Boolean);
      expect(objects.length).toBe(repository.objects);
    }
    return { tables: actual.tables.length, blobs: files.length, repositories: verified.manifest.repositories.length,
      archiveId: verified.manifest.id, archiveDigest: verified.manifestDigest };
  } finally { await opened.close(); }
}
