import { z } from "zod";
import type { PageViewport } from "pdfjs-dist";

const point = z.tuple([z.number(), z.number()]);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);
/** SyncTeX uses page points from top-left; PDF.js inverse yields bottom-left PDF units. */
export function sourcePoint(viewport: PageViewport, location: { readonly x: number; readonly y: number }) {
  const [x, y] = point.parse(viewport.convertToPdfPoint(location.x, location.y));
  const [left, , , top] = box.parse(viewport.viewBox);
  return { xPt: x - left, yPt: top - y };
}
export function viewportPoint(viewport: PageViewport, location: { readonly xPt: number; readonly yPt: number }) {
  const [left, , , top] = box.parse(viewport.viewBox);
  const [x, y] = point.parse(viewport.convertToViewportPoint(left + location.xPt, top - location.yPt));
  return { x, y };
}
