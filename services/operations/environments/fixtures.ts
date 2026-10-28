import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import engines from "../../../deploy/compiler/fixtures/engines/main.tex" with {type:"text"};
import localClass from "../../../deploy/compiler/fixtures/engines/quirelocal.cls" with {type:"text"};
import localStyle from "../../../deploy/compiler/fixtures/engines/quirelocalstyle.sty" with {type:"text"};
import plain from "../../../deploy/compiler/fixtures/plain/main.tex" with {type:"text"};
import fonts from "../../../deploy/compiler/fixtures/fonts/main.tex" with {type:"text"};
import bibtex from "../../../deploy/compiler/fixtures/bibtex/main.tex" with {type:"text"};
import biber from "../../../deploy/compiler/fixtures/biber/main.tex" with {type:"text"};
import bibliography from "../../../deploy/compiler/fixtures/bibtex/references.bib" with {type:"text"};
import minted from "../../../deploy/compiler/fixtures/minted/main.tex" with {type:"text"};
import tikz from "../../../deploy/compiler/fixtures/tikz/main.tex" with {type:"text"};
import knitr from "../../../deploy/compiler/fixtures/knitr/main.Rnw" with {type:"text"};
import knitrMain from "../../../deploy/compiler/fixtures/knitr/main.tex" with {type:"text"};
import tagged from "../../../deploy/compiler/fixtures/tagged/main.tex" with {type:"text"};
import escape from "../../../deploy/compiler/fixtures/escape/main.tex" with {type:"text"};

const FixtureSchema = z.enum(["engines","plain","fonts","bibtex","biber","minted","tikz","knitr","tagged","escape"]);
const fixtures = {
  engines:{"main.tex":engines,"quirelocal.cls":localClass,"quirelocalstyle.sty":localStyle},
  plain:{"main.tex":plain}, fonts:{"main.tex":fonts},
  bibtex:{"main.tex":bibtex,"references.bib":bibliography},
  biber:{"main.tex":biber,"references.bib":bibliography},
  minted:{"main.tex":minted},tikz:{"main.tex":tikz},
  knitr:{"main.Rnw":knitr,"main.tex":knitrMain},tagged:{"main.tex":tagged},escape:{"main.tex":escape},
} as const;
/** Text imports are bundled into API/worker artifacts, so startup probes do
 * not depend on an unpackaged repository-relative fixture directory. */
export async function fixtureSource(name: string) {
  const files = fixtures[FixtureSchema.parse(name)];
  const path = await mkdtemp(join(tmpdir(),"quire-environment-fixture-"));
  try {
    for (const [filename,text] of Object.entries(files)) await writeFile(join(path,filename),text,{mode:0o400});
    return {path,[Symbol.asyncDispose]:()=>rm(path,{recursive:true,force:true})};
  } catch(error) {
    await rm(path,{recursive:true,force:true});
    throw error;
  }
}
