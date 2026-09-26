import "server-only";
import PDFDocument from "pdfkit";
import { PAGE_SIZES, PDF_FONTS, type PageFormat } from "@/modules/resumes/templates";
import { toWinAnsi } from "@/modules/resumes/render/text";
import type { CoverLetterDocument } from "../document";
import { buildLetterModel, letterTemplate } from "./layout";

/**
 * Cover-letter PDF (same engine as Resume Studio: pdfkit, standard fonts, real selectable text,
 * no images). Single column; continues onto a second page only when the letter is long.
 */
export async function renderCoverLetterPdf(
  doc: CoverLetterDocument,
  opts: { template: string; pageFormat: PageFormat | string; title?: string },
): Promise<{ bytes: Uint8Array; pages: number }> {
  const t = letterTemplate(opts.template);
  const size = PAGE_SIZES[(opts.pageFormat === "LETTER" ? "LETTER" : "A4") as PageFormat];
  const model = buildLetterModel(doc);
  const fonts = { body: PDF_FONTS[t.bodyFont], head: PDF_FONTS[t.headingFont] };
  const txt = (s: string) => toWinAnsi(s);
  const pdf = new PDFDocument({
    size: [size.width, size.height],
    margins: { top: t.margin, bottom: t.margin, left: t.margin, right: t.margin },
    bufferPages: true,
    info: {
      Title: txt(opts.title ?? `${model.name ?? "Cover letter"} — Cover letter`),
      Author: txt(model.name ?? ""),
      Creator: "JOBHUNT OS Communication Studio",
      Producer: "JOBHUNT OS (pdfkit)",
    },
    lang: "en",
    displayTitle: true,
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });
  const left = t.margin;
  const width = size.width - t.margin * 2;

  if (model.name) {
    pdf
      .font(fonts.head.bold)
      .fontSize(t.nameSize - 2)
      .fillColor(t.text);
    pdf.text(txt(model.name), left, pdf.y, { width, align: t.nameAlign });
  }
  if (model.contact.length) {
    pdf.moveDown(0.2).font(fonts.body.regular).fontSize(t.smallSize).fillColor(t.muted);
    pdf.text(txt(model.contact.map((c) => c.text).join("  |  ")), left, pdf.y, {
      width,
      align: t.nameAlign,
    });
  }
  if (model.name || model.contact.length) {
    if (t.sectionStyle === "rule" || t.sectionStyle === "accent-caps") {
      const y = pdf.y + 6;
      pdf
        .save()
        .lineWidth(0.6)
        .strokeColor(t.sectionStyle === "rule" ? t.text : t.accent)
        .moveTo(left, y)
        .lineTo(left + width, y)
        .stroke()
        .restore();
      pdf.y = y + 8;
    } else pdf.moveDown(1);
  }

  pdf.font(fonts.body.regular).fontSize(t.letterBody).fillColor(t.text);
  const para = (value: string, gapAfter = t.paragraphGap) => {
    pdf.text(txt(value), left, pdf.y, { width, lineGap: t.lineGap, align: "left" });
    pdf.y += gapAfter;
  };
  if (model.date) para(model.date, t.paragraphGap + 2);
  if (model.recipient.length) {
    for (const line of model.recipient) pdf.text(txt(line), left, pdf.y, { width, lineGap: 1 });
    pdf.y += t.paragraphGap + 2;
  }
  if (model.greeting) para(model.greeting);
  for (const p of model.paragraphs) para(p);
  if (model.closing) pdf.text(txt(model.closing), left, pdf.y, { width });
  if (model.signature.length) {
    pdf.y += 4;
    for (const [i, line] of model.signature.entries()) {
      pdf
        .font(i === 0 ? fonts.body.bold : fonts.body.regular)
        .fontSize(i === 0 ? t.letterBody : t.smallSize + 0.5)
        .fillColor(i === 0 ? t.text : t.muted);
      pdf.text(txt(line), left, pdf.y, { width, lineGap: 1 });
    }
  }
  const range = pdf.bufferedPageRange();
  pdf.end();
  await done;
  return { bytes: new Uint8Array(Buffer.concat(chunks)), pages: range.count };
}
