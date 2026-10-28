import { IdSchema } from "@quire/contracts";

await import("@vitejs/plugin-react/preamble");
const { mountPdf } = await import("./harness");

const query = new URL(window.location.href).searchParams;
window.pdfReady = mountPdf(IdSchema.parse(query.get("project")), query.get("activeFile") !== "false").then(() => {
  document.dispatchEvent(new Event("pdf-harness-mounted"));
});
declare global { interface Window { pdfReady: Promise<void> } }
