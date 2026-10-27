import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceError } from "@quire/runtime";
import { sandbox, defaultLimits } from "./sandbox";
import { readTar } from "./archive";

export type VisualRegion = {
  readonly page: number; readonly x: number; readonly y: number;
  readonly width: number; readonly height: number; readonly label: "visual difference";
};
function ppm(bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.subarray(0, 100));
  const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(header);
  if (!match?.[1] || !match[2]) throw new ServiceError("INVALID_RENDER", 422, "Expected 8-bit RGB page image");
  return { width: Number(match[1]), height: Number(match[2]), pixels: bytes.subarray(match[0].length) };
}
export async function renderedDifference(input: { readonly from: Uint8Array; readonly to: Uint8Array;
  readonly mode: "side-by-side" | "overlay"; readonly signal?: AbortSignal }) {
  const root = await mkdtemp(join(tmpdir(), "quire-pdf-diff-"));
  try {
    await writeFile(join(root, "from.pdf"), input.from);
    await writeFile(join(root, "to.pdf"), input.to);
    const render = await sandbox({ source: root, limits: defaultLimits,
      ...(input.signal ? { signal: input.signal } : {}), command: ["/bin/sh", "-c",
      "pdftoppm -r 72 /src/from.pdf /work/from >&2 && pdftoppm -r 72 /src/to.pdf /work/to >&2 && pdftoppm -png -r 72 /src/from.pdf /work/from >&2 && pdftoppm -png -r 72 /src/to.pdf /work/to >&2 && cd /work && tar --format=ustar -cf - -- *.ppm *.png"] });
    if (render.code !== 0 || render.canceled) throw new ServiceError("PDF_RENDER_FAILED", 422, render.stderr);
    const images = readTar(render.stdout);
    const names = [...images.keys()].filter((name) => name.endsWith(".ppm"));
    const pages = Math.max(...names.map((name) => Number(/-(\d+)\.ppm$/.exec(name)?.[1] ?? 0)));
    const regions: VisualRegion[] = [];
    for (let page = 1; page <= pages; page++) {
      const left = names.find((name) => name.startsWith("from-") && Number(/-(\d+)/.exec(name)?.[1]) === page);
      const right = names.find((name) => name.startsWith("to-") && Number(/-(\d+)/.exec(name)?.[1]) === page);
      const aBytes = left ? images.get(left) : undefined;
      const bBytes = right ? images.get(right) : undefined;
      const a = aBytes ? ppm(aBytes) : null;
      const b = bBytes ? ppm(bBytes) : null;
      const width = Math.max(a?.width ?? 0, b?.width ?? 0);
      const height = Math.max(a?.height ?? 0, b?.height ?? 0);
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const changed = [0, 1, 2].some((channel) =>
          (a && x < a.width && y < a.height ? a.pixels[(y * a.width + x) * 3 + channel] : 255) !==
          (b && x < b.width && y < b.height ? b.pixels[(y * b.width + x) * 3 + channel] : 255));
        if (changed) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      }
      if (maxX >= 0) regions.push({ page, x: minX, y: minY, width: maxX - minX + 1,
        height: maxY - minY + 1, label: "visual difference" });
    }
    const tex = `\\documentclass{article}
\\usepackage[paperwidth=${input.mode === "overlay" ? "8.5" : "17"}in,paperheight=11in,margin=0pt]{geometry}
\\usepackage{graphicx,transparent}\\pagestyle{empty}
\\begin{document}\\noindent
${Array.from({ length: pages }, (_, index) => {
  const p = index + 1;
  const width = input.mode === "overlay" ? ".98" : ".49";
  const left = names.some((name) => name.startsWith("from-") && Number(/-(\d+)/.exec(name)?.[1]) === p) ?
    `\\includegraphics[page=${p},width=${width}\\paperwidth,height=\\paperheight,keepaspectratio]{/src/from.pdf}` : "\\makebox[.49\\paperwidth]{}";
  const right = names.some((name) => name.startsWith("to-") && Number(/-(\d+)/.exec(name)?.[1]) === p) ?
    `\\includegraphics[page=${p},width=${width}\\paperwidth,height=\\paperheight,keepaspectratio]{/src/to.pdf}` : "\\makebox[.49\\paperwidth]{}";
  return `${index ? "\\newpage\\noindent" : ""}${input.mode === "overlay" ? `\\rlap{${left}}{\\transparent{0.5}${right}}` : `${left}${right}`}`;
}).join("\n")}\\end{document}`;
    await writeFile(join(root, "diff.tex"), tex);
    const generated = await sandbox({ source: root, limits: defaultLimits,
      ...(input.signal ? { signal: input.signal } : {}), command: ["/bin/sh", "-c",
      "pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error -output-directory=/work /src/diff.tex >&2 && pdftoppm -f 1 -l 1 -singlefile -png -scale-to 1600 /work/diff.pdf /work/comparison >&2 && cd /work && tar --format=ustar -cf - diff.pdf comparison.png"] });
    const output = readTar(generated.stdout);
    const pdf = output.get("diff.pdf"), preview = output.get("comparison.png");
    if (generated.code !== 0 || generated.canceled || !pdf || !preview) throw new ServiceError("PDF_DIFF_FAILED", 422, generated.stderr);
    return { regions, pdf, preview, images };
  } finally { await rm(root, { recursive: true, force: true }); }
}
