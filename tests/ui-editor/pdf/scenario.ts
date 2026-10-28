/** Preserve the original failure when asynchronous disposal adds another error. */
export async function pdfScenario(run: () => Promise<void>) {
  try { await run(); }
  catch (error) {
    let cause: unknown = error;
    while (cause instanceof SuppressedError) {
      console.error("PDF_CLEANUP_FAILURE", cause.error);
      cause = cause.suppressed;
    }
    console.error("PDF_SCENARIO_FAILURE", cause);
    throw error;
  }
}
