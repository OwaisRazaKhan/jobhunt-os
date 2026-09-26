import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { DOCX_FONTS, PAGE_SIZES, type PageFormat } from "@/modules/resumes/templates";
import type { CoverLetterDocument } from "../document";
import { buildLetterModel, letterTemplate } from "./layout";

const pt = (n: number) => Math.round(n * 2);
const twip = (n: number) => Math.round(n * 20);
const hex = (c: string) => c.replace("#", "");

/** Cover-letter DOCX (docx library, real paragraphs/hyperlinks) from the shared render model. */
export async function renderCoverLetterDocx(
  doc: CoverLetterDocument,
  opts: { template: string; pageFormat: PageFormat | string; title?: string },
): Promise<Uint8Array> {
  const t = letterTemplate(opts.template);
  const size = PAGE_SIZES[(opts.pageFormat === "LETTER" ? "LETTER" : "A4") as PageFormat];
  const model = buildLetterModel(doc);
  const body = DOCX_FONTS[t.bodyFont];
  const head = DOCX_FONTS[t.headingFont];
  const align = t.nameAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const run = (text: string, extra: Partial<{ bold: boolean; size: number; color: string }> = {}) =>
    new TextRun({
      text,
      font: body,
      size: pt(extra.size ?? t.letterBody),
      bold: extra.bold,
      color: hex(extra.color ?? t.text),
    });
  const children: Paragraph[] = [];
  if (model.name)
    children.push(
      new Paragraph({
        alignment: align,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: model.name,
            bold: true,
            font: head,
            size: pt(t.nameSize - 2),
            color: hex(t.text),
          }),
        ],
      }),
    );
  if (model.contact.length) {
    const parts: (TextRun | ExternalHyperlink)[] = [];
    model.contact.forEach((c, i) => {
      if (i) parts.push(run("  |  ", { size: t.smallSize, color: t.muted }));
      parts.push(
        c.link
          ? new ExternalHyperlink({
              link: c.link,
              children: [run(c.text, { size: t.smallSize, color: t.muted })],
            })
          : run(c.text, { size: t.smallSize, color: t.muted }),
      );
    });
    children.push(
      new Paragraph({
        alignment: align,
        spacing: { after: 200 },
        border:
          t.sectionStyle === "rule" || t.sectionStyle === "accent-caps"
            ? {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 4,
                  color: hex(t.sectionStyle === "rule" ? t.text : t.accent),
                  space: 6,
                },
              }
            : undefined,
        children: parts,
      }),
    );
  }
  const gap = twip(t.paragraphGap);
  if (model.date)
    children.push(new Paragraph({ spacing: { after: gap + 40 }, children: [run(model.date)] }));
  model.recipient.forEach((line, i) =>
    children.push(
      new Paragraph({
        spacing: { after: i === model.recipient.length - 1 ? gap + 40 : 0 },
        children: [run(line)],
      }),
    ),
  );
  if (model.greeting)
    children.push(new Paragraph({ spacing: { after: gap }, children: [run(model.greeting)] }));
  for (const p of model.paragraphs)
    children.push(new Paragraph({ spacing: { after: gap, line: 276 }, children: [run(p)] }));
  if (model.closing)
    children.push(new Paragraph({ spacing: { after: 80 }, children: [run(model.closing)] }));
  model.signature.forEach((line, i) =>
    children.push(
      new Paragraph({
        children: [
          run(line, i === 0 ? { bold: true } : { size: t.smallSize + 0.5, color: t.muted }),
        ],
      }),
    ),
  );
  const document = new Document({
    title: opts.title ?? `${model.name ?? "Cover letter"} — Cover letter`,
    creator: "JOBHUNT OS Communication Studio",
    styles: { default: { document: { run: { font: body, size: pt(t.letterBody) } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: twip(size.width), height: twip(size.height) },
            margin: {
              top: twip(t.margin),
              bottom: twip(t.margin),
              left: twip(t.margin),
              right: twip(t.margin),
            },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
