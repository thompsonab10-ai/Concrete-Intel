const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
        VerticalAlign } = require("docx");


function p(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
}
function t(text, opts = {}) { return new TextRun({ text: String(text || ""), ...opts }); }
function bold(text, opts = {}) { return t(text, { bold: true, ...opts }); }
function blank() { return p([t("")]); }
function rule() {
  return p([], { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "F5A623", space: 1 } }, spacing: { before: 0, after: 120 } });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body;
  const { address, bidForm, bidOutput, brand, jobInfo, prices, estimate } = body;

  const co = brand || {};
  const ji = jobInfo || {};
  const bf = bidForm || {};
  const P = prices || {};
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const jobNum = ji.jobNumber || `JOB-${now.getFullYear()}-001`;

  const sf = parseFloat(bf.sqft) || 0;
  const tk = parseFloat(bf.thickness) || 4;
  const cy = sf > 0 ? ((sf * (tk / 12)) / 27 * 1.05) : 0;

  // Build material rows
  const rows = [];

  // Concrete
  const psiKey = `concrete_${bf.psi || "3000"}`;
  const concreteItem = P[psiKey] || P.concrete_3000 || { label: `Ready-Mix ${bf.psi || "3000"} PSI`, price: 0, unit: "CY" };
  if (cy > 0) {
    rows.push({ cat: "CONCRETE", item: concreteItem.label, qty: `${cy.toFixed(1)} CY`, rate: concreteItem.price > 0 ? `$${concreteItem.price}/CY` : "", note: "Include 5% waste — confirm with supplier" });
  }

  // Rebar
  const rebarItem = P[bf.rebar];
  if (rebarItem && bf.rebar !== "none") {
    if (rebarItem.unit === "SF") {
      rows.push({ cat: "REINFORCEMENT", item: rebarItem.label, qty: `${sf} SF`, rate: `$${rebarItem.price}/SF`, note: "" });
    } else {
      const lbPerSF = bf.rebar?.includes("5") ? 0.85 : 0.55;
      const lb = Math.round(sf * lbPerSF);
      rows.push({ cat: "REINFORCEMENT", item: rebarItem.label, qty: `${lb} LB`, rate: `$${rebarItem.price}/LB`, note: "Verify spacing with structural drawings" });
    }
  }

  // Standard materials from price book
  const materialDefs = [
    { key: "vapor_barrier", qty: () => `${sf} SF`, note: '6-mil poly — overlap seams 12"' },
    { key: "curing_compound", qty: () => `${(sf / 200).toFixed(0)} GAL`, note: "1 gal per ~200 SF" },
    { key: "form_lumber", qty: () => `${Math.ceil(Math.sqrt(sf) * 4)} LF`, note: "Perimeter estimate — adjust for layout" },
    { key: "expansion_joint", qty: () => `${Math.ceil(Math.sqrt(sf) * 2)} LF`, note: "Every 10-12 ft in each direction" },
    { key: "concrete_sealer", qty: () => `${(sf / 200).toFixed(0)} GAL`, note: "Apply after cure — 1 gal per ~200 SF" },
  ];
  materialDefs.forEach(({ key, qty, note }) => {
    if (P[key]) rows.push({ cat: "MATERIALS", item: P[key].label, qty: qty(), rate: `$${P[key].price}/${P[key].unit}`, note });
  });

  // Equipment
  if (bf.accessDifficulty === "pump-required" && P.pump_truck) {
    rows.push({ cat: "EQUIPMENT", item: P.pump_truck.label, qty: "1 DAY", rate: `$${P.pump_truck.price}/DAY`, note: "Reserve 48hrs in advance" });
  }

  // Add blank rows for manual additions
  for (let i = 0; i < 4; i++) {
    rows.push({ cat: "", item: "", qty: "", rate: "", note: "" });
  }

  const catColors = { CONCRETE: "F5A623", REINFORCEMENT: "2196F3", MATERIALS: "4CAF50", EQUIPMENT: "9C27B0" };
  const border = { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const noBorder = { top: { style: BorderStyle.NIL }, bottom: { style: BorderStyle.NIL }, left: { style: BorderStyle.NIL }, right: { style: BorderStyle.NIL } };

  function cell(content, width, opts = {}) {
    return new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      shading: opts.shading || undefined,
      children: [p(Array.isArray(content) ? content : [content], { spacing: { before: 0, after: 0 } })]
    });
  }

  // Header row
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, shading: { fill: "1A1A1A", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [p([bold("CATEGORY", { color: "F5A623", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
      new TableCell({ borders, width: { size: 3000, type: WidthType.DXA }, shading: { fill: "1A1A1A", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [p([bold("ITEM / DESCRIPTION", { color: "F5A623", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
      new TableCell({ borders, width: { size: 1400, type: WidthType.DXA }, shading: { fill: "1A1A1A", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [p([bold("QTY TO ORDER", { color: "F5A623", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
      new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, shading: { fill: "1A1A1A", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [p([bold("UNIT RATE", { color: "F5A623", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
      new TableCell({ borders, width: { size: 2560, type: WidthType.DXA }, shading: { fill: "1A1A1A", type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [p([bold("NOTES", { color: "F5A623", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
    ]
  });

  const dataRows = rows.map((row, i) => {
    const shade = i % 2 === 0 ? "FFFFFF" : "FAFAFA";
    const catColor = catColors[row.cat] || "888888";
    return new TableRow({
      children: [
        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, shading: { fill: shade, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([row.cat ? bold(row.cat, { size: 16, color: catColor }) : t("")], { spacing: { before: 0, after: 0 } })] }),
        new TableCell({ borders, width: { size: 3000, type: WidthType.DXA }, shading: { fill: shade, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([bold(row.item)], { spacing: { before: 0, after: 0 } })] }),
        new TableCell({ borders, width: { size: 1400, type: WidthType.DXA }, shading: { fill: shade, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([bold(row.qty, { color: "1A1A1A" })], { spacing: { before: 0, after: 0 } })] }),
        new TableCell({ borders, width: { size: 1200, type: WidthType.DXA }, shading: { fill: shade, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([t(row.rate, { color: "555555", size: 18 })], { spacing: { before: 0, after: 0 } })] }),
        new TableCell({ borders, width: { size: 2560, type: WidthType.DXA }, shading: { fill: shade, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([t(row.note, { color: "888888", size: 18, italics: true })], { spacing: { before: 0, after: 0 } })] }),
      ]
    });
  });

  // Supplier confirmation table
  const confirmRows = [
    ["Supplier / Ready-Mix Co.", ""],
    ["Contact Name", ""],
    ["Pour Date Confirmed", ""],
    ["Delivery Time", ""],
    ["Confirmed By", ""],
    ["Confirmation #", ""],
  ];

  const confirmBorder = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  const confirmBorders = { top: confirmBorder, bottom: confirmBorder, left: confirmBorder, right: confirmBorder };

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
        }
      },
      children: [
        // Header
        p([t(co.companyName?.toUpperCase() || "CONCRETE CONTRACTOR", { bold: true, size: 28, font: "Arial" })]),
        p([t("MATERIAL TAKEOFF & ORDER LIST", { size: 20, color: "F5A623", bold: true })]),
        ...(co.licenseNumber ? [p([t(`License #${co.licenseNumber}`, { size: 18, color: "888888" })])] : []),
        ...(co.phone ? [p([t(co.phone, { size: 18, color: "888888" })])] : []),
        rule(),

        // Project summary
        p([bold("PROJECT:   "), t(ji.projectName || address || "—"), t("          "), bold("JOB #:   "), t(jobNum), t("          "), bold("DATE:   "), t(dateStr)]),
        p([bold("ADDRESS:   "), t(address || "—"), t("          "), bold("POUR TYPE:   "), t(bf.pourType || "—"), t("          "), bold("AREA:   "), t(sf > 0 ? `${sf} SF` : "—"), t("          "), bold("CONCRETE:   "), t(cy > 0 ? `${cy.toFixed(1)} CY` : "—")]),
        blank(),

        // Main table
        p([bold("MATERIAL ORDER LIST", { size: 22 })], { spacing: { before: 0, after: 120 } }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [1200, 3000, 1400, 1200, 2560],
          rows: [headerRow, ...dataRows],
        }),
        blank(),

        // Supplier confirmation
        p([bold("SUPPLIER CONFIRMATION", { size: 22 })], { spacing: { before: 120, after: 120 } }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 6860],
          rows: confirmRows.map(([label, _]) =>
            new TableRow({
              children: [
                new TableCell({ borders: confirmBorders, width: { size: 2500, type: WidthType.DXA }, shading: { fill: "F5F5F5", type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([bold(label, { size: 18 })], { spacing: { before: 0, after: 0 } })] }),
                new TableCell({ borders: confirmBorders, width: { size: 6860, type: WidthType.DXA }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [p([t("")], { spacing: { before: 0, after: 0 } })] }),
              ]
            })
          )
        }),
        blank(),

        // Signature
        p([t(`${co.companyName || ""}${co.licenseNumber ? ` — Lic# ${co.licenseNumber}` : ""}   |   ${jobNum}   |   ${dateStr}`, { size: 16, color: "AAAAAA" })], { alignment: AlignmentType.CENTER }),
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", "attachment; filename=MaterialList.docx");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.send(buffer);}
