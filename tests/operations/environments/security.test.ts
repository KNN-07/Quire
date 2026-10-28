import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dockerSandbox } from "../../../workers/compiler/docker";
import { defaultLimits } from "../../../workers/compiler/sandbox";
import { publicAddress, validateFont, validateMirror, PackageSchema } from "../../../services/operations/environments/inputs";
import { ownedImage } from "./image";
import { compileFixture } from "../../../services/operations/environments/probe";
import { rejectionCode } from "./error";

test("rejects reserved mirrors and executable package input before provisioning",()=>{
  // Given: untrusted operator build inputs.
  const mirrors = ["http://archive.ubuntu.com/ubuntu/","https://127.0.0.1/","https://archive.ubuntu.com@localhost/","https://archive.ubuntu.com/ubuntu/?url=http://127.0.0.1"];
  // When: inputs cross the provisioning boundary.
  // Then: no arbitrary URL, reserved address or shell-bearing package is accepted.
  for (const mirror of mirrors) expect(()=>validateMirror(mirror)).toThrow();
  for (const address of ["127.0.0.1","10.1.2.3","169.254.169.254","172.16.0.1","192.168.1.1","100.64.0.1","::1"]) expect(publicAddress(address)).toBe(false);
  expect(PackageSchema.safeParse("texlive-latex-extra=2025.20260124-1").success).toBe(true);
  expect(PackageSchema.safeParse("texlive-latex-extra;touch /host").success).toBe(false);
});
test("rejects malformed fonts at the byte boundary",()=>{
  // Given: a forged sfnt directory pointing beyond its uploaded bytes.
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0,0x00010000); view.setUint16(4,1); view.setUint32(20,100);
  // When: it is parsed as an uploaded font.
  // Then: neither arbitrary text nor out-of-range tables reach fontconfig.
  expect(()=>validateFont(new TextEncoder().encode("not a font"))).toThrow();
  expect(()=>validateFont(bytes)).toThrow();
});
test("rejects mutable image tags before executing a container",async()=>{
  // Given: a source fixture and a mutable image reference.
  // When: the sandbox receives an image tag instead of an immutable ID.
  const action = dockerSandbox({image:"ubuntu:latest",source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:defaultLimits,command:["/bin/true"]});
  // Then: it fails closed before starting execution.
  expect(await rejectionCode(action)).toBe("INVALID_IMAGE");
});
test("rejects source links instead of mounting host files",async()=>{
  // Given: an owned temporary source with a link outside its tree.
  const source = await mkdtemp(join(tmpdir(),"quire-environment-link-"));
  try {
    await symlink("/etc/passwd",join(source,"outside"));
    // When: materialization encounters the link.
    const action = dockerSandbox({image:await ownedImage(),source,limits:defaultLimits,command:["/bin/true"]});
    // Then: the linked file is never available in a job.
    expect(await rejectionCode(action)).toBe("INVALID_SOURCE");
  } finally {await rm(source,{recursive:true,force:true});}
});
test("isolates host loopback and readonly source from job code",async()=>{
  // Given: a real host loopback listener and a readonly snapshot.
  let requests = 0;
  const listener = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>{requests++;return new Response("host");}});
  try {
    // When: job code attempts both forbidden writes and a host-loopback connection.
    const result = await dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
      limits:defaultLimits,command:["/bin/sh","-ec",`! touch /src/escape; ! touch /usr/escape; perl -MIO::Socket::INET -e 'exit(IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>${listener.port},Timeout=>1)?1:0)'`]});
    // Then: the real host receives nothing and both mounts reject writes.
    expect(result.code).toBe(0); expect(requests).toBe(0);
  } finally {await listener.stop(true);}
},30000);
test("removes the complete container when cancellation follows its ready event",async()=>{
  // Given: an abort subscription installed before an owned child starts.
  const controller = new AbortController();
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(()=>ready.reject(new TypeError("Container readiness timed out")),10000);
  const action = dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:defaultLimits,signal:controller.signal,command:["/bin/sh","-ec","printf 'READY\\n' >&2; exec tail -f /dev/null"],
    onStderr:chunk=>{if(chunk.includes("READY"))ready.resolve();}});
  try {
    await ready.promise;
    // When: the caller aborts after the exact child ready event.
    controller.abort();
    const result = await action;
    // Then: cancellation is reported only after forced descendant removal.
    expect(result.canceled).toBe(true); expect(result.code).not.toBe(0);
  } finally {clearTimeout(timeout);controller.abort();await action;}
},30000);
test("enforces the real writable-workspace quota",async()=>{
  // Given: an eight-megabyte private writable workspace.
  // When: a job attempts to write twelve megabytes.
  const result = await dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:{...defaultLimits,workspaceBytes:8*1024*1024},command:["/bin/dd","if=/dev/zero","of=/work/quota","bs=1048576","count=12"]});
  // Then: the actual tmpfs quota terminates the write.
  expect(result.code).not.toBe(0); expect(result.stderr).toContain("No space left on device");
},30000);
test("rejects uploaded-font fontspec usage on the incompatible pdfLaTeX engine",async()=>{
  // Given: the same font fixture successfully exercised by Xe/Lua probes.
  // When: it is actually compiled using pdfLaTeX.
  const result = await compileFixture(await ownedImage(),{fixture:"fonts",profile:"default",engine:"pdflatex"});
  // Then: no false successful font-capable PDF is returned.
  expect(result.code).not.toBe(0);
  expect(result.files.has("output.pdf")).toBe(false);
  expect(result.log).toContain("fontspec");
},30000);
test("rejects shell syntax in the restricted TikZ helper argument",async()=>{
  // Given: an immutable image with the fixed restricted wrapper.
  // When: a caller attempts to append shell syntax to an image name.
  const result = await dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:defaultLimits,command:["/usr/local/bin/quire-tikz","output-figure0;touch /work/escape"]});
  // Then: the wrapper rejects the argument before launching the TeX engine.
  expect(result.code).toBe(64);
},30000);
test("enforces the process limit for descendants inside the container",async()=>{
  // Given: a sixteen-process job cgroup.
  // When: a real process forks until the kernel refuses another descendant.
  const result = await dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:{...defaultLimits,processes:16},command:["perl","-MErrno=EAGAIN","-e",
      'pipe(my $r,my $w) or die $!; my $limited=0; for(1..64){my $p=fork(); if(!defined($p)){$limited=($! == EAGAIN);last;} if(!$p){close($w);my $x;sysread($r,$x,1);exit(0);}} close($w);while(wait()>0){} exit($limited?0:1);']});
  // Then: the kernel, not a simulated worker count, refused a fork.
  expect(result.code).toBe(0);
},30000);
test("terminates an allocation that exceeds the real job memory cgroup",async()=>{
  // Given: a sixty-four-megabyte job memory budget, with no swap.
  // When: a real Perl process attempts a 256 MiB allocation.
  const result = await dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:{...defaultLimits,memoryBytes:64*1024*1024},command:["perl","-e",'my $x="x"x(256*1024*1024);print length($x);']});
  // Then: the kernel kills the bounded job rather than allowing the allocation.
  expect(result.code).toBe(137);
},30000);
test("rejects compiler output beyond its retained stderr budget",async()=>{
  // Given: the real eight-megabyte retained stderr limit.
  // When: a confined process emits nine megabytes.
  const action = dockerSandbox({image:await ownedImage(),source:join(import.meta.dir,"../../../deploy/compiler/fixtures/engines"),
    limits:defaultLimits,command:["perl","-e",'print STDERR "x"x(9*1024*1024);']});
  // Then: output-limit failure is reported after the container is removed.
  expect(await rejectionCode(action)).toBe("OUTPUT_LIMIT");
},30000);
