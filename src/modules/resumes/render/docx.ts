import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import type { ResumeDocument } from "../document";
import {
  DOCX_FONTS,
  getTemplate,
  PAGE_SIZES,
  type PageFormat,
  type TemplateKey,
} from "../templates";
import { buildRenderModel } from "./layout";

/**
 * DOCX renderer (docx library). Real Office Open XML: styles, true bullet lists, hyperlinks,
 * right-aligned dates via tab stops, page numbers in the footer. Same render model as PDF.
 */

const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points
const twip = (n: number) => Math.round(n * 20); // 1pt = 20 twips
const hex = (c: string) => c.replace("#", "");

export async function renderResumeDocx(
  doc: ResumeDocument,
  opts: { template: TemplateKey | string; pageFormat: PageFormat | string; title?: string },
): Promise<Uint8Array> {
  const t = getTemplate(opts.template);
  const size = PAGE_SIZES[(opts.pageFormat === "LETTER" ? "LETTER" : "A4") as PageFormat];
  const model = buildRenderModel(doc);
  const body = DOCX_FONTS[t.bodyFont];
  const head = DOCX_FONTS[t.headingFont];
  const contentWidth = twip(size.width - t.margin * 2);
  const align = t.nameAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      alignment: align,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: model.name,
          bold: true,
          size: pt(t.nameSize),
          font: head,
          color: hex(t.text),
        }),
      ],
    }),
  );
  if (model.headline) {
    children.push(
      new Paragraph({
        alignment: align,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: model.headline,
            size: pt(t.headlineSize),
            font: body,
            color: hex(t.muted),
          }),
        ],
      }),
    );
  }
  const contactRuns: (TextRun | ExternalHyperlink)[] = [];
  const addSep = () =>
    contactRuns.length &&
    contactRuns.push(
      new TextRun({ text: "  |  ", size: pt(t.smallSize), font: body, color: hex(t.muted) }),
    );
  for (const c of model.contact) {
    addSep();
    const run = new TextRun({ text: c, size: pt(t.smallSize), font: body, color: hex(t.muted) });
    contactRuns.push(
      c.includes("@") && !c.includes(" ")
        ? new ExternalHyperlink({ link: `mailto:${c}`, children: [run] })
        : run,
    );
  }
  for (const l of model.links) {
    addSep();
    contactRuns.push(
      new ExternalHyperlink({
        link: l.url,
        children: [
          new TextRun({
            text: l.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            size: pt(t.smallSize),
            font: body,
            color: hex(t.muted),
          }),
        ],
      }),
    );
  }
  if (contactRuns.length)
    children.push(
      new Paragraph({ alignment: align, spacing: { after: 120 }, children: contactRuns }),
    );

  const sectionHeading = (title: string) =>
    new Paragraph({
      spacing: { before: twip(t.sectionGap), after: 60 },
      keepNext: true,
      border:
        t.sectionStyle === "rule" || t.sectionStyle === "accent-caps"
          ? {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 4,
                color: hex(t.sectionStyle === "rule" ? t.text : t.accent),
                space: 1,
              },
            }
          : undefined,
      children: [
        new TextRun({
          text: t.sectionStyle === "plain" ? title : title.toUpperCase(),
          bold: true,
          size: pt(t.sectionSize),
          font: head,
          color: hex(t.sectionStyle === "accent-caps" ? t.accent : t.text),
          characterSpacing: t.sectionStyle === "plain" ? 0 : 12,
        }),
      ],
    });

  for (const section of model.sections) {
    children.push(sectionHeading(section.title));
    if (section.paragraph) {
      children.push(
        new Paragraph({
          spacing: { after: 60, line: 264 },
          children: [
            new TextRun({
              text: section.paragraph,
              size: pt(t.bodySize),
              font: body,
              color: hex(t.text),
            }),
          ],
        }),
      );
    }
    for (const row of section.inline ?? []) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            ...(row.label
              ? [
                  new TextRun({
                    text: `${row.label}: `,
                    bold: true,
                    size: pt(t.bodySize),
                    font: body,
                    color: hex(t.text),
                  }),
                ]
              : []),
            new TextRun({ text: row.text, size: pt(t.bodySize), font: body, color: hex(t.text) }),
          ],
        }),
      );
    }
    for (const [i, e] of (section.entries ?? []).entries()) {
      if (e.title) {
        const runs: TextRun[] = [
          new TextRun({
            text: e.title,
            bold: true,
            size: pt(t.bodySize + 0.5),
            font: body,
            color: hex(t.text),
          }),
        ];
        if (e.dates && t.datesPosition === "right")
          runs.push(
            new TextRun({
              text: `\t${e.dates}`,
              size: pt(t.smallSize),
              font: body,
              color: hex(t.muted),
            }),
          );
        children.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: i > 0 ? twip(t.itemGap) : 40, after: 10 },
            tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
            children: runs,
          }),
        );
        const sub = [e.subtitle, e.location, t.datesPosition === "inline" ? e.dates : null]
          .filter(Boolean)
          .join("  ·  ");
        if (sub) {
          children.push(
            new Paragraph({
              keepNext: e.bullets.length > 0,
              spacing: { after: 30 },
              children: [
                new TextRun({
                  text: sub,
                  italics: true,
                  size: pt(t.smallSize + 0.5),
                  font: body,
                  color: hex(t.muted),
                }),
              ],
            }),
          );
        }
      }
      if (e.description)
        children.push(
          new Paragraph({
            spacing: { after: 30 },
            children: [
              new TextRun({
                text: e.description,
                size: pt(t.bodySize),
                font: body,
                color: hex(t.text),
              }),
            ],
          }),
        );
      for (const b of e.bullets) {
        children.push(
          new Paragraph({
            numbering: { reference: "resume-bullets", level: 0 },
            spacing: { after: 20 },
            children: [
              new TextRun({ text: b.text, size: pt(t.bodySize), font: body, color: hex(t.text) }),
            ],
          }),
        );
      }
      if (e.meta)
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: e.meta, size: pt(t.smallSize), font: body, color: hex(t.muted) }),
            ],
          }),
        );
      if (e.link) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new ExternalHyperlink({
                link: e.link.url,
                children: [
                  new TextRun({
                    text: e.link.label,
                    size: pt(t.smallSize),
                    font: body,
                    color: hex(t.accent),
                    underline: {},
                  }),
                ],
              }),
            ],
          }),
        );
      }
    }
  }

  const document = new Document({
    creator: model.name,
    title: opts.title ?? `${model.name} — Resume`,
    description: "Generated by JOBHUNT OS Resume Studio",
    styles: {
      default: { document: { run: { font: body, size: pt(t.bodySize), color: hex(t.text) } } },
    },
    numbering: {
      config: [
        {
          reference: "resume-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: t.bullet,
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 280, hanging: 200 } } },
            },
          ],
        },
      ],
    },
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
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                    size: pt(t.smallSize - 0.5),
                    font: body,
                    color: hex(t.muted),
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}
