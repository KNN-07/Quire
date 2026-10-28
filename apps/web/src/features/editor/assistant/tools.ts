import type { AiTool } from "@quire/contracts";

export const tools = {
  chat: "Chat", texgpt: "TeXGPT", "error-fix": "Fix compile error",
  "table-prompt": "Table from prompt", "table-image": "Table from image",
  "equation-prompt": "Equation from prompt", "equation-image": "Equation from image",
  grammar: "Grammar", fluency: "Fluency", paraphrase: "Paraphrase", concise: "Make concise",
  scientific: "Scientific style", split: "Split sentence", join: "Join sentences",
  synonyms: "Synonyms", title: "Title", abstract: "Abstract", translate: "Translate",
  "inline-completion": "Inline completion", "citation-reviewer": "Citation Reviewer",
} as const satisfies Readonly<Record<AiTool, string>>;
