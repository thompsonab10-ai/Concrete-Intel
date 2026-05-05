const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign, UnderlineType } = require("docx");


function p(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
}
function t(text, opts = {}) {
  return new TextRun({ text: String(text || ""), ...opts });
}
function bold(text) { return t(text, { bold: true }); }
function heading(text, level = HeadingLevel.HEADING_1) {
  return p([bold(text)], { heading: level, spacing: { before: 240, after: 120 } });
}
function rule() {
  return p([], { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "F5A623", space: 1 } }, spacing: { before: 0, after: 120 } });
}
function blank() { return p([t("")]); }

function infoTable(rows) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: rows.filter(r => r[1]).map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            borders, width: { size: 2800, type: WidthType.DXA },
            shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [p([bold(label)], { spacing: { before: 0, after: 0 } })]
          }),
          new TableCell({
            borders, width: { size: 6560, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [p([t(value)], { spacing: { before: 0, after: 0 } })]
          })
        ]
      })
    )
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { address, bidForm, bidOutput, brand, jobInfo, estimate } = body;

  const co = brand || {};
  const ji = jobInfo || {};
  const bf = bidForm || {};
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const jobNum = ji.jobNumber || `JOB-${now.getFullYear()}-001`;
  const bidNum = ji.bidNumber || jobNum;

  const expiryDate = ji.bidExpiry || (() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  })();

  const totalBid = estimate?.totalBid
    ? `$${estimate.totalBid.toLocaleString("en-US")}`
    : (() => {
        const m = (bidOutput || "").match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
        return m ? `$${m[1]}` : "[SEE ESTIMATE]";
      })();

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: "1A1A1A" },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "333333" },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        // ── HEADER ──────────────────────────────────────────
        p([t(co.companyName?.toUpperCase() || "CONCRETE CONTRACTOR", { bold: true, size: 32, font: "Arial" })]),
        p([t(co.tagline || "Concrete Subcontractor", { size: 18, color: "888888" })]),
        ...(co.licenseNumber ? [p([t(`License #${co.licenseNumber}`, { size: 18, color: "888888" })])] : []),
        ...(co.phone ? [p([t(co.phone, { size: 18, color: "888888" })])] : []),
        ...(co.email ? [p([t(co.email, { size: 18, color: "888888" })])] : []),
        rule(),

        // ── DOC INFO ────────────────────────────────────────
        p([bold("BID PROPOSAL"), t(`   ${bidNum}`, { color: "888888" })], { alignment: AlignmentType.RIGHT }),
        p([t(`Date: ${dateStr}`, { color: "888888" })], { alignment: AlignmentType.RIGHT }),
        p([t(`Valid Until: ${expiryDate}`, { color: "F5A623", bold: true })], { alignment: AlignmentType.RIGHT }),
        blank(),

        // ── TO / FROM ───────────────────────────────────────
        heading("SUBMITTED TO", HeadingLevel.HEADING_2),
        infoTable([
          ["Client / Owner", ji.clientName || ""],
          ["General Contractor", ji.gcName || ""],
          ["PO / Contract #", ji.poNumber || ""],
        ]),
        blank(),

        heading("SUBMITTED BY", HeadingLevel.HEADING_2),
        infoTable([
          ["Company", co.companyName || ""],
          ["License #", co.licenseNumber || ""],
          ["Phone", co.phone || ""],
          ["Email", co.email || ""],
          ["City / State", co.city && co.state ? `${co.city}, ${co.state}` : ""],
        ]),
        blank(),

        // ── PROJECT INFO ─────────────────────────────────────
        heading("PROJECT INFORMATION", HeadingLevel.HEADING_1),
        rule(),
        infoTable([
          ["Project Name", ji.projectName || ""],
          ["Job Number", jobNum],
          ["Job Site Address", address || ""],
          ["Pour Type", bf.pourType || ""],
          ["Area (SF)", bf.sqft ? `${bf.sqft} SF` : ""],
          ["Thickness", bf.thickness ? `${bf.thickness}"` : ""],
          ["Concrete Strength", bf.psi ? `${bf.psi} PSI` : ""],
          ["Finish Type", bf.finishType || ""],
          ["Site Access", bf.accessDifficulty || ""],
        ]),
        blank(),

        // ── TOTAL BID ────────────────────────────────────────
        p([
          t("TOTAL BID PRICE:   ", { bold: true, size: 28 }),
          t(totalBid, { bold: true, size: 36, color: "2E7D32" }),
        ], { spacing: { before: 240, after: 240 } }),
        p([t("All materials, labor, and equipment included unless noted in exclusions below.", { size: 18, color: "666666" })]),
        blank(),

        // ── DETAILED ESTIMATE ────────────────────────────────
        heading("DETAILED ESTIMATE", HeadingLevel.HEADING_1),
        rule(),
        ...(bidOutput || "").split("\n").map(line =>
          p([t(line || " ", { font: "Courier New", size: 18 })], { spacing: { before: 0, after: 0 } })
        ),
        blank(),

        // ── FORMING & SITE NOTES ─────────────────────────────
        heading("FORMING & SITE NOTES", HeadingLevel.HEADING_1),
        rule(),
        p([t("[ Edit this section to add forming notes, special conditions, access requirements, scheduling constraints, or any other site-specific information relevant to this project. ]", { color: "999999", italics: true })]),
        blank(),

        // ── RISK FLAGS ───────────────────────────────────────
        heading("RISK FLAGS & ASSUMPTIONS", HeadingLevel.HEADING_1),
        rule(),
        p([t("[ Edit this section to document any risks, assumptions, or conditions that could affect scope or pricing. Examples: soil conditions, weather dependencies, utility conflicts, permit status, third-party coordination requirements. ]", { color: "999999", italics: true })]),
        blank(),

        // ── EXCLUSIONS ───────────────────────────────────────
        heading("EXCLUSIONS", HeadingLevel.HEADING_1),
        rule(),
        ...([
          "Permits and inspection fees",
          "Soil testing, compaction testing, or geotechnical work",
          "Underground utility locates or relocation",
          "Survey or layout staking",
          "Disposal of existing concrete or debris",
          "Work not specifically described in the scope above",
          "[ Add additional exclusions as needed ]",
        ].map(item => p([t(`• ${item}`, { size: 20 })], { spacing: { before: 60, after: 60 } }))),
        blank(),

        // ── TERMS & CONDITIONS ───────────────────────────────
        heading("TERMS & CONDITIONS", HeadingLevel.HEADING_1),
        rule(),
        ...([
          ["Validity", `This proposal is valid for 30 days from the date above (${dateStr}). Pricing is subject to change after the expiration date.`],
          ["Scope", "This bid covers the concrete scope described above only. Any additional work, changes in scope, or unforeseen conditions will be addressed via written change order prior to execution."],
          ["Payment", "Payment terms: Net 30 days from invoice date. A retainage of [X]% may be withheld per contract terms. Interest of 1.5% per month will accrue on balances past due."],
          ["Materials", "All materials are subject to availability and current market pricing. Significant material price increases after bid acceptance may require pricing adjustment by mutual agreement."],
          ["Weather", "Work is contingent upon suitable weather conditions. Delays caused by weather, owner, or third parties are not the responsibility of the contractor."],
          ["Acceptance", "This proposal becomes a binding subcontract agreement upon signature by both parties below."],
          ["[ Edit T&Cs ]", "[ Add, remove, or modify any terms and conditions to match your standard contract language. ]"],
        ].map(([label, text]) =>
          p([bold(`${label}: `), t(text)], { spacing: { before: 120, after: 120 } })
        )),
        blank(),

        // ── SIGNATURE BLOCK ──────────────────────────────────
        heading("SIGNATURES", HeadingLevel.HEADING_1),
        rule(),
        p([t("By signing below, both parties agree to the terms of this proposal.")], { spacing: { after: 480 } }),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "333333" }, top: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
                  width: { size: 4200, type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 0, right: 240 },
                  children: [p([t(" ")])]
                }),
                new TableCell({
                  borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "333333" }, top: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
                  width: { size: 4200, type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 240, right: 0 },
                  children: [p([t(" ")])]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { top: { style: BorderStyle.NIL }, bottom: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
                  width: { size: 4200, type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 0, right: 240 },
                  children: [
                    p([bold(co.companyName || "Contractor")], { spacing: { before: 80, after: 20 } }),
                    p([t("Authorized Representative"), t("          Date: ___________", { color: "999999" })], { spacing: { before: 0, after: 0 } }),
                  ]
                }),
                new TableCell({
                  borders: { top: { style: BorderStyle.NIL }, bottom: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } },
                  width: { size: 4200, type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 240, right: 0 },
                  children: [
                    p([bold(ji.clientName || ji.gcName || "Client / GC")], { spacing: { before: 80, after: 20 } }),
                    p([t("Authorized Representative"), t("          Date: ___________", { color: "999999" })], { spacing: { before: 0, after: 0 } }),
                  ]
                }),
              ]
            }),
          ]
        }),

        blank(),
        p([t(`${co.companyName || ""}${co.licenseNumber ? ` — Lic# ${co.licenseNumber}` : ""}   |   ${bidNum}   |   ${dateStr}`, { size: 16, color: "AAAAAA" })], { alignment: AlignmentType.CENTER }),
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="BidProposal_${jobNum.replace(/[^a-z0-9]/gi, "_")}.docx"`,
      "Access-Control-Allow-Origin": "*",
    }
  });
}
