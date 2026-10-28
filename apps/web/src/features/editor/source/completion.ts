import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import type { TexIndex } from "./tex";

export const texCommands = [
  ["section", "\\section{${Heading}}", ""], ["subsection", "\\subsection{${Heading}}", ""],
  ["textbf", "\\textbf{${text}}", ""], ["textit", "\\textit{${text}}", ""],
  ["emph", "\\emph{${text}}", ""], ["label", "\\label{${key}}", ""],
  ["ref", "\\ref{${key}}", ""], ["eqref", "\\eqref{${key}}", "amsmath"],
  ["cite", "\\cite{${key}}", ""], ["citep", "\\citep{${key}}", "natbib"],
  ["citet", "\\citet{${key}}", "natbib"], ["includegraphics", "\\includegraphics[width=\\linewidth]{${file}}", "graphicx"],
  ["usepackage", "\\usepackage{${package}}", ""], ["input", "\\input{${file}}", ""],
  ["frac", "\\frac{${numerator}}{${denominator}}", ""], ["sqrt", "\\sqrt{${value}}", ""],
  ["sum", "\\sum_{${i=1}}^{${n}}", ""], ["alpha", "\\alpha", ""],
  ["beta", "\\beta", ""], ["gamma", "\\gamma", ""], ["theta", "\\theta", ""],
  ["lambda", "\\lambda", ""], ["infty", "\\infty", ""], ["mathbb", "\\mathbb{${R}}", "amssymb"],
  ["mathbf", "\\mathbf{${x}}", ""], ["operatorname", "\\operatorname{${name}}", "amsmath"],
] as const;
export const texEnvironments = ["document", "abstract", "equation", "equation*", "align", "align*", "gather", "itemize", "enumerate", "figure", "table", "tabular", "verbatim"] as const;

export function texCompletion(index: () => TexIndex) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.state.sliceDoc(0, context.pos);
    const argument = /\\(ref|eqref|autoref|pageref|cite\w*|begin|end)\{([^{}]*)$/.exec(before);
    if (argument) {
      const command = argument[1] ?? "";
      const prefix = argument[2] ?? "";
      const last = prefix.lastIndexOf(",") + 1;
      const options = command.startsWith("cite") ? index().citations
        : command === "begin" || command === "end" ? texEnvironments : index().labels;
      return {
        from: context.pos - prefix.length + last,
        options: options.map(label => ({ label, type: "constant" })),
        validFor: /^[\p{L}\p{N}_:./*-]*$/u,
      };
    }
    const command = context.matchBefore(/\\[A-Za-z]*$/);
    if (!command) return null;
    const options: Completion[] = texCommands.map(([label, template, requires]) =>
      snippetCompletion(template, { label: `\\${label}`, type: "function", detail: requires ? `Requires ${requires}` : "LaTeX" }));
    options.push(snippetCompletion("\\begin{${environment}}\n${}\n\\end{${environment}}", { label: "\\begin", type: "keyword", detail: "Environment" }));
    return { from: command.from, options, validFor: /^\\[A-Za-z]*$/ };
  };
}
