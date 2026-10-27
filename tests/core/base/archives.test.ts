import { test, expect } from "bun:test";
import { zipSync } from "fflate";
import { ServiceError } from "@quire/runtime";
import { readZip } from "../../../services/core/base";

test("rejects ZIP data corruption when central-directory checksums disagree", () => {
  // Given: an ordinary stored file with corrupted bytes.
  const archive = zipSync({ "a.txt": new TextEncoder().encode("payload") }, { level: 0 });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  archive[start] = 1;
  // When: native import preflight and decompression run.
  const parse = () => readZip(archive);
  // Then: the checksum failure cannot create source.
  expect(parse).toThrow(ServiceError);
});

test("rejects duplicate ZIP names before decoding file contents", () => {
  // Given: two equal-length names rewritten to the same project path.
  const archive = zipSync({ "a.txt": new TextEncoder().encode("a"), "b.txt": new TextEncoder().encode("b") });
  for (let i = 0; i < archive.length - 4; i++) {
    if (archive[i] === 98 && archive[i + 1] === 46 && archive[i + 2] === 116
      && archive[i + 3] === 120 && archive[i + 4] === 116) archive[i] = 97;
  }
  // When: the archive is parsed.
  const parse = () => readZip(archive);
  // Then: the second name is rejected rather than overwriting its predecessor.
  expect(parse).toThrow(ServiceError);
});
