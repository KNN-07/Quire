import { S3Client } from "bun";
import { spawn } from "node:child_process";
import type { S3BlobStoreOptions } from "../../../../services/operations/storage/s3";

const image = process.env["QUIRE_S3_TEST_IMAGE"] ?? "minio/minio:RELEASE.2025-09-07T16-13-09Z";

async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (exit !== 0) throw new Error(`docker ${args[0]} exited ${exit}: ${stderr}`);
  return stdout.trim();
}

export class S3TestServer {
  readonly name = `quire-p1s-s3-${crypto.randomUUID()}`;
  readonly accessKeyId = `quire-${crypto.randomUUID()}`;
  readonly secretAccessKey = crypto.randomUUID();
  readonly bucket = "quire-blobs";
  private attachedExit: Promise<number | null> | undefined;
  private endpoint = "";
  private containerCreated = false;
  private volumeCreated = false;

  options(): S3BlobStoreOptions {
    return {
      endpoint: this.endpoint, bucket: this.bucket, region: "us-east-1",
      accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey,
    };
  }

  async create(): Promise<void> {
    await docker("volume", "create", this.name);
    this.volumeCreated = true;
    await docker("create", "--name", this.name, "--publish", "127.0.0.1::9000",
      "--mount", `type=volume,source=${this.name},target=/data`,
      "--env", `MINIO_ROOT_USER=${this.accessKeyId}`,
      "--env", `MINIO_ROOT_PASSWORD=${this.secretAccessKey}`,
      "--env", "MINIO_BROWSER=off",
      "--entrypoint", "/bin/sh", image, "-c",
      `mkdir -p /data/${this.bucket}; exec minio server /data --address :9000`);
    this.containerCreated = true;
    console.info(`S3 resource created: ${this.name}; image=${image}`);
    await this.start();
  }

  async start(): Promise<void> {
    const attached = spawn("docker", ["start", "--attach", this.name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.attachedExit = new Promise(resolve => { attached.once("exit", resolve); });
    // MinIO emits API only after listening; subscribe before startup completes.
    // A deadline bounds failure, rather than guessing startup time with sleeps.
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => { reject(new Error(`MinIO startup deadline: ${output}`)); }, 30_000);
      const onData = (chunk: Buffer): void => {
        output += chunk.toString();
        if (output.includes("API:")) {
          clearTimeout(timer);
          resolve();
        }
      };
      attached.stdout.on("data", onData);
      attached.stderr.on("data", onData);
      attached.once("error", error => { clearTimeout(timer); reject(error); });
      attached.once("exit", code => {
        clearTimeout(timer);
        reject(new Error(`MinIO exited before ready (${code}): ${output}`));
      });
    });
    const binding = await docker("port", this.name, "9000/tcp");
    this.endpoint = `http://${binding}`;
    const health = await fetch(`${this.endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`MinIO readiness failed: ${health.status}`);
    console.info(`S3 ready: ${this.name}; ${this.endpoint}`);
  }

  async restart(): Promise<void> {
    await docker("stop", this.name);
    await this.attachedExit;
    await this.start();
    console.info(`S3 restarted with retained volume: ${this.name}`);
  }

  async overwrite(hash: string, bytes: Uint8Array): Promise<void> {
    await new S3Client(this.options()).file(`${hash.slice(0, 2)}/${hash}`).write(bytes);
  }

  async remove(): Promise<void> {
    if (this.containerCreated) {
      await docker("rm", "--force", this.name);
      await this.attachedExit;
      this.containerCreated = false;
    }
    if (this.volumeCreated) {
      await docker("volume", "rm", this.name);
      this.volumeCreated = false;
    }
    const containers = await docker("ps", "--all", "--quiet", "--filter", `name=^/${this.name}$`);
    const volumes = await docker("volume", "ls", "--quiet", "--filter", `name=^${this.name}$`);
    if (containers || volumes) throw new Error(`S3 cleanup incomplete: ${this.name}`);
    console.info(`S3 cleanup verified: ${this.name}; container absent; volume absent; listener removed`);
  }
}
