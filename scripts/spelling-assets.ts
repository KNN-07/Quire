import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const dictionaries = { "en-US": "dictionary-en", "en-GB": "dictionary-en-gb", vi: "dictionary-vi" } as const;
export async function installSpellingAssets() {
  const target = resolve(import.meta.dir, "../apps/web/public/dictionaries");
  const manifest: Record<string, { version: string; aff: string; dic: string; license: string }> = {};
  for (const [locale, name] of Object.entries(dictionaries)) {
    const source = resolve(import.meta.dir, "../node_modules", name);
    const destination = join(target, locale);
    const { version } = z.object({ version: z.string() }).parse(
      JSON.parse(await readFile(join(source, "package.json"), "utf8")));
    await mkdir(destination, { recursive: true });
    for (const file of ["index.aff", "index.dic", "license", "readme.md"]) {
      await copyFile(join(source, file), join(destination, file));
    }
    manifest[locale] = { version, aff: `/dictionaries/${locale}/index.aff`,
      dic: `/dictionaries/${locale}/index.dic`, license: `/dictionaries/${locale}/license` };
  }
  await writeFile(join(target, "manifest.json"), JSON.stringify({ dictionaries: manifest, unavailable: ["zh"] }) + "\n");
  return manifest;
}
if (import.meta.main) console.info("SPELLING_ASSETS_READY", await installSpellingAssets());
