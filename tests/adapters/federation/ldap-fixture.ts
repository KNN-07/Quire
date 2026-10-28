import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { certificate } from "./signed-idp";

export async function ldapFixture() {
  const cert = await certificate();
  const name = `quire-p2x-federation-${crypto.randomUUID()}`;
  const path = cert.path;
  await writeFile(join(path, "slapd.conf"), `include /etc/ldap/schema/core.schema
include /etc/ldap/schema/cosine.schema
include /etc/ldap/schema/inetorgperson.schema
pidfile /directory/slapd.pid
argsfile /directory/slapd.args
modulepath /usr/lib/ldap
moduleload back_mdb
TLSCertificateFile /fixture/cert.pem
TLSCertificateKeyFile /fixture/key.pem
TLSCACertificateFile /fixture/cert.pem
TLSVerifyClient never
database mdb
maxsize 10485760
suffix "dc=example,dc=test"
rootdn "cn=admin,dc=example,dc=test"
rootpw fixture-admin-password
directory /directory
access to * by dn.exact="cn=admin,dc=example,dc=test" manage by self read by anonymous auth
`);
  const child = Bun.spawn(["docker", "run", "--name", name, "--publish", "127.0.0.1::636",
    "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--mount", `type=bind,src=${path},dst=/fixture,readonly`, "--tmpfs", `/directory:uid=${process.getuid?.() ?? 1000},gid=${process.getgid?.() ?? 1000},mode=0700`,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "quire-p2x-federation-ldap:st_01a17c62"],
  { stdout: "pipe", stderr: "pipe" });
  let log = "";
  const ready = Promise.withResolvers<void>();
  const abort = AbortSignal.timeout(30_000);
  const onAbort = () => ready.reject(new TypeError(`LDAP startup deadline: ${log}`));
  abort.addEventListener("abort", onAbort, { once: true });
  async function stream(source: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    const reader = source.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        log = (log + decoder.decode(chunk.value, { stream: true })).slice(-64 * 1024);
        if (log.includes("slapd starting")) ready.resolve();
      }
    } finally { reader.releaseLock(); }
  }
  const output = Promise.all([stream(child.stdout), stream(child.stderr)]);
  void child.exited.then((exit) => ready.reject(new TypeError(`LDAP exited ${exit}: ${log}`)));
  try {
    await ready.promise;
    abort.removeEventListener("abort", onAbort);
    const inspect = Bun.spawn(["docker", "port", name, "636/tcp"], { stdout: "pipe", stderr: "pipe" });
    const [portOutput, portExit] = await Promise.all([new Response(inspect.stdout).text(), inspect.exited]);
    if (portExit !== 0) throw new TypeError("LDAP published port unavailable");
    const url = `ldaps://${portOutput.trim()}`;
    const ldif = `dn: dc=example,dc=test
objectClass: domain
dc: example

dn: uid=researcher,dc=example,dc=test
objectClass: inetOrgPerson
uid: researcher
cn: Directory Researcher
sn: Researcher
mail: directory@example.test
description: Researchers
userPassword: correct-directory-password

`;
    const add = Bun.spawn(["docker", "exec", "-i", "-e", "LDAPTLS_CACERT=/fixture/cert.pem", name, "ldapadd", "-x", "-H", "ldaps://127.0.0.1:636",
      "-D", "cn=admin,dc=example,dc=test", "-w", "fixture-admin-password"],
    { stdin: new TextEncoder().encode(ldif), stdout: "pipe", stderr: "pipe" });
    const [addExit, addError] = await Promise.all([add.exited, new Response(add.stderr).text()]);
    if (addExit !== 0) throw new TypeError(`LDAP fixture provisioning ${addExit}: ${addError}`);
    return { url, cert: cert.cert, name, log: () => log,
      [Symbol.asyncDispose]: async () => {
        const stop = Bun.spawn(["docker", "rm", "-f", name], { stdout: "pipe", stderr: "pipe" });
        const exit = await stop.exited;
        await child.exited;
        await output;
        await cert[Symbol.asyncDispose]();
        if (exit !== 0) throw new TypeError("LDAP container cleanup failed");
      } };
  } catch (error) {
    abort.removeEventListener("abort", onAbort);
    const stop = Bun.spawn(["docker", "rm", "-f", name], { stdout: "pipe", stderr: "pipe" });
    await stop.exited;
    await child.exited;
    await output;
    await rm(path, { recursive: true, force: true });
    throw error;
  }
}
