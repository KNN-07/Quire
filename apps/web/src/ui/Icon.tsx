import type { SVGProps } from "react";

const paths = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6",
  folder: "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  branch: "M6 6v12M6 8c0 5 12 0 12 7M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0M8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4",
  play: "m8 5 11 7-11 7Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z",
  warning: "m12 3 10 18H2ZM12 9v5M12 17h.01",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  menu: "M3 6h18M3 12h18M3 18h18",
  arrowLeft: "m12 5-7 7 7 7M5 12h14",
} as const;

export type IconName = keyof typeof paths;
export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}
/** Decorative by default; label the containing control, not its glyph. */
export function Icon({ name, size = 16, className = "", ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`q-icon ${className}`} {...props}><path d={paths[name]} /></svg>;
}
