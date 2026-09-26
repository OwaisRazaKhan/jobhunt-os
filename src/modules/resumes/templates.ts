/**
 * Resume templates: design tokens shared by the HTML preview, the PDF renderer and the DOCX
 * renderer, so all three follow the same typography, spacing and hierarchy. Single-column,
 * text-only layouts (no images, icons, tables or skill meters) keep text extraction reliable.
 */

export const TEMPLATE_KEYS = ["CLASSIC", "MODERN", "TECHNICAL", "EDITORIAL"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const PAGE_FORMATS = ["A4", "LETTER"] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

/** Page sizes in PostScript points (1pt = 1/72 in). */
export const PAGE_SIZES: Record<PageFormat, { width: number; height: number; label: string }> = {
  A4: { width: 595.28, height: 841.89, label: "A4 (210 × 297 mm)" },
  LETTER: { width: 612, height: 792, label: "US Letter (8.5 × 11 in)" },
};

export type FontFamily = "sans" | "serif" | "mono";

export interface ResumeTemplate {
  key: TemplateKey;
  label: string;
  description: string;
  /** Body and heading families (PDF: Helvetica / Times / Courier standard fonts; DOCX/HTML: close equivalents) */
  bodyFont: FontFamily;
  headingFont: FontFamily;
  nameSize: number;
  headlineSize: number;
  sectionSize: number;
  bodySize: number;
  smallSize: number;
  lineGap: number;
  /** Margins in points */
  margin: number;
  sectionGap: number;
  itemGap: number;
  /** Hex colours; accent is used for headings/rules only (text stays near-black) */
  text: string;
  muted: string;
  accent: string;
  sectionStyle: "rule" | "caps" | "accent-caps" | "plain";
  nameAlign: "left" | "center";
  bullet: string;
  datesPosition: "right" | "inline";
}

export const TEMPLATES: Record<TemplateKey, ResumeTemplate> = {
  CLASSIC: {
    key: "CLASSIC",
    label: "Classic",
    description:
      "Serif headings, centered name, horizontal rules. Conservative and widely accepted.",
    bodyFont: "serif",
    headingFont: "serif",
    nameSize: 20,
    headlineSize: 11,
    sectionSize: 11,
    bodySize: 10,
    smallSize: 9,
    lineGap: 2,
    margin: 50,
    sectionGap: 12,
    itemGap: 7,
    text: "#111111",
    muted: "#444444",
    accent: "#111111",
    sectionStyle: "rule",
    nameAlign: "center",
    bullet: "•",
    datesPosition: "right",
  },
  MODERN: {
    key: "MODERN",
    label: "Modern",
    description: "Clean sans-serif with a restrained accent colour on section headings.",
    bodyFont: "sans",
    headingFont: "sans",
    nameSize: 22,
    headlineSize: 11,
    sectionSize: 10,
    bodySize: 9.5,
    smallSize: 8.5,
    lineGap: 2.2,
    margin: 46,
    sectionGap: 13,
    itemGap: 7,
    text: "#161616",
    muted: "#4a4a4a",
    accent: "#1f4e79",
    sectionStyle: "accent-caps",
    nameAlign: "left",
    bullet: "•",
    datesPosition: "right",
  },
  TECHNICAL: {
    key: "TECHNICAL",
    label: "Technical",
    description:
      "Compact sans-serif, technologies shown per role and project. Fits more on a page.",
    bodyFont: "sans",
    headingFont: "sans",
    nameSize: 19,
    headlineSize: 10,
    sectionSize: 10,
    bodySize: 9,
    smallSize: 8.5,
    lineGap: 1.6,
    margin: 40,
    sectionGap: 10,
    itemGap: 6,
    text: "#111111",
    muted: "#3f3f3f",
    accent: "#2d2d2d",
    sectionStyle: "caps",
    nameAlign: "left",
    bullet: "–",
    datesPosition: "right",
  },
  EDITORIAL: {
    key: "EDITORIAL",
    label: "Editorial",
    description:
      "Serif body with generous spacing; suited to marketing, content and communication roles.",
    bodyFont: "serif",
    headingFont: "sans",
    nameSize: 24,
    headlineSize: 11.5,
    sectionSize: 9.5,
    bodySize: 10.5,
    smallSize: 9,
    lineGap: 2.6,
    margin: 54,
    sectionGap: 15,
    itemGap: 8,
    text: "#1a1a1a",
    muted: "#555555",
    accent: "#7a2e2e",
    sectionStyle: "accent-caps",
    nameAlign: "left",
    bullet: "•",
    datesPosition: "inline",
  },
};

export function getTemplate(key: string | null | undefined): ResumeTemplate {
  return TEMPLATES[
    (TEMPLATE_KEYS as readonly string[]).includes(key ?? "") ? (key as TemplateKey) : "CLASSIC"
  ];
}

export const PDF_FONTS: Record<FontFamily, { regular: string; bold: string; italic: string }> = {
  sans: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
  serif: { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" },
  mono: { regular: "Courier", bold: "Courier-Bold", italic: "Courier-Oblique" },
};

export const CSS_FONTS: Record<FontFamily, string> = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, monospace",
};

export const DOCX_FONTS: Record<FontFamily, string> = {
  sans: "Arial",
  serif: "Times New Roman",
  mono: "Courier New",
};
