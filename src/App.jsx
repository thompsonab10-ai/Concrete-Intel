import { useState, useRef, useEffect } from "react";

const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const PHASES = ["SITE INTEL", "BID ENGINE", "AS-BUILT", "CHANGE ORDER", "SUB SCOPE", "JOB HISTORY", "PRICE BOOK", "SETTINGS"];

// ── Default prices — contractor overrides these in PRICE BOOK ────────
const DEFAULT_PRICES = {
  // Concrete by PSI
  concrete_2500: { price: 142, unit: "CY", label: "Ready-Mix 2500 PSI", group: "Concrete" },
  concrete_3000: { price: 155, unit: "CY", label: "Ready-Mix 3000 PSI", group: "Concrete" },
  concrete_3500: { price: 165, unit: "CY", label: "Ready-Mix 3500 PSI", group: "Concrete" },
  concrete_4000: { price: 178, unit: "CY", label: "Ready-Mix 4000 PSI", group: "Concrete" },
  concrete_4500: { price: 192, unit: "CY", label: "Ready-Mix 4500 PSI", group: "Concrete" },
  concrete_5000: { price: 210, unit: "CY", label: "Ready-Mix 5000 PSI", group: "Concrete" },
  // Reinforcement
  rebar_4:       { price: 0.68,  unit: "LB",  label: "#4 Rebar (installed)", group: "Reinforcement" },
  rebar_5:       { price: 0.72,  unit: "LB",  label: "#5 Rebar (installed)", group: "Reinforcement" },
  wwf:           { price: 0.18,  unit: "SF",  label: "WWF 6x6 W1.4", group: "Reinforcement" },
  // Materials
  vapor_barrier:    { price: 0.12, unit: "SF",  label: "6-mil Poly Vapor Barrier", group: "Materials" },
  curing_compound:  { price: 0.08, unit: "SF",  label: "Curing Compound (sprayable)", group: "Materials" },
  form_lumber:      { price: 0.95, unit: "LF",  label: "2x6 Form Lumber", group: "Materials" },
  form_stakes:      { price: 0.45, unit: "EA",  label: "Form Stakes", group: "Materials" },
  expansion_joint:  { price: 0.65, unit: "LF",  label: "Expansion Joint (1/2\")", group: "Materials" },
  concrete_sealer:  { price: 0.12, unit: "SF",  label: "Concrete Sealer", group: "Materials" },
  // Equipment
  pump_truck:       { price: 1400, unit: "DAY", label: "Concrete Pump Truck", group: "Equipment" },
  bull_float:       { price: 45,   unit: "DAY", label: "Bull Float (rental)", group: "Equipment" },
  power_trowel:     { price: 125,  unit: "DAY", label: "Power Trowel (rental)", group: "Equipment" },
  plate_compactor:  { price: 185,  unit: "DAY", label: "Plate Compactor (rental)", group: "Equipment" },
  concrete_saw:     { price: 150,  unit: "DAY", label: "Concrete Saw (rental)", group: "Equipment" },
  // Labor — hourly wages
  foreman:          { price: 68,   unit: "HR",  label: "Foreman / Lead", group: "Labor" },
  journeyman:       { price: 58,   unit: "HR",  label: "Journeyman Finisher", group: "Labor" },
  laborer:          { price: 42,   unit: "HR",  label: "Laborer", group: "Labor" },
  rebar_crew:       { price: 52,   unit: "HR",  label: "Rebar Crew", group: "Labor" },
  // Labor — per SF rates (for quick pricing)
  placement_labor:  { price: 1.20, unit: "SF",  label: "Placement Labor (per SF)", group: "Labor" },
  finishing_labor:  { price: 2.85, unit: "SF",  label: "Finishing Labor (per SF)", group: "Labor" },
  forming_labor:    { price: 1.10, unit: "SF",  label: "Forming Labor (per SF)", group: "Labor" },
};

const inputStyle = {
  background: "#1a1a1a",
  border: "1px solid #444",
  color: "#f0ece0",
  padding: "10px 14px",
  fontFamily: "'Courier New', monospace",
  fontSize: "13px",
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

const labelStyle = {
  fontSize: "10px",
  letterSpacing: "2px",
  color: "#f5a623",
  fontFamily: "'Courier New', monospace",
  marginBottom: "6px",
  display: "block",
};

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: "9px", letterSpacing: "3px", color: "#666",
      fontFamily: "'Courier New', monospace", borderBottom: "1px solid #2a2a2a",
      paddingBottom: "8px", marginBottom: "16px",
    }}>{children}</div>
  );
}

function StatusBar({ text, type = "idle" }) {
  const colors = { idle: "#444", loading: "#f5a623", success: "#4caf50", error: "#e53935" };
  return (
    <div style={{
      background: "#111", border: `1px solid ${colors[type]}`, color: colors[type],
      padding: "8px 14px", fontFamily: "'Courier New', monospace", fontSize: "11px",
      letterSpacing: "1px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px",
    }}>
      {type === "loading" && <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>}
      {type === "success" && "✓"}{type === "error" && "✗"}{text}
    </div>
  );
}

function OutputPanel({ content, title, accent = "#f5a623" }) {
  if (!content) return null;
  return (
    <div style={{
      background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: `3px solid ${accent}`, padding: "16px", marginTop: "16px",
    }}>
      <div style={{ ...labelStyle, color: accent, marginBottom: "12px" }}>{title}</div>
      <pre style={{
        color: "#c8bfa8", fontFamily: "'Courier New', monospace", fontSize: "12px",
        whiteSpace: "pre-wrap", lineHeight: "1.7", margin: 0,
      }}>{content}</pre>
    </div>
  );
}

// ── Markup Calculator ──────────────────────────────────────────────
function MarkupCalculator({ bidOutput }) {
  const [markup, setMarkup] = useState({ overhead: 12, profit: 10, contingency: 5 });
  const [baseCost, setBaseCost] = useState("");

  const parseBaseCost = () => {
    // Try auto-parse from bid output first
    if (bidOutput) {
      const match = bidOutput.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
      if (match) return parseFloat(match[1].replace(/,/g, ""));
    }
    // Fall back to manual entry
    return parseFloat(baseCost) || 0;
  };

  const autoParsed = bidOutput && /TOTAL\s+BID[^$\d]*\$?([\d,]+)/i.test(bidOutput);

  const base = parseBaseCost();
  const overheadAmt = base * (markup.overhead / 100);
  const profitAmt = (base + overheadAmt) * (markup.profit / 100);
  const contingencyAmt = base * (markup.contingency / 100);
  const totalBid = base + overheadAmt + profitAmt + contingencyAmt;
  const margin = totalBid > 0 ? ((totalBid - base) / totalBid * 100).toFixed(1) : 0;

  return (
    <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #4caf50", padding: "16px", marginTop: "16px" }}>
      <div style={{ ...labelStyle, color: "#4caf50", marginBottom: "12px" }}>MARKUP CALCULATOR</div>

      {autoParsed ? (
        <div style={{ marginBottom: "12px", background: "#0d1a0d", border: "1px solid #4caf5033", padding: "8px 12px", fontSize: "11px", color: "#4caf50", letterSpacing: "1px" }}>
          ✓ AUTO-PARSED FROM BID OUTPUT
        </div>
      ) : (
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>MANUAL BASE COST ENTRY {bidOutput ? "(TOTAL BID not found — enter manually)" : ""}</label>
          <input style={inputStyle} type="number" placeholder="Enter total bid cost..." value={baseCost} onChange={e => setBaseCost(e.target.value)} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
        {[
          { key: "overhead", label: "OVERHEAD %" },
          { key: "profit", label: "PROFIT %" },
          { key: "contingency", label: "CONTINGENCY %" },
        ].map(({ key, label }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            <input
              style={{ ...inputStyle, textAlign: "center" }}
              type="number"
              value={markup[key]}
              onChange={e => setMarkup({ ...markup, [key]: parseFloat(e.target.value) || 0 })}
            />
          </div>
        ))}
      </div>

      <div style={{ background: "#111", border: "1px solid #2a2a2a", padding: "12px", fontFamily: "'Courier New', monospace", fontSize: "12px" }}>
        {[
          ["Base Cost", base],
          ["Overhead", overheadAmt],
          ["Profit", profitAmt],
          ["Contingency", contingencyAmt],
        ].map(([label, amt]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", color: "#888", marginBottom: "4px" }}>
            <span>{label}</span><span>${amt.toLocaleString("en-US", { minimumFractionDigits: 0 })}</span>
          </div>
        ))}
        <div style={{ borderTop: "1px solid #333", paddingTop: "8px", marginTop: "8px", display: "flex", justifyContent: "space-between", color: "#4caf50", fontWeight: "bold" }}>
          <span>FINAL BID PRICE</span>
          <span>${totalBid.toLocaleString("en-US", { minimumFractionDigits: 0 })}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#666", fontSize: "11px", marginTop: "4px" }}>
          <span>Gross Margin</span><span>{margin}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Material Pricing Panel ─────────────────────────────────────────
function MaterialPricingPanel({ sqft, thickness, psi, rebar, accessDifficulty, prices }) {
  const P = prices || DEFAULT_PRICES;
  const sf = parseFloat(sqft) || 0;
  const tk = parseFloat(thickness) || 4;
  const cy = sf > 0 ? ((sf * (tk / 12)) / 27 * 1.05).toFixed(1) : 0;

  const psiKey = `concrete_${psi}`;
  const concPrice = P[psiKey] || P.concrete_3000;
  const concCost = (parseFloat(cy) * concPrice.price);

  let rebarCost = 0, rebarLabel = "-";
  if (rebar === "wwf") { rebarCost = sf * P.wwf.price; rebarLabel = `${sf} SF × $${P.wwf.price}/SF`; }
  else if (rebar === "yes") { const lb = sf * 0.55; rebarCost = lb * P.rebar_4.price; rebarLabel = `${lb.toFixed(0)} LB × $${P.rebar_4.price}/LB`; }
  else if (rebar === "heavy") { const lb = sf * 0.85; rebarCost = lb * P.rebar_5.price; rebarLabel = `${lb.toFixed(0)} LB × $${P.rebar_5.price}/LB`; }

  const vaporCost = sf * P.vapor_barrier.price;
  const curingCost = sf * P.curing_compound.price;
  const formLF = sf > 0 ? Math.sqrt(sf) * 4 : 0;
  const formCost = formLF * P.form_lumber.price;
  const pumpCost = accessDifficulty === "pump-required" ? P.pump_truck.price : 0;
  const finishCost = sf * P.finishing_labor.price;
  const placeCost = sf * P.placement_labor.price;
  const totalMat = concCost + rebarCost + vaporCost + curingCost + formCost + pumpCost;
  const totalLab = finishCost + placeCost;

  const rows = [
    { label: concPrice.label, qty: `${cy} CY`, cost: concCost },
    rebar !== "none" && { label: "Reinforcement", qty: rebarLabel, cost: rebarCost },
    { label: "Vapor Barrier", qty: `${sf} SF`, cost: vaporCost },
    { label: "Curing Compound", qty: `${sf} SF`, cost: curingCost },
    { label: "Form Lumber", qty: `${formLF.toFixed(0)} LF`, cost: formCost },
    accessDifficulty === "pump-required" && { label: "Pump Truck", qty: "1 DAY", cost: pumpCost },
    { label: "Placement Labor", qty: `${sf} SF`, cost: placeCost },
    { label: "Finishing Labor", qty: `${sf} SF`, cost: finishCost },
  ].filter(Boolean);

  return (
    <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #2196f3", padding: "16px", marginTop: "16px" }}>
      <div style={{ ...labelStyle, color: "#2196f3", marginBottom: "4px" }}>LIVE TAKEOFF — YOUR PRICE BOOK</div>
      <div style={{ fontSize: "10px", color: "#444", letterSpacing: "1px", marginBottom: "12px" }}>UPDATE RATES IN PRICE BOOK TAB</div>
      {sf === 0 ? (
        <div style={{ color: "#444", fontSize: "11px", letterSpacing: "1px" }}>ENTER SQUARE FOOTAGE TO CALCULATE TAKEOFF</div>
      ) : (
        <>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: "11px" }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr", gap: "4px", color: "#888", marginBottom: "4px", padding: "4px 0", borderBottom: "1px solid #1a1a1a" }}>
                <span style={{ color: "#c8bfa8" }}>{row.label}</span>
                <span>{row.qty}</span>
                <span style={{ textAlign: "right", color: "#f0ece0" }}>${row.cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "12px" }}>
            {[
              { label: "MATERIALS", val: totalMat, color: "#2196f3" },
              { label: "LABOR", val: totalLab, color: "#9c27b0" },
              { label: "TOTAL DIRECT", val: totalMat + totalLab, color: "#f5a623" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: "#111", border: `1px solid ${color}33`, padding: "8px", textAlign: "center" }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color, marginBottom: "4px" }}>{label}</div>
                <div style={{ color, fontSize: "14px", fontWeight: "bold" }}>${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Job History Panel ──────────────────────────────────────────────
function JobHistoryPanel({ jobs, onLoad, onDelete }) {
  const [expandedKey, setExpandedKey] = useState(null);

  if (jobs.length === 0) return (
    <div style={{ color: "#444", fontSize: "11px", letterSpacing: "1px", textAlign: "center", padding: "60px 0" }}>
      NO SAVED JOBS<br /><span style={{ fontSize: "10px", marginTop: "8px", display: "block" }}>SAVE YOUR FIRST BID TO SEE IT HERE</span>
    </div>
  );

  // Group by projectKey
  const grouped = {};
  jobs.forEach(job => {
    const key = job.projectKey || `legacy_${job.id}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(job);
  });

  // Sort each group by version descending
  Object.values(grouped).forEach(group => group.sort((a, b) => (b.version || 1) - (a.version || 1)));

  // Sort groups by latest job date
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => b[0].id - a[0].id);

  return (
    <div>
      {sortedGroups.map(([key, revisions]) => {
        const latest = revisions[0];
        const isExpanded = expandedKey === key;
        const hasMultiple = revisions.length > 1;

        return (
          <div key={key} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", marginBottom: "12px" }}>
            {/* Project header */}
            <div style={{ padding: "12px", borderBottom: hasMultiple ? "1px solid #1a1a1a" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#f0ece0", fontSize: "13px", marginBottom: "2px" }}>
                    {latest.jobInfo?.projectName || latest.address || "NO ADDRESS"}
                  </div>
                  {latest.jobInfo?.projectName && <div style={{ color: "#666", fontSize: "10px", marginBottom: "2px" }}>{latest.address}</div>}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{ background: "#f5a62322", color: "#f5a623", border: "1px solid #f5a62344", borderRadius: "4px", padding: "1px 6px", fontSize: "9px", letterSpacing: "1px" }}>
                      v{latest.version || 1} — LATEST
                    </span>
                    {hasMultiple && <span style={{ color: "#555", fontSize: "9px", letterSpacing: "1px" }}>{revisions.length} REVISIONS</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "8px" }}>
                  <button onClick={() => onLoad(latest)} style={{ background: "#f5a623", color: "#000", border: "none", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>LOAD</button>
                  {hasMultiple && (
                    <button onClick={() => setExpandedKey(isExpanded ? null : key)} style={{ background: "transparent", color: "#2196f3", border: "1px solid #2196f344", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>
                      {isExpanded ? "▲" : "▼"} REVS
                    </button>
                  )}
                  <button onClick={() => onDelete(latest.id)} style={{ background: "transparent", color: "#e53935", border: "1px solid #e5393544", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                {[
                  { l: "POUR TYPE", v: latest.bidForm?.pourType || "-" },
                  { l: "SQUARE FT", v: latest.bidForm?.sqft ? `${latest.bidForm.sqft} SF` : "-" },
                  { l: "THICKNESS", v: latest.bidForm?.thickness ? `${latest.bidForm.thickness}"` : "-" },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: "#111", padding: "5px 8px" }}>
                    <div style={{ fontSize: "8px", letterSpacing: "1px", color: "#555", marginBottom: "2px" }}>{l}</div>
                    <div style={{ fontSize: "10px", color: "#888" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Revision history — expanded */}
            {isExpanded && (
              <div style={{ padding: "8px 12px" }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#555", marginBottom: "8px" }}>ALL REVISIONS</div>
                {revisions.map(rev => (
                  <div key={rev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", marginBottom: "4px", background: "#111", border: "1px solid #1a1a1a" }}>
                    <div>
                      <span style={{ background: rev.version === latest.version ? "#f5a62322" : "#1a1a1a", color: rev.version === latest.version ? "#f5a623" : "#666", border: `1px solid ${rev.version === latest.version ? "#f5a62344" : "#2a2a2a"}`, borderRadius: "4px", padding: "1px 6px", fontSize: "9px", marginRight: "8px" }}>
                        v{rev.version || 1}
                      </span>
                      <span style={{ color: "#666", fontSize: "10px" }}>{rev.savedAt}</span>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => onLoad(rev)} style={{ background: "transparent", color: "#f5a623", border: "1px solid #f5a62344", padding: "4px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>LOAD</button>
                      <button onClick={() => onDelete(rev.id)} style={{ background: "transparent", color: "#e53935", border: "1px solid #e5393544", padding: "4px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── PDF Export (Blob download — no popup blocker) ──────────────────
function exportToPDF(address, bidForm, bidOutput, brand = {}, jobInfo = {}) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const filename = `BidEstimate_${(address || "JobSite").replace(/[^a-z0-9]/gi, "_").slice(0, 30)}_${new Date().toISOString().slice(0,10)}.html`;
  const coName = brand.companyName || "CONCRETE SITE INTELLIGENCE";
  const coSub = brand.companyName ? "FIELD OPS PLATFORM" : "BID ESTIMATE — CONFIDENTIAL";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BID ESTIMATE — ${coName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; background: #fff; color: #111; padding: 48px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 3px solid #f5a623; padding-bottom: 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end; }
  .co-name { font-size: 22px; font-weight: bold; letter-spacing: 2px; }
  .co-sub { font-size: 10px; letter-spacing: 3px; color: #f5a623; margin-top: 4px; }
  .co-meta { font-size: 11px; color: #888; margin-top: 2px; }
  .doc-date { font-size: 11px; color: #888; letter-spacing: 1px; text-align: right; }
  .contact-block { font-size: 10px; color: #888; text-align: right; line-height: 1.7; margin-top: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 28px; background: #f9f9f9; padding: 16px; border-left: 4px solid #f5a623; }
  .meta-item label { font-size: 8px; letter-spacing: 2px; color: #888; display: block; margin-bottom: 4px; text-transform: uppercase; }
  .meta-item span { font-size: 12px; font-weight: bold; }
  .output { white-space: pre-wrap; line-height: 1.9; font-size: 12px; border-top: 1px solid #eee; padding-top: 24px; }
  .footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 9px; color: #aaa; letter-spacing: 1px; display: flex; justify-content: space-between; }
  @media print { body { padding: 24px; } @page { margin: 1in; } }
</style></head><body>
<div class="header">
  <div>
    <div class="co-name">${coName.toUpperCase()}</div>
    <div class="co-sub">${coSub.toUpperCase()}</div>
    ${brand.licenseNumber ? `<div class="co-meta">LIC# ${brand.licenseNumber}</div>` : ""}
    ${brand.tagline ? `<div class="co-meta" style="color:#999;font-style:italic">${brand.tagline}</div>` : ""}
  </div>
  <div>
    <div class="doc-date">${date}</div>
    <div class="contact-block">
      ${brand.phone ? `${brand.phone}<br/>` : ""}
      ${brand.email ? `${brand.email}<br/>` : ""}
      ${brand.city && brand.state ? `${brand.city}, ${brand.state}<br/>` : ""}
      ${brand.website ? `${brand.website}` : ""}
    </div>
  </div>
</div>
<div class="meta">
  <div class="meta-item"><label>Job Site Address</label><span>${address || "Not specified"}</span></div>
  <div class="meta-item"><label>Pour Type</label><span>${bidForm.pourType || "-"}</span></div>
  <div class="meta-item"><label>Square Footage</label><span>${bidForm.sqft || "-"} SF</span></div>
  <div class="meta-item"><label>Thickness</label><span>${bidForm.thickness || "-"}"</span></div>
  <div class="meta-item"><label>Concrete Strength</label><span>${bidForm.psi || "-"} PSI</span></div>
  <div class="meta-item"><label>Finish Type</label><span>${bidForm.finishType || "-"}</span></div>
  ${jobInfo.projectName ? `<div class="meta-item"><label>Project Name</label><span>${jobInfo.projectName}</span></div>` : ""}
  ${jobInfo.clientName ? `<div class="meta-item"><label>Client</label><span>${jobInfo.clientName}</span></div>` : ""}
  ${jobInfo.gcName ? `<div class="meta-item"><label>General Contractor</label><span>${jobInfo.gcName}</span></div>` : ""}
  ${jobInfo.bidNumber ? `<div class="meta-item"><label>Bid Number</label><span>${jobInfo.bidNumber}</span></div>` : ""}
  ${jobInfo.poNumber ? `<div class="meta-item"><label>PO / Contract #</label><span>${jobInfo.poNumber}</span></div>` : ""}
  ${jobInfo.bidExpiry ? `<div class="meta-item"><label>Bid Expiry</label><span>${jobInfo.bidExpiry}</span></div>` : ""}
</div>
<div class="output">${(bidOutput || "No bid generated.").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
<div class="footer">
  <span>${coName.toUpperCase()}${brand.licenseNumber ? ` — LIC# ${brand.licenseNumber}` : ""}</span>
  <span>VERIFY ALL FIGURES WITH LOCAL SUPPLIER QUOTES BEFORE SUBMITTING</span>
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Leaflet Map Component ──────────────────────────────────────────
function LeafletMap({ address }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error

  useEffect(() => {
    if (!address) return;

    // Load Leaflet CSS + JS dynamically
    const loadLeaflet = () => new Promise((resolve) => {
      if (window.L) { resolve(); return; }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = resolve;
      document.head.appendChild(script);
    });

    const initMap = async () => {
      setStatus("loading");
      await loadLeaflet();

      // Geocode via Nominatim
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
        const data = await res.json();
        if (!data.length) { setStatus("error"); return; }

        const { lat, lon, display_name } = data[0];
        const L = window.L;

        // Destroy existing map instance
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }

        const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true });
        mapInstanceRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        map.setView([parseFloat(lat), parseFloat(lon)], 17);

        L.marker([parseFloat(lat), parseFloat(lon)])
          .addTo(map)
          .bindPopup(`<b>${address}</b><br/><small>${display_name}</small>`)
          .openPopup();

        setStatus("success");
      } catch {
        setStatus("error");
      }
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [address]);

  return (
    <div style={{ position: "relative", border: "1px solid #2a2a2a", height: "500px" }}>
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, flexDirection: "column", color: "#f5a623", fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "2px" }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: "20px", marginBottom: "12px" }}>◌</span>
          GEOCODING ADDRESS...
        </div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, flexDirection: "column", color: "#e53935", fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "2px" }}>
          ✗ ADDRESS NOT FOUND — CHECK FORMAT
        </div>
      )}
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────
export default function ConcreteIntelTool() {
  const [phase, setPhase] = useState(0);
  const [address, setAddress] = useState("");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const addressDebounce = useRef(null);
  const suggestionsRef = useRef(null);

  const [brand, setBrand] = useState({
    companyName: "", licenseNumber: "", phone: "", email: "", website: "", city: "", state: "", tagline: "",
  });

  const [prices, setPrices] = useState(() => {
    const p = {};
    Object.entries(DEFAULT_PRICES).forEach(([k, v]) => { p[k] = { ...v }; });
    return p;
  });
  const [newPriceItem, setNewPriceItem] = useState({ label: "", price: "", unit: "SF", group: "Materials" });
  const [editingPriceKey, setEditingPriceKey] = useState(null);

  const [jobInfo, setJobInfo] = useState({
    clientName: "", gcName: "", projectName: "", bidNumber: "", bidExpiry: "", poNumber: "",
  });

  const [bidForm, setBidForm] = useState({
    pourType: "slab-on-grade", sqft: "", thickness: "4", psi: "3000",
    rebar: "yes", accessDifficulty: "standard", finishType: "broom", notes: "",
  });
  const [bidOutput, setBidOutput] = useState("");
  const [bidStatus, setBidStatus] = useState({ text: "AWAITING INPUT", type: "idle" });
  const [showMarkup, setShowMarkup] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showJobInfo, setShowJobInfo] = useState(false);

  // Change order state
  const [coForm, setCoForm] = useState({
    description: "", reason: "", scopeChanges: "", scheduleImpact: "",
    // Cost calculator
    addedSF: "", addedThickness: "4", rebarType: "none", addedLaborHours: "", addedLaborRole: "laborer",
    equipmentDays: "", equipmentType: "pump_truck",
    manualOverride: false, manualCostImpact: "",
  });
  const [coOutput, setCoOutput] = useState("");
  const [coStatus, setCoStatus] = useState({ text: "AWAITING INPUT", type: "idle" });

  // Sub Scope state
  const [scopeForm, setScopeForm] = useState({
    subName: "", subTrade: "Concrete", projectName: "", projectAddress: "",
    gcName: "", bidDueDate: "", workStartDate: "", scopeDescription: "",
    inclusions: "", exclusions: "", specialRequirements: "",
  });
  const [scopeOutput, setScopeOutput] = useState("");
  const [scopeStatus, setScopeStatus] = useState({ text: "AWAITING INPUT", type: "idle" });

  const [sitePhotos, setSitePhotos] = useState([]); // [{name, base64, preview}]
  const [asBuiltOutput, setAsBuiltOutput] = useState("");
  const [asBuiltStatus, setAsBuiltStatus] = useState({ text: "NO PHOTOS LOADED", type: "idle" });

  const [jobs, setJobs] = useState([]);
  const [savedMsg, setSavedMsg] = useState("");
  const [currentJobKey, setCurrentJobKey] = useState(null); // tracks which job we're revising

  const fileRef = useRef();
  const jobsRef = useRef([]);
  jobsRef.current = jobs;

  // ── Persistent Storage (window.storage API) ──────────────────────
  const loadJobsFromStorage = async () => {
    try {
      const keys = await window.storage.list("job:");
      const loaded = [];
      for (const key of (keys?.keys || [])) {
        try {
          const res = await window.storage.get(key);
          if (res?.value) loaded.push(JSON.parse(res.value));
        } catch {}
      }
      loaded.sort((a, b) => b.id - a.id);
      setJobs(loaded);
    } catch { /* storage not available */ }
  };

  const loadBrandFromStorage = async () => {
    try {
      const res = await window.storage.get("brand:settings");
      if (res?.value) setBrand(JSON.parse(res.value));
    } catch {}
  };

  const loadPricesFromStorage = async () => {
    try {
      const res = await window.storage.get("prices:book");
      if (res?.value) {
        const saved = JSON.parse(res.value);
        // Merge saved over defaults so new keys added in updates still appear
        const merged = {};
        Object.entries(DEFAULT_PRICES).forEach(([k, v]) => {
          merged[k] = saved[k] ? { ...v, price: saved[k].price } : { ...v };
        });
        setPrices(merged);
      }
    } catch {}
  };

  const savePrices = async (updated) => {
    try { await window.storage.set("prices:book", JSON.stringify(updated)); } catch {}
    setPrices(updated);
  };

  const saveBrand = async (updated) => {
    try { await window.storage.set("brand:settings", JSON.stringify(updated)); } catch {}
    setBrand(updated);
  };

  const fetchSuggestions = async (query) => {
    if (!query || query.length < 3) { setSuggestions([]); return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1&countrycodes=us`, {
        headers: { "Accept-Language": "en" }
      });
      const data = await res.json();
      setSuggestions(data.map(d => d.display_name));
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
  };

  useEffect(() => { loadJobsFromStorage(); loadBrandFromStorage(); loadPricesFromStorage(); }, []);

  const saveJob = async () => {
    if (!bidOutput) return;

    // Determine project key — group by address + project name
    const projectKey = `${address || "no-address"}__${jobInfo.projectName || "no-project"}`;

    // Find existing revisions for this project
    const existingRevisions = jobs.filter(j => j.projectKey === projectKey);
    const nextVersion = existingRevisions.length > 0
      ? Math.max(...existingRevisions.map(j => j.version || 1)) + 1
      : 1;

    const job = {
      id: Date.now(),
      projectKey,
      version: nextVersion,
      address,
      jobInfo: { ...jobInfo },
      bidForm: { ...bidForm },
      bidOutput,
      savedAt: new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    };

    try {
      await window.storage.set(`job:${job.id}`, JSON.stringify(job));
      await loadJobsFromStorage();
    } catch {
      setJobs(prev => [job, ...prev]);
    }
    setCurrentJobKey(projectKey);
    setSavedMsg(`v${nextVersion} SAVED ✓`);
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const deleteJob = async (id) => {
    try {
      await window.storage.delete(`job:${id}`);
      await loadJobsFromStorage();
    } catch {
      setJobs(prev => prev.filter(j => j.id !== id));
    }
  };

  const loadJob = (job) => {
    setAddress(job.address || "");
    setBidForm(job.bidForm);
    setBidOutput(job.bidOutput);
    if (job.jobInfo) setJobInfo(job.jobInfo);
    setCurrentJobKey(job.projectKey || null);
    setBidStatus({ text: `v${job.version || 1} LOADED FROM HISTORY`, type: "success" });
    setPhase(1);
  };

  // ── Claude API ───────────────────────────────────────────────────
  const callClaude = async (systemPrompt, userPrompt, imageData = null) => {
    const content = imageData
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: imageData } },
          { type: "text", text: userPrompt },
        ]
      : userPrompt;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || "No response.";
  };

  const runBidEngine = async () => {
    if (!bidForm.sqft) return;
    setBidStatus({ text: "CALCULATING TAKEOFFS...", type: "loading" });
    setBidOutput("");
    const system = `You are a senior concrete estimator with 20+ years of field experience.
Produce a structured concrete bid estimate using PLAIN TEXT ONLY.
CRITICAL FORMATTING RULES:
- NO markdown, NO asterisks, NO pound signs, NO pipe tables, NO bold/italic
- Use plain line items like: "Ready-Mix 3000 PSI  39 CY @ $155  $6,045"
- Use the EXACT section headers and EXACT summary format shown below

=== MATERIAL TAKEOFF ===
[plain text line items: description  qty  unit  @  unit price  =  total]

=== LABOR ESTIMATE ===
[plain text: role  crew size  hours  rate  total]

=== EQUIPMENT ===
[plain text line items]

=== SUBCONTRACTOR / SPECIALTY ===
[plain text line items]

=== SUMMARY ===
Subtotal Materials: $X,XXX
Subtotal Labor:     $X,XXX
Subtotal Equipment: $X,XXX
Overhead (12%):     $X,XXX
Profit (10%):       $X,XXX
─────────────────────────
TOTAL BID:          $XX,XXX

=== FORMING NOTES ===
[2-3 plain text sentences]

=== RISK FLAGS ===
- [risk item 1]
- [risk item 2]
- [risk item 3]

Be specific with numbers. Use current market rates (2025). PLAIN TEXT ONLY — no markdown formatting.`;
    const priceRef = Object.entries(prices)
      .map(([k, v]) => `${v.label}: $${v.price}/${v.unit}`)
      .join("\n");

    const user = `Job Address: ${address || "Not specified"}
Pour Type: ${bidForm.pourType}
Square Footage: ${bidForm.sqft} SF
Thickness: ${bidForm.thickness} inches
Concrete Strength: ${bidForm.psi} PSI
Rebar Required: ${bidForm.rebar}
Access/Site Difficulty: ${bidForm.accessDifficulty}
Finish Type: ${bidForm.finishType}
Additional Notes: ${bidForm.notes || "None"}
${jobInfo.projectName ? `Project: ${jobInfo.projectName}` : ""}
${jobInfo.clientName ? `Client: ${jobInfo.clientName}` : ""}
${jobInfo.gcName ? `GC: ${jobInfo.gcName}` : ""}

CONTRACTOR PRICE BOOK — USE THESE EXACT RATES (do not substitute other prices):
${priceRef}

Generate a detailed bid estimate using ONLY the prices listed above.`;
    try {
      const raw = await callClaude(system, user);
      // Strip residual markdown formatting as safety net
      const result = raw
        .replace(/\*\*([^*]+)\*\*/g, "$1")   // bold
        .replace(/\*([^*]+)\*/g, "$1")         // italic
        .replace(/^#{1,3}\s+/gm, "")           // headers
        .replace(/^\|.+\|$/gm, l =>            // pipe tables → plain lines
          l.replace(/\|/g, " ").replace(/\s{2,}/g, "  ").trim()
        )
        .replace(/^[-]{3,}$/gm, "─".repeat(25)); // hr lines
      setBidOutput(result);
      setBidStatus({ text: "BID COMPLETE — REVIEW BEFORE SUBMITTING", type: "success" });
    } catch {
      setBidStatus({ text: "ERROR — CHECK CONNECTION", type: "error" });
    }
  };

  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAsBuiltStatus({ text: `LOADING ${files.length} PHOTO${files.length > 1 ? "S" : ""}...`, type: "loading" });
    const readers = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        base64: reader.result.split(",")[1],
        preview: reader.result,
        mediaType: file.type || "image/jpeg",
      });
      reader.readAsDataURL(file);
    }));
    Promise.all(readers).then(loaded => {
      setSitePhotos(prev => [...prev, ...loaded].slice(0, 8)); // cap at 8 photos
      setAsBuiltStatus({ text: `${loaded.length} PHOTO${loaded.length > 1 ? "S" : ""} LOADED — READY TO ANALYZE`, type: "idle" });
    });
  };

  const runAsBuilt = async () => {
    if (!sitePhotos.length) return;
    setAsBuiltStatus({ text: `ANALYZING ${sitePhotos.length} SITE PHOTO${sitePhotos.length > 1 ? "S" : ""}...`, type: "loading" });
    setAsBuiltOutput("");

    const system = `You are an experienced concrete construction superintendent analyzing job site photos.
Based on what you can see in the photos, produce a structured field progress report.
PLAIN TEXT ONLY — no markdown, no asterisks.

=== SCOPE SUMMARY ===
[What work is visible in the photos — be specific about what type of concrete work]

=== PROGRESS ESTIMATE ===
Foundation/Footings:   __% complete
Slab Work:             __% complete
Walls/Columns:         __% complete
Forming:               __% complete
Finishing:             __% complete
Overall:               __% complete
[1-2 sentence justification based on what is visible]

=== OBSERVED CONDITIONS ===
[Specific observations: concrete quality, surface finish, rebar placement, form alignment, curing, etc.]

=== PUNCH LIST ===
□ [Item based on what you see that still needs work or correction]
□ [Continue for each item observed]

=== INSPECTION READINESS ===
Ready for: [inspections that appear ready based on photos]
Not ready for: [what still needs to happen before inspection]

=== CONCERNS / FLAGS ===
[Any visible quality issues, safety concerns, or items that need GC attention]

=== CLOSEOUT DOCUMENTATION NEEDED ===
[Standard closeout docs for this scope of concrete work]

Be specific to what you actually see. If a photo is unclear, say so for that item.`;

    // Build multi-image content array
    const imageContent = sitePhotos.flatMap(photo => [
      { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
    ]);
    const userContent = [
      ...imageContent,
      { type: "text", text: `Analyze these ${sitePhotos.length} job site photos for a concrete project at: ${address || "address not provided"}. Project: ${jobInfo.projectName || "not specified"}. Produce a full field progress report.` },
    ];

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 2500,
          system,
          messages: [{ role: "user", content: userContent }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const result = (data.content?.[0]?.text || "No response.")
        .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s+/gm, "");
      setAsBuiltOutput(result);
      setAsBuiltStatus({ text: "FIELD REPORT COMPLETE", type: "success" });
    } catch (e) {
      setAsBuiltStatus({ text: `ERROR: ${e.message || "TRY AGAIN"}`, type: "error" });
    }
  };

  const runChangeOrder = async () => {
    if (!coForm.description) return;
    setCoStatus({ text: "GENERATING CHANGE ORDER...", type: "loading" });
    setCoOutput("");
    const sys = `You are a construction contract administrator with 20+ years of experience in concrete subcontracting.
Generate a professional change order document in PLAIN TEXT ONLY. No markdown, no asterisks, no pound signs.
Use this exact format:

CHANGE ORDER #[auto-number]
Date: [today]
Project: [project name]
Contractor: [contractor name]
Client / GC: [client name]

═══════════════════════════════════════════
DESCRIPTION OF CHANGE
═══════════════════════════════════════════
[Clear description of what changed and why]

═══════════════════════════════════════════
SCOPE CHANGES
═══════════════════════════════════════════
Added Scope:
- [item]

Deleted Scope:
- [item or "None"]

Modified Scope:
- [item or "None"]

═══════════════════════════════════════════
COST IMPACT
═══════════════════════════════════════════
[Line item breakdown of cost changes]

Additional Labor:     $X,XXX
Additional Materials: $X,XXX
Equipment:            $X,XXX
Overhead (12%):       $X,XXX
Profit (10%):         $X,XXX
───────────────────────────────────────────
NET CHANGE:           +$X,XXX  [or -$X,XXX]

Original Contract:    $XX,XXX
This Change Order:    +$X,XXX
REVISED CONTRACT:     $XX,XXX

═══════════════════════════════════════════
SCHEDULE IMPACT
═══════════════════════════════════════════
[Impact on project timeline, if any]

═══════════════════════════════════════════
TERMS & CONDITIONS
═══════════════════════════════════════════
- This change order must be signed by both parties before work begins.
- All other contract terms remain unchanged.
- Work will proceed upon receipt of signed change order.

═══════════════════════════════════════════
SIGNATURES
═══════════════════════════════════════════
Contractor: _________________________ Date: _________
${brand.companyName || "Contractor Company"}

Client/GC: __________________________ Date: _________
${jobInfo.gcName || jobInfo.clientName || "Client / General Contractor"}

PLAIN TEXT ONLY. Be specific and professional.`;

    const usr = `Generate a change order for this concrete project:
Project: ${jobInfo.projectName || address || "Not specified"}
Contractor: ${brand.companyName || "Not specified"}
Client / GC: ${jobInfo.gcName || jobInfo.clientName || "Not specified"}
Original Bid Address: ${address || "Not specified"}
Pour Type: ${bidForm.pourType}, ${bidForm.sqft} SF, ${bidForm.thickness}" thick, ${bidForm.psi} PSI

Change Description: ${coForm.description}
Reason for Change: ${coForm.reason || "Field conditions / Owner request"}
Scope Changes: ${coForm.scopeChanges || "As described above"}
Estimated Cost Impact: ${coForm.manualOverride ? (coForm.manualCostImpact || "To be calculated") : (() => {
      const P = prices;
      const sf = parseFloat(coForm.addedSF || 0);
      const tk = parseFloat(coForm.addedThickness || 4);
      const cy = sf > 0 ? (sf * (tk / 12)) / 27 * 1.05 : 0;
      const concreteCost = cy * (P[`concrete_${bidForm.psi}`]?.price || P.concrete_3000?.price || 155);
      const rebarLbPerSF = coForm.rebarType === "yes" ? 0.55 : coForm.rebarType === "heavy" ? 0.85 : 0;
      const rebarCost = coForm.rebarType === "wwf" ? sf * (P.wwf?.price || 0.18) : sf * rebarLbPerSF * (P[coForm.rebarType === "heavy" ? "rebar_5" : "rebar_4"]?.price || 0.68);
      const laborCost = parseFloat(coForm.addedLaborHours || 0) * (P[coForm.addedLaborRole]?.price || P.laborer?.price || 42);
      const equipCost = parseFloat(coForm.equipmentDays || 0) * (P[coForm.equipmentType]?.price || 0);
      const sfCost = sf * ((P.placement_labor?.price || 1.20) + (P.finishing_labor?.price || 2.85));
      const subtotal = concreteCost + rebarCost + sfCost + laborCost + equipCost;
      const total = subtotal * 1.12 * 1.10;
      return total > 0 ? `+$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${sf} SF @ ${tk}" thick = ${cy.toFixed(1)} CY + labor + OH/profit)` : "To be calculated";
    })()}
Schedule Impact: ${coForm.scheduleImpact || "None anticipated"}`;

    try {
      const raw = await callClaude(sys, usr);
      const result = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s+/gm, "");
      setCoOutput(result);
      setCoStatus({ text: "CHANGE ORDER COMPLETE — REVIEW BEFORE SENDING", type: "success" });
    } catch (e) {
      setCoStatus({ text: `ERROR: ${e.message || "CHECK CONNECTION"}`, type: "error" });
    }
  };

  const exportChangeOrder = () => {
    if (!coOutput) return;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const filename = `ChangeOrder_${(jobInfo.projectName || address || "Project").replace(/[^a-z0-9]/gi, "_").slice(0, 30)}_${new Date().toISOString().slice(0, 10)}.html`;
    const coName = brand.companyName || "CONCRETE SITE INTELLIGENCE";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CHANGE ORDER</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; background:#fff; color:#111; padding:48px; max-width:900px; margin:0 auto; }
  .header { border-bottom:3px solid #e53935; padding-bottom:20px; margin-bottom:28px; display:flex; justify-content:space-between; align-items:flex-end; }
  .co-name { font-size:20px; font-weight:bold; letter-spacing:2px; }
  .co-sub { font-size:10px; letter-spacing:3px; color:#e53935; margin-top:4px; }
  .co-meta { font-size:10px; color:#888; margin-top:2px; }
  .contact { font-size:10px; color:#888; text-align:right; line-height:1.7; }
  .output { white-space:pre-wrap; line-height:1.9; font-size:12px; margin-top:8px; }
  .footer { margin-top:48px; border-top:1px solid #ddd; padding-top:16px; font-size:9px; color:#aaa; display:flex; justify-content:space-between; }
  @media print { body { padding:24px; } @page { margin:1in; } }
</style></head><body>
<div class="header">
  <div>
    <div class="co-name">${coName.toUpperCase()}</div>
    <div class="co-sub">CHANGE ORDER DOCUMENT</div>
    ${brand.licenseNumber ? `<div class="co-meta">LIC# ${brand.licenseNumber}</div>` : ""}
  </div>
  <div class="contact">
    <div>${date}</div>
    ${brand.phone ? `<div>${brand.phone}</div>` : ""}
    ${brand.email ? `<div>${brand.email}</div>` : ""}
    ${brand.city && brand.state ? `<div>${brand.city}, ${brand.state}</div>` : ""}
  </div>
</div>
<div class="output">${coOutput.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
<div class="footer">
  <span>${coName.toUpperCase()}${brand.licenseNumber ? ` — LIC# ${brand.licenseNumber}` : ""}</span>
  <span>BOTH PARTIES MUST SIGN BEFORE WORK BEGINS</span>
</div>
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const runSubScope = async () => {
    if (!scopeForm.scopeDescription) return;
    setScopeStatus({ text: "GENERATING SCOPE LETTER...", type: "loading" });
    setScopeOutput("");

    const sys = `You are a construction contract administrator specializing in concrete subcontracting. 
Generate a professional subcontractor scope of work letter in PLAIN TEXT ONLY. No markdown, no asterisks.
Use this exact format:

[Date]

[Sub Company Name]
[Trade] Subcontractor

RE: REQUEST FOR PROPOSAL — [Project Name]

Dear [Sub Name / Sir or Madam],

We are soliciting a proposal from your firm for the following scope of work on the above-referenced project. Please review the scope carefully and submit your pricing by the bid due date.

═══════════════════════════════════════════
PROJECT INFORMATION
═══════════════════════════════════════════
Project Name:      [project]
Project Address:   [address]
General Contractor: [GC name]
Bid Due Date:      [date]
Anticipated Start: [start date]

═══════════════════════════════════════════
SCOPE OF WORK
═══════════════════════════════════════════
[Detailed description of work required]

═══════════════════════════════════════════
INCLUSIONS
═══════════════════════════════════════════
The following items ARE included in this scope:
- [item]
- [item]

═══════════════════════════════════════════
EXCLUSIONS
═══════════════════════════════════════════
The following items are NOT included and must be provided by others:
- [item]
- [item]

═══════════════════════════════════════════
SPECIAL REQUIREMENTS
═══════════════════════════════════════════
[Any special conditions, safety requirements, scheduling constraints]

═══════════════════════════════════════════
PROPOSAL REQUIREMENTS
═══════════════════════════════════════════
Please include the following with your proposal:
- Lump sum base bid
- Any applicable unit prices
- Schedule of values if applicable
- Confirmation of insurance requirements
- List of any clarifications or qualifications

Please direct all questions to the undersigned. We look forward to receiving your proposal.

Sincerely,

${brand.companyName || "___________________________"}
${brand.phone || ""}
${brand.email || ""}

PLAIN TEXT ONLY. Be specific and professional.`;

    const usr = `Generate a subcontractor scope letter with these details:
Sub Company: ${scopeForm.subName || "Subcontractor"}
Trade: ${scopeForm.subTrade}
Project: ${scopeForm.projectName || address || "Not specified"}
Project Address: ${scopeForm.projectAddress || address || "Not specified"}
GC: ${scopeForm.gcName || jobInfo.gcName || "Not specified"}
Bid Due: ${scopeForm.bidDueDate || "TBD"}
Work Start: ${scopeForm.workStartDate || "TBD"}
Scope: ${scopeForm.scopeDescription}
Inclusions: ${scopeForm.inclusions || "Standard for this trade"}
Exclusions: ${scopeForm.exclusions || "Permits, inspection fees, bond"}
Special Requirements: ${scopeForm.specialRequirements || "None"}
Our Company: ${brand.companyName || "Not specified"}`;

    try {
      const raw = await callClaude(sys, usr);
      const result = raw.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/^#{1,3}\s+/gm, "");
      setScopeOutput(result);
      setScopeStatus({ text: "SCOPE LETTER COMPLETE — REVIEW BEFORE SENDING", type: "success" });
    } catch (e) {
      setScopeStatus({ text: `ERROR: ${e.message || "CHECK CONNECTION"}`, type: "error" });
    }
  };

  const exportSubScope = () => {
    if (!scopeOutput) return;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const fn = `ScopeOfWork_${(scopeForm.subName || "Sub").replace(/[^a-z0-9]/gi, "_").slice(0, 20)}_${new Date().toISOString().slice(0, 10)}.html`;
    const cn = brand.companyName || "CONCRETE SITE INTELLIGENCE";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SCOPE OF WORK</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;background:#fff;color:#111;padding:48px;max-width:900px;margin:0 auto}.header{border-bottom:3px solid #f5a623;padding-bottom:20px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end}.co-name{font-size:20px;font-weight:bold;letter-spacing:2px}.co-sub{font-size:10px;letter-spacing:3px;color:#f5a623;margin-top:4px}.co-meta{font-size:10px;color:#888;margin-top:2px}.contact{font-size:10px;color:#888;text-align:right;line-height:1.7}.output{white-space:pre-wrap;line-height:1.9;font-size:12px}.footer{margin-top:48px;border-top:1px solid #ddd;padding-top:16px;font-size:9px;color:#aaa;display:flex;justify-content:space-between}@media print{body{padding:24px}@page{margin:1in}}</style>
</head><body>
<div class="header"><div><div class="co-name">${cn.toUpperCase()}</div><div class="co-sub">SUBCONTRACTOR SCOPE OF WORK</div>${brand.licenseNumber ? `<div class="co-meta">LIC# ${brand.licenseNumber}</div>` : ""}</div>
<div class="contact"><div>${date}</div>${brand.phone ? `<div>${brand.phone}</div>` : ""}${brand.email ? `<div>${brand.email}</div>` : ""}</div></div>
<div class="output">${scopeOutput.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
<div class="footer"><span>${cn.toUpperCase()}</span><span>CONFIDENTIAL — FOR BIDDING PURPOSES ONLY</span></div>
</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fn;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const mapSrc = address
    ? `https://www.openstreetmap.org/export/embed.html?layer=mapnik&query=${encodeURIComponent(address)}`
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f0ece0", fontFamily: "'Courier New', monospace", padding: "0" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input:focus, select:focus, textarea:focus { border-color: #f5a623 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; }
        button:hover { opacity: 0.85; transform: translateY(-1px); }
        button { transition: all 0.15s; }
        input, select, textarea { font-size: 16px !important; }
        @media (max-width: 768px) {
          .panel-container { flex-direction: column !important; height: auto !important; overflow: visible !important; }
          .left-panel { width: 100% !important; min-width: 100% !important; border-right: none !important; border-bottom: 1px solid #1e1e1e; max-height: none !important; }
          .right-panel { min-height: 50vh; }
          .tab-bar { overflow-x: auto !important; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; }
          .tab-bar button { padding: 11px 14px !important; font-size: 9px !important; flex-shrink: 0; }
          .header-bar { padding: 12px 16px !important; }
          .header-bar .co-name { font-size: 14px !important; }
          .address-bar { padding: 10px 16px !important; }
          .form-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Header */}
      <div className="header-bar" style={{ background: "#111", borderBottom: "2px solid #f5a623", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#f5a623", marginBottom: "2px" }}>
            {brand.companyName ? brand.companyName.toUpperCase() : "CONCRETE SITE INTELLIGENCE"}
          </div>
          <div style={{ fontSize: "18px", fontWeight: "bold", letterSpacing: "1px" }}>
            {brand.companyName ? "FIELD OPS PLATFORM" : "FIELD OPS PLATFORM"}
            <span style={{ fontSize: "10px", color: "#f5a623", letterSpacing: "2px", marginLeft: "8px" }}>v2.0</span>
          </div>
          {brand.licenseNumber && <div style={{ fontSize: "10px", color: "#555", letterSpacing: "1px", marginTop: "2px" }}>LIC# {brand.licenseNumber}</div>}
        </div>
        <div style={{ fontSize: "10px", color: "#555", textAlign: "right", letterSpacing: "1px" }}>
          {brand.phone && <div style={{ color: "#888", marginBottom: "2px" }}>{brand.phone}</div>}
          <div>POWERED BY CLAUDE AI</div>
          <div style={{ color: "#4caf50", marginTop: "2px" }}>● LIVE</div>
          <div style={{ color: "#2196f3", marginTop: "2px", fontSize: "9px" }}>{jobs.length} SAVED JOB{jobs.length !== 1 ? "S" : ""}</div>
        </div>
      </div>

      {/* Address Bar */}
      {/* Address Bar with Autocomplete */}
      <div className="address-bar" style={{ background: "#111", padding: "12px 24px", borderBottom: "1px solid #1e1e1e", position: "relative", zIndex: 100 }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              style={{ ...inputStyle, fontSize: "14px", padding: "10px 14px" }}
              placeholder="ENTER JOB SITE ADDRESS..."
              value={address}
              onChange={e => {
                const val = e.target.value;
                setAddress(val);
                setMapLoaded(false);
                clearTimeout(addressDebounce.current);
                addressDebounce.current = setTimeout(() => fetchSuggestions(val), 350);
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && address) { setShowSuggestions(false); setMapLoaded(true); }
                if (e.key === "Escape") setShowSuggestions(false);
              }}
              onFocus={() => suggestions.length && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div ref={suggestionsRef} style={{
                position: "absolute", top: "100%", left: 0, right: 0,
                background: "#1a1a1a", border: "1px solid #f5a623", borderTop: "none",
                zIndex: 200, maxHeight: "220px", overflowY: "auto",
              }}>
                {suggestions.map((s, i) => (
                  <div key={i}
                    onMouseDown={() => {
                      setAddress(s);
                      setSuggestions([]);
                      setShowSuggestions(false);
                      setMapLoaded(true);
                    }}
                    style={{
                      padding: "10px 14px", fontSize: "12px", color: "#c8bfa8",
                      fontFamily: "'Courier New', monospace", cursor: "pointer",
                      borderBottom: "1px solid #2a2a2a", letterSpacing: "0.3px",
                      lineHeight: "1.4",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#2a2a2a"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    📍 {s}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => { setShowSuggestions(false); address && setMapLoaded(true); }} style={{ background: "#f5a623", color: "#000", border: "none", padding: "10px 20px", fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "2px", fontWeight: "bold", cursor: "pointer", whiteSpace: "nowrap" }}>
            LOAD SITE ▶
          </button>
        </div>
      </div>

      {/* Phase Tabs */}
      <div className="tab-bar" style={{ display: "flex", borderBottom: "1px solid #1e1e1e", background: "#0d0d0d", overflowX: "auto" }}>
        {PHASES.map((p, i) => (
          <button key={p} onClick={() => setPhase(i)} style={{
            background: phase === i ? "#1a1a1a" : "transparent",
            color: phase === i ? "#f5a623" : "#555",
            border: "none", borderBottom: phase === i ? "2px solid #f5a623" : "2px solid transparent",
            padding: "12px 20px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}>{p}{p === "JOB HISTORY" && jobs.length > 0 && <span style={{ marginLeft: "6px", background: "#f5a623", color: "#000", borderRadius: "8px", padding: "1px 6px", fontSize: "9px" }}>{jobs.length}</span>}</button>
        ))}
      </div>

      {/* Content */}
      <div className="panel-container" style={{ display: "flex", height: "calc(100vh - 168px)", overflow: "hidden" }}>

        {/* Left Panel */}
        <div className="left-panel" style={{ width: "380px", minWidth: "380px", overflowY: "auto", borderRight: "1px solid #1e1e1e", padding: "20px" }}>

          {/* PHASE 0: Site Intel */}
          {phase === 0 && (
            <>
              <SectionLabel>SITE OVERVIEW</SectionLabel>
              {mapLoaded && address ? (
                <div style={{ background: "#111", border: "1px solid #2a2a2a", padding: "12px", marginBottom: "16px" }}>
                  <div style={labelStyle}>SITE ADDRESS</div>
                  <div style={{ color: "#fff", fontSize: "13px", marginBottom: "8px" }}>{address}</div>
                  <div style={{ fontSize: "10px", color: "#666", letterSpacing: "1px" }}>→ Map loaded. Switch to BID ENGINE to estimate.</div>
                </div>
              ) : (
                <div style={{ color: "#444", fontSize: "12px", letterSpacing: "1px", textAlign: "center", padding: "40px 0" }}>
                  ENTER ADDRESS ABOVE<br />TO LOAD SITE MAP
                </div>
              )}
              <SectionLabel>WORKFLOW</SectionLabel>
              <div style={{ color: "#666", fontSize: "11px", lineHeight: "1.8", letterSpacing: "0.5px" }}>
                <div style={{ marginBottom: "8px" }}>① Enter job site address → Load satellite map</div>
                <div style={{ marginBottom: "8px" }}>② BID ENGINE → Fill scope → Generate bid + markup</div>
                <div style={{ marginBottom: "8px" }}>③ AS-BUILT → Upload iPhone site photos → Field report</div>
                <div style={{ marginBottom: "8px" }}>④ JOB HISTORY → Save, load, or delete past bids</div>
              </div>
            </>
          )}

          {/* PHASE 1: Bid Engine */}
          {phase === 1 && (
            <>
              <SectionLabel>POUR SPECIFICATIONS</SectionLabel>
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>POUR TYPE</label>
                <select style={inputStyle} value={bidForm.pourType} onChange={e => setBidForm({ ...bidForm, pourType: e.target.value })}>
                  <option value="slab-on-grade">Slab on Grade</option>
                  <option value="elevated-slab">Elevated Slab</option>
                  <option value="footing">Footings</option>
                  <option value="foundation-wall">Foundation Wall</option>
                  <option value="tilt-up">Tilt-Up Panel</option>
                  <option value="columns">Columns / Piers</option>
                  <option value="curb-gutter">Curb & Gutter</option>
                  <option value="flatwork-decorative">Decorative Flatwork</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={labelStyle}>SQUARE FEET</label>
                  <input style={inputStyle} type="number" placeholder="e.g. 2400" value={bidForm.sqft} onChange={e => setBidForm({ ...bidForm, sqft: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>THICKNESS (IN)</label>
                  <select style={inputStyle} value={bidForm.thickness} onChange={e => setBidForm({ ...bidForm, thickness: e.target.value })}>
                    {["3","4","5","6","8","10","12"].map(t => <option key={t} value={t}>{t}"</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={labelStyle}>CONCRETE PSI</label>
                  <select style={inputStyle} value={bidForm.psi} onChange={e => setBidForm({ ...bidForm, psi: e.target.value })}>
                    {["2500","3000","3500","4000","4500","5000"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>REBAR / WWF</label>
                  <select style={inputStyle} value={bidForm.rebar} onChange={e => setBidForm({ ...bidForm, rebar: e.target.value })}>
                    <option value="none">None</option>
                    <option value="wwf">WWF Only</option>
                    <option value="yes">#4 Rebar Grid</option>
                    <option value="heavy">#5 Heavy Rebar</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>SITE ACCESS DIFFICULTY</label>
                <select style={inputStyle} value={bidForm.accessDifficulty} onChange={e => setBidForm({ ...bidForm, accessDifficulty: e.target.value })}>
                  <option value="standard">Standard — Good truck access</option>
                  <option value="pump-required">Pump Required</option>
                  <option value="limited">Limited Access / Tight Site</option>
                  <option value="remote">Remote / Rural</option>
                </select>
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>FINISH TYPE</label>
                <select style={inputStyle} value={bidForm.finishType} onChange={e => setBidForm({ ...bidForm, finishType: e.target.value })}>
                  <option value="broom">Broom Finish</option>
                  <option value="smooth">Smooth / Steel Trowel</option>
                  <option value="exposed-aggregate">Exposed Aggregate</option>
                  <option value="stamped">Stamped</option>
                  <option value="polished">Polished</option>
                </select>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>ADDITIONAL NOTES</label>
                <textarea style={{ ...inputStyle, height: "70px", resize: "vertical" }} placeholder="Slopes, drains, special conditions..." value={bidForm.notes} onChange={e => setBidForm({ ...bidForm, notes: e.target.value })} />
              </div>

              <button onClick={runBidEngine} disabled={!bidForm.sqft || bidStatus.type === "loading"} style={{
                width: "100%", background: bidForm.sqft ? "#f5a623" : "#2a2a2a", color: bidForm.sqft ? "#000" : "#555",
                border: "none", padding: "14px", fontFamily: "'Courier New', monospace", fontSize: "11px",
                letterSpacing: "3px", fontWeight: "bold", cursor: bidForm.sqft ? "pointer" : "not-allowed", marginBottom: "8px",
              }}>
                {bidStatus.type === "loading" ? "CALCULATING..." : "▶ GENERATE BID ESTIMATE"}
              </button>

              {/* Toggle buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                <button onClick={() => setShowPricing(!showPricing)} style={{
                  background: showPricing ? "#1a2a3a" : "transparent", color: showPricing ? "#2196f3" : "#555",
                  border: `1px solid ${showPricing ? "#2196f3" : "#333"}`, padding: "8px",
                  fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer",
                }}>
                  {showPricing ? "▲" : "▼"} LIVE PRICING
                </button>
                <button onClick={() => setShowMarkup(!showMarkup)} style={{
                  background: showMarkup ? "#0d1a0d" : "transparent", color: showMarkup ? "#4caf50" : "#555",
                  border: `1px solid ${showMarkup ? "#4caf50" : "#333"}`, padding: "8px",
                  fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer",
                }}>
                  {showMarkup ? "▲" : "▼"} MARKUP CALC
                </button>
              </div>

              {/* Job / Client Info */}
              <button onClick={() => setShowJobInfo(!showJobInfo)} style={{
                width: "100%", background: showJobInfo ? "#1a1a2a" : "transparent", color: showJobInfo ? "#ff9800" : "#555",
                border: `1px solid ${showJobInfo ? "#ff9800" : "#333"}`, padding: "8px",
                fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer", marginBottom: showJobInfo ? "10px" : "0",
              }}>
                {showJobInfo ? "▲" : "▼"} CLIENT / JOB INFO
              </button>

              {showJobInfo && (
                <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #ff9800", padding: "14px", marginBottom: "8px" }}>
                  <div style={{ ...labelStyle, color: "#ff9800", marginBottom: "12px" }}>JOB & CLIENT DETAILS</div>
                  {[
                    { key: "projectName", label: "PROJECT NAME", placeholder: "Main St. Warehouse Slab" },
                    { key: "clientName", label: "CLIENT NAME", placeholder: "Acme Properties LLC" },
                    { key: "gcName", label: "GENERAL CONTRACTOR", placeholder: "BuildRight Construction" },
                    { key: "bidNumber", label: "BID NUMBER", placeholder: "BID-2025-047" },
                    { key: "poNumber", label: "PO / CONTRACT #", placeholder: "PO-88432" },
                    { key: "bidExpiry", label: "BID EXPIRY DATE", placeholder: "30 days from date" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key} style={{ marginBottom: "10px" }}>
                      <label style={labelStyle}>{label}</label>
                      <input style={inputStyle} placeholder={placeholder} value={jobInfo[key]} onChange={e => setJobInfo({ ...jobInfo, [key]: e.target.value })} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* PHASE 2: As-Built */}
          {phase === 2 && (
            <>
              <SectionLabel>SITE PHOTO UPLOAD</SectionLabel>

              {/* Upload zone */}
              <div onClick={() => fileRef.current?.click()} style={{
                border: "2px dashed #333", padding: "24px", textAlign: "center", cursor: "pointer",
                marginBottom: "12px", background: sitePhotos.length ? "#0d1a0d" : "#0d0d0d",
                borderColor: sitePhotos.length ? "#4caf50" : "#333",
              }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>📷</div>
                <div style={{ fontSize: "11px", letterSpacing: "2px", color: sitePhotos.length ? "#4caf50" : "#555" }}>
                  {sitePhotos.length ? `${sitePhotos.length} PHOTO${sitePhotos.length > 1 ? "S" : ""} LOADED` : "TAP TO ADD SITE PHOTOS"}
                </div>
                <div style={{ fontSize: "10px", color: "#444", marginTop: "6px" }}>JPG · PNG · HEIC — UP TO 8 PHOTOS</div>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handlePhotoUpload} />
              </div>

              {/* Photo thumbnails */}
              {sitePhotos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "12px" }}>
                  {sitePhotos.map((p, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={p.preview} alt={p.name} style={{ width: "100%", height: "70px", objectFit: "cover", border: "1px solid #2a2a2a" }} />
                      <button onClick={() => setSitePhotos(prev => prev.filter((_, j) => j !== i))} style={{
                        position: "absolute", top: "2px", right: "2px", background: "#e53935cc", color: "#fff",
                        border: "none", width: "18px", height: "18px", fontSize: "10px", lineHeight: "18px",
                        textAlign: "center", cursor: "pointer", padding: 0,
                      }}>✕</button>
                    </div>
                  ))}
                  {sitePhotos.length < 8 && (
                    <div onClick={() => fileRef.current?.click()} style={{ height: "70px", border: "1px dashed #333", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#444", fontSize: "20px" }}>+</div>
                  )}
                </div>
              )}

              <div style={{ background: "#111", border: "1px solid #2a2a2a", padding: "10px 12px", marginBottom: "12px" }}>
                {["Scope summary from photos", "Progress % by trade", "Observed site conditions", "Punch list items", "Inspection readiness", "Quality / safety flags", "Closeout docs needed"].map(item => (
                  <div key={item} style={{ fontSize: "10px", color: "#888", marginBottom: "3px" }}>→ {item}</div>
                ))}
              </div>

              <button onClick={runAsBuilt} disabled={!sitePhotos.length || asBuiltStatus.type === "loading"} style={{
                width: "100%", background: sitePhotos.length ? "#f5a623" : "#2a2a2a", color: sitePhotos.length ? "#000" : "#555",
                border: "none", padding: "13px", fontFamily: "'Courier New', monospace", fontSize: "11px",
                letterSpacing: "3px", fontWeight: "bold", cursor: sitePhotos.length ? "pointer" : "not-allowed", marginBottom: "8px",
              }}>
                {asBuiltStatus.type === "loading" ? `◌ ANALYZING ${sitePhotos.length} PHOTO${sitePhotos.length > 1 ? "S" : ""}...` : "▶ ANALYZE SITE PHOTOS"}
              </button>

              {asBuiltOutput && (
                <button onClick={() => { setAsBuiltOutput(""); setSitePhotos([]); setAsBuiltStatus({ text: "NO PHOTOS LOADED", type: "idle" }); }} style={{
                  width: "100%", background: "transparent", color: "#555", border: "1px solid #333",
                  padding: "8px", fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "2px", cursor: "pointer",
                }}>↺ CLEAR & START NEW REPORT</button>
              )}
            </>
          )}

          {/* PHASE 3: Change Order */}
          {phase === 3 && (
            <>
              <SectionLabel>CHANGE ORDER DETAILS</SectionLabel>
              <div style={{ background: "#111", border: "1px solid #e5393522", padding: "10px 12px", marginBottom: "14px", fontSize: "10px", color: "#888", letterSpacing: "0.5px", lineHeight: "1.7" }}>
                Pulls job info from Bid Engine. Fill in your BID ENGINE client details first for a fully branded change order.
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={labelStyle}>DESCRIPTION OF CHANGE *</label>
                <textarea style={{ ...inputStyle, height: "80px", resize: "vertical" }}
                  placeholder="e.g. Owner requested additional 400 SF slab extension on east side of building..."
                  value={coForm.description}
                  onChange={e => setCoForm({ ...coForm, description: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={labelStyle}>REASON FOR CHANGE</label>
                <input style={inputStyle} placeholder="Owner request / Field condition / Design change"
                  value={coForm.reason} onChange={e => setCoForm({ ...coForm, reason: e.target.value })} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={labelStyle}>SCOPE CHANGES</label>
                <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }}
                  placeholder="Add 400 SF slab, 4' thick, 3000 PSI with #4 rebar..."
                  value={coForm.scopeChanges}
                  onChange={e => setCoForm({ ...coForm, scopeChanges: e.target.value })}
                />
              </div>

              {/* Cost Impact Calculator */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label style={{ ...labelStyle, color: "#e53935", marginBottom: 0 }}>COST IMPACT CALCULATOR</label>
                  <button onClick={() => setCoForm({ ...coForm, manualOverride: !coForm.manualOverride })} style={{
                    background: coForm.manualOverride ? "#1a0d0d" : "transparent",
                    color: coForm.manualOverride ? "#e53935" : "#555",
                    border: `1px solid ${coForm.manualOverride ? "#e53935" : "#333"}`,
                    padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "8px", letterSpacing: "1px", cursor: "pointer",
                  }}>{coForm.manualOverride ? "← AUTO CALC" : "MANUAL ENTRY →"}</button>
                </div>

                {coForm.manualOverride ? (
                  <div>
                    <div style={{ fontSize: "10px", color: "#888", marginBottom: "8px" }}>Enter your own cost figure.</div>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#f5a623", fontSize: "13px" }}>$</span>
                      <input style={{ ...inputStyle, paddingLeft: "22px" }} type="number" placeholder="4200" value={coForm.manualCostImpact} onChange={e => setCoForm({ ...coForm, manualCostImpact: e.target.value })} />
                    </div>
                  </div>
                ) : (() => {
                  const P = prices;
                  const sfVal = parseFloat(coForm.addedSF || 0);
                  const tk = parseFloat(coForm.addedThickness || 4);
                  const cyVal = sfVal > 0 ? (sfVal * (tk / 12)) / 27 * 1.05 : 0;
                  const rebarLbPerSF = coForm.rebarType === "yes" ? 0.55 : coForm.rebarType === "heavy" ? 0.85 : 0;
                  const rebarCost = coForm.rebarType === "wwf" ? sfVal * (P.wwf?.price || 0.18)
                    : coForm.rebarType === "none" ? 0
                    : sfVal * rebarLbPerSF * (P[coForm.rebarType === "heavy" ? "rebar_5" : "rebar_4"]?.price || 0.68);
                  const laborHrs = parseFloat(coForm.addedLaborHours || 0);
                  const equipDays = parseFloat(coForm.equipmentDays || 0);
                  const concreteRate = P[`concrete_${bidForm.psi}`]?.price || P.concrete_3000?.price || 155;
                  const laborRate = P[coForm.addedLaborRole]?.price || P.laborer?.price || 42;
                  const equipRate = P[coForm.equipmentType]?.price || 0;
                  const concreteCost = cyVal * concreteRate;
                  const sfCost = sfVal * ((P.placement_labor?.price || 1.20) + (P.finishing_labor?.price || 2.85));
                  const laborCost = laborHrs * laborRate;
                  const equipCost = equipDays * equipRate;
                  const subtotal = concreteCost + rebarCost + sfCost + laborCost + equipCost;
                  const overhead = subtotal * 0.12;
                  const profit = (subtotal + overhead) * 0.10;
                  const total = subtotal + overhead + profit;
                  return (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                        <div><label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>ADDED SF</label><input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="0" value={coForm.addedSF} onChange={e => setCoForm({ ...coForm, addedSF: e.target.value })} /></div>
                        <div><label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>THICKNESS (IN)</label>
                          <select style={{ ...inputStyle, fontSize: "12px" }} value={coForm.addedThickness} onChange={e => setCoForm({ ...coForm, addedThickness: e.target.value })}>
                            {["3","4","5","6","8","10","12"].map(t => <option key={t} value={t}>{t}"</option>)}
                          </select>
                        </div>
                      </div>
                      {/* CY auto-calc display */}
                      {parseFloat(coForm.addedSF) > 0 && (
                        <div style={{ background: "#111", border: "1px solid #2a2a2a", padding: "6px 10px", marginBottom: "8px", fontSize: "10px", color: "#f5a623", fontFamily: "'Courier New', monospace" }}>
                          {(() => { const sf=parseFloat(coForm.addedSF||0); const tk=parseFloat(coForm.addedThickness||4); const cy=((sf*(tk/12))/27*1.05).toFixed(1); return `→ ${cy} CY concrete (incl. 5% waste)`; })()}
                        </div>
                      )}
                      <div style={{ marginBottom: "8px" }}>
                        <label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>REBAR / REINFORCEMENT</label>
                        <select style={{ ...inputStyle, fontSize: "12px" }} value={coForm.rebarType} onChange={e => setCoForm({ ...coForm, rebarType: e.target.value })}>
                          <option value="none">None</option>
                          <option value="wwf">WWF Only — ${prices.wwf?.price || 0.18}/SF</option>
                          <option value="yes">#4 Rebar Grid — ${prices.rebar_4?.price || 0.68}/LB</option>
                          <option value="heavy">#5 Heavy Rebar — ${prices.rebar_5?.price || 0.72}/LB</option>
                        </select>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                        <div><label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>LABOR HRS</label><input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="0" value={coForm.addedLaborHours} onChange={e => setCoForm({ ...coForm, addedLaborHours: e.target.value })} /></div>
                        <div><label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>EQUIP DAYS</label><input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="0" value={coForm.equipmentDays} onChange={e => setCoForm({ ...coForm, equipmentDays: e.target.value })} /></div>
                      </div>
                      <div style={{ marginBottom: "6px" }}>
                        <label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>LABOR ROLE</label>
                        <select style={{ ...inputStyle, fontSize: "12px" }} value={coForm.addedLaborRole} onChange={e => setCoForm({ ...coForm, addedLaborRole: e.target.value })}>
                          {[["foreman","Foreman"],["journeyman","Journeyman"],["laborer","Laborer"],["rebar_crew","Rebar Crew"]].map(([v,l]) => <option key={v} value={v}>{l} — ${P[v]?.price || "?"}/HR</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: "10px" }}>
                        <label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>EQUIPMENT TYPE</label>
                        <select style={{ ...inputStyle, fontSize: "11px" }} value={coForm.equipmentType} onChange={e => setCoForm({ ...coForm, equipmentType: e.target.value })}>
                          {[["pump_truck","Pump Truck"],["bull_float","Bull Float"],["power_trowel","Power Trowel"],["plate_compactor","Compactor"],["concrete_saw","Concrete Saw"]].map(([v,l]) => <option key={v} value={v}>{l} — ${P[v]?.price || "?"}/DAY</option>)}
                        </select>
                      </div>
                      {/* Live cost summary */}
                      <div style={{ background: "#111", border: "1px solid #e5393533", padding: "10px 12px", fontFamily: "'Courier New', monospace", fontSize: "11px" }}>
                        {[
                          concreteCost > 0 && [`Concrete (${cyVal.toFixed(1)} CY @ $${concreteRate})`, concreteCost],
                          sfCost > 0 && [`Placement + Finish (${sfVal} SF)`, sfCost],
                          rebarCost > 0 && [`Reinforcement (${coForm.rebarType === "wwf" ? "WWF" : coForm.rebarType === "heavy" ? "#5 Rebar" : "#4 Rebar"})`, rebarCost],
                          laborCost > 0 && [`${P[coForm.addedLaborRole]?.label || "Labor"} (${laborHrs} hrs)`, laborCost],
                          equipCost > 0 && [`${P[coForm.equipmentType]?.label || "Equipment"} (${equipDays} day${equipDays !== 1 ? "s" : ""})`, equipCost],
                          subtotal > 0 && ["Overhead (12%)", overhead],
                          subtotal > 0 && ["Profit (10%)", profit],
                        ].filter(Boolean).map(([l, v]) => (
                          <div key={l} style={{ display: "flex", justifyContent: "space-between", color: "#666", marginBottom: "3px" }}>
                            <span style={{ fontSize: "10px" }}>{l}</span><span>${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                          </div>
                        ))}
                        <div style={{ borderTop: "1px solid #333", marginTop: "6px", paddingTop: "6px", display: "flex", justifyContent: "space-between", color: total > 0 ? "#e53935" : "#444", fontWeight: "bold" }}>
                          <span>NET CHANGE</span>
                          <span>{total > 0 ? `+$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "$0"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>SCHEDULE IMPACT</label>
                <input style={inputStyle} placeholder="e.g. +2 days / None" value={coForm.scheduleImpact} onChange={e => setCoForm({ ...coForm, scheduleImpact: e.target.value })} />
              </div>

              <button onClick={runChangeOrder} disabled={!coForm.description || coStatus.type === "loading"} style={{
                width: "100%", background: coForm.description ? "#e53935" : "#2a2a2a", color: coForm.description ? "#fff" : "#555",
                border: "none", padding: "13px", fontFamily: "'Courier New', monospace", fontSize: "11px",
                letterSpacing: "3px", fontWeight: "bold", cursor: coForm.description ? "pointer" : "not-allowed",
              }}>
                {coStatus.type === "loading" ? "◌ GENERATING..." : "▶ GENERATE CHANGE ORDER"}
              </button>
            </>
          )}

          {/* PHASE 4: Sub Scope */}
          {phase === 4 && (
            <>
              <SectionLabel>SUBCONTRACTOR SCOPE LETTER</SectionLabel>
              <div style={{ background: "#111", border: "1px solid #9c27b033", padding: "10px 12px", marginBottom: "14px", fontSize: "10px", color: "#888", lineHeight: "1.7" }}>
                Generate a formal scope of work letter to send to a subcontractor for pricing.
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>SUB COMPANY NAME</label>
                <input style={inputStyle} placeholder="ABC Rebar LLC" value={scopeForm.subName} onChange={e => setScopeForm({ ...scopeForm, subName: e.target.value })} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>TRADE</label>
                <select style={inputStyle} value={scopeForm.subTrade} onChange={e => setScopeForm({ ...scopeForm, subTrade: e.target.value })}>
                  {["Concrete", "Rebar / Reinforcing", "Formwork", "Excavation", "Waterproofing", "Surveying", "Soil Testing", "Other"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>PROJECT NAME</label>
                <input style={inputStyle} placeholder={jobInfo.projectName || "Project name"} value={scopeForm.projectName} onChange={e => setScopeForm({ ...scopeForm, projectName: e.target.value })} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>PROJECT ADDRESS</label>
                <input style={inputStyle} placeholder={address || "Job site address"} value={scopeForm.projectAddress} onChange={e => setScopeForm({ ...scopeForm, projectAddress: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                <div>
                  <label style={{ ...labelStyle, color: "#9c27b0" }}>BID DUE DATE</label>
                  <input style={inputStyle} type="date" value={scopeForm.bidDueDate} onChange={e => setScopeForm({ ...scopeForm, bidDueDate: e.target.value })} />
                </div>
                <div>
                  <label style={{ ...labelStyle, color: "#9c27b0" }}>WORK START DATE</label>
                  <input style={inputStyle} type="date" value={scopeForm.workStartDate} onChange={e => setScopeForm({ ...scopeForm, workStartDate: e.target.value })} />
                </div>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>SCOPE DESCRIPTION *</label>
                <textarea style={{ ...inputStyle, height: "80px", resize: "vertical" }}
                  placeholder="Describe the work required — e.g. Furnish and install all rebar for 2,400 SF slab on grade, 4' thick, per structural drawings..."
                  value={scopeForm.scopeDescription}
                  onChange={e => setScopeForm({ ...scopeForm, scopeDescription: e.target.value })} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>INCLUSIONS</label>
                <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }}
                  placeholder="What IS included — materials, labor, equipment..."
                  value={scopeForm.inclusions}
                  onChange={e => setScopeForm({ ...scopeForm, inclusions: e.target.value })} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>EXCLUSIONS</label>
                <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }}
                  placeholder="What is NOT included — permits, testing, etc..."
                  value={scopeForm.exclusions}
                  onChange={e => setScopeForm({ ...scopeForm, exclusions: e.target.value })} />
              </div>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ ...labelStyle, color: "#9c27b0" }}>SPECIAL REQUIREMENTS</label>
                <input style={inputStyle} placeholder="Safety requirements, scheduling constraints..."
                  value={scopeForm.specialRequirements}
                  onChange={e => setScopeForm({ ...scopeForm, specialRequirements: e.target.value })} />
              </div>

              <button onClick={runSubScope} disabled={!scopeForm.scopeDescription || scopeStatus.type === "loading"} style={{
                width: "100%",
                background: scopeForm.scopeDescription ? "#9c27b0" : "#2a2a2a",
                color: scopeForm.scopeDescription ? "#fff" : "#555",
                border: "none", padding: "13px", fontFamily: "'Courier New', monospace",
                fontSize: "11px", letterSpacing: "3px", fontWeight: "bold",
                cursor: scopeForm.scopeDescription ? "pointer" : "not-allowed",
              }}>
                {scopeStatus.type === "loading" ? "◌ GENERATING..." : "▶ GENERATE SCOPE LETTER"}
              </button>
            </>
          )}

          {/* PHASE 5: Job History Controls */}
          {phase === 5 && (
            <>
              <SectionLabel>JOB HISTORY</SectionLabel>
              <div style={{ background: "#111", border: "1px solid #2a2a2a", padding: "10px 12px", marginBottom: "12px", fontSize: "11px" }}>
                <div style={{ color: "#666", letterSpacing: "1px" }}>TOTAL JOBS</div>
                <div style={{ color: "#f5a623", fontSize: "20px", fontWeight: "bold", marginTop: "2px" }}>{jobs.length}</div>
              </div>
              <div style={{ color: "#666", fontSize: "10px", letterSpacing: "1px", lineHeight: "1.8" }}>
                <div>→ LOAD: Restores bid form + output</div>
                <div>→ DEL: Permanently removes job</div>
                <div>→ Bids auto-save on request</div>
              </div>
            </>
          )}

          {/* PHASE 5: Price Book */}
          {phase === 6 && (
            <>
              <SectionLabel>PRICE BOOK</SectionLabel>
              <div style={{ background: "#111", border: "1px solid #2196f333", padding: "10px 12px", marginBottom: "14px", fontSize: "10px", color: "#888", lineHeight: "1.7" }}>
                Add, edit, or delete any line item. All bids and takeoffs use these exact rates.
              </div>

              {/* Add new item form */}
              <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #2196f3", padding: "14px", marginBottom: "12px" }}>
                <div style={{ ...labelStyle, color: "#2196f3", marginBottom: "10px" }}>ADD NEW LINE ITEM</div>
                <div style={{ marginBottom: "8px" }}>
                  <label style={{ ...labelStyle, fontSize: "9px" }}>ITEM NAME</label>
                  <input style={inputStyle} placeholder="e.g. Wire Mesh 6x6" value={newPriceItem.label} onChange={e => setNewPriceItem({ ...newPriceItem, label: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "9px" }}>PRICE ($)</label>
                    <input style={inputStyle} type="number" step="0.01" placeholder="0.00" value={newPriceItem.price} onChange={e => setNewPriceItem({ ...newPriceItem, price: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: "9px" }}>UNIT</label>
                    <select style={inputStyle} value={newPriceItem.unit} onChange={e => setNewPriceItem({ ...newPriceItem, unit: e.target.value })}>
                      {["SF", "CY", "LF", "LB", "EA", "DAY", "HR", "TON", "GAL", "LS"].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ ...labelStyle, fontSize: "9px" }}>CATEGORY</label>
                  <select style={inputStyle} value={newPriceItem.group} onChange={e => setNewPriceItem({ ...newPriceItem, group: e.target.value })}>
                    {[...new Set(Object.values(prices).map(p => p.group)), "Custom"].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <button onClick={() => {
                  if (!newPriceItem.label || !newPriceItem.price) return;
                  const key = `custom_${Date.now()}`;
                  const updated = { ...prices, [key]: { label: newPriceItem.label, price: parseFloat(newPriceItem.price), unit: newPriceItem.unit, group: newPriceItem.group } };
                  savePrices(updated);
                  setNewPriceItem({ label: "", price: "", unit: "SF", group: "Materials" });
                }} style={{
                  width: "100%", background: newPriceItem.label && newPriceItem.price ? "#2196f3" : "#2a2a2a",
                  color: newPriceItem.label && newPriceItem.price ? "#fff" : "#555",
                  border: "none", padding: "10px", fontFamily: "'Courier New', monospace",
                  fontSize: "10px", letterSpacing: "2px", fontWeight: "bold", cursor: newPriceItem.label && newPriceItem.price ? "pointer" : "not-allowed",
                }}>+ ADD ITEM</button>
              </div>

              <button onClick={() => savePrices({ ...prices })} style={{
                width: "100%", background: "#2196f3", color: "#fff", border: "none", padding: "13px",
                fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "3px", fontWeight: "bold", cursor: "pointer", marginBottom: "8px",
              }}>✓ SAVE PRICE BOOK</button>
              <button onClick={() => { const reset = {}; Object.entries(DEFAULT_PRICES).forEach(([k,v]) => { reset[k] = {...v}; }); savePrices(reset); }} style={{
                width: "100%", background: "transparent", color: "#555", border: "1px solid #333", padding: "10px",
                fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer",
              }}>↺ RESET TO DEFAULTS</button>
            </>
          )}

          {/* PHASE 6: Settings */}
          {phase === 7 && (
            <>
              <SectionLabel>COMPANY BRANDING</SectionLabel>
              <div style={{ color: "#666", fontSize: "10px", letterSpacing: "1px", marginBottom: "16px", lineHeight: "1.7" }}>
                Your info appears on all bid exports and reports.
              </div>
              {[
                { key: "companyName", label: "COMPANY NAME", placeholder: "Smith Concrete LLC" },
                { key: "licenseNumber", label: "LICENSE NUMBER", placeholder: "CON-123456" },
                { key: "phone", label: "PHONE", placeholder: "(540) 555-0100" },
                { key: "email", label: "EMAIL", placeholder: "bids@smithconcrete.com" },
                { key: "website", label: "WEBSITE", placeholder: "www.smithconcrete.com" },
                { key: "city", label: "CITY", placeholder: "Winchester" },
                { key: "state", label: "STATE", placeholder: "VA" },
                { key: "tagline", label: "TAGLINE", placeholder: "Built right, built to last." },
              ].map(({ key, label, placeholder }) => (
                <div key={key} style={{ marginBottom: "12px" }}>
                  <label style={labelStyle}>{label}</label>
                  <input
                    style={inputStyle}
                    placeholder={placeholder}
                    value={brand[key]}
                    onChange={e => setBrand({ ...brand, [key]: e.target.value })}
                  />
                </div>
              ))}
              <button
                onClick={() => saveBrand(brand)}
                style={{ width: "100%", background: "#f5a623", color: "#000", border: "none", padding: "13px", fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "3px", fontWeight: "bold", cursor: "pointer", marginTop: "4px" }}
              >
                ✓ SAVE BRANDING
              </button>
            </>
          )}
        </div>

        {/* Right Panel */}
        <div className="right-panel" style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#0a0a0a" }}>

          {phase === 0 && (
            <>
              <SectionLabel>SITE MAP VIEW</SectionLabel>
              {mapLoaded && address ? (
                <LeafletMap address={address} />
              ) : (
                <div style={{ height: "500px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333" }}>
                  <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗺</div>
                  <div style={{ fontSize: "11px", letterSpacing: "3px" }}>AWAITING ADDRESS INPUT</div>
                </div>
              )}
            </>
          )}

          {phase === 1 && (
            <>
              <SectionLabel>BID ESTIMATE OUTPUT</SectionLabel>
              <StatusBar text={bidStatus.text} type={bidStatus.type} />

              {/* Pricing panel (toggleable) */}
              {showPricing && <MaterialPricingPanel sqft={bidForm.sqft} thickness={bidForm.thickness} psi={bidForm.psi} rebar={bidForm.rebar} accessDifficulty={bidForm.accessDifficulty} prices={prices} />}

              {bidOutput ? (
                <>
                  <OutputPanel content={bidOutput} title="GENERATED BID — REVIEW ALL FIGURES BEFORE SUBMITTING" />
                  {showMarkup && <MarkupCalculator bidOutput={bidOutput} />}

                  {/* Action bar */}
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={() => exportToPDF(address, bidForm, bidOutput, brand, jobInfo)} style={{
                      background: "#1a1a2a", color: "#7986cb", border: "1px solid #7986cb44",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>
                      ⬇ EXPORT PDF
                    </button>
                    <button onClick={saveJob} style={{
                      background: "#0d1a0d", color: "#4caf50", border: "1px solid #4caf5044",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>
                      💾 {savedMsg || "SAVE JOB"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {showPricing && bidForm.sqft ? null : (
                    <div style={{ height: "300px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333", marginTop: showPricing ? "12px" : "0" }}>
                      <div style={{ fontSize: "32px", marginBottom: "12px" }}>🏗</div>
                      <div style={{ fontSize: "11px", letterSpacing: "2px" }}>FILL FORM → GENERATE BID</div>
                    </div>
                  )}
                  {showMarkup && !bidOutput && <MarkupCalculator bidOutput={null} />}
                </>
              )}
            </>
          )}

          {phase === 2 && (
            <>
              <SectionLabel>FIELD PROGRESS REPORT</SectionLabel>
              <StatusBar text={asBuiltStatus.text} type={asBuiltStatus.type} />
              {asBuiltOutput ? (
                <OutputPanel content={asBuiltOutput} title="FIELD REPORT — PROGRESS / PUNCH LIST / CONDITIONS" />
              ) : (
                <div style={{ height: "400px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333" }}>
                  <div style={{ fontSize: "32px", marginBottom: "12px" }}>📷</div>
                  <div style={{ fontSize: "11px", letterSpacing: "2px" }}>ADD SITE PHOTOS → ANALYZE</div>
                  <div style={{ fontSize: "10px", color: "#2a2a2a", marginTop: "8px", letterSpacing: "1px" }}>UP TO 8 PHOTOS PER REPORT</div>
                </div>
              )}
            </>
          )}

          {phase === 3 && (
            <>
              <SectionLabel>CHANGE ORDER OUTPUT</SectionLabel>
              <StatusBar text={coStatus.text} type={coStatus.type} />

              {/* Job context banner */}
              {(jobInfo.projectName || jobInfo.clientName || jobInfo.gcName) && (
                <div style={{ background: "#111", border: "1px solid #e5393533", borderLeft: "3px solid #e53935", padding: "10px 14px", marginBottom: "12px", fontSize: "11px" }}>
                  {jobInfo.projectName && <div style={{ color: "#f0ece0", marginBottom: "2px" }}>{jobInfo.projectName}</div>}
                  {jobInfo.gcName && <div style={{ color: "#888" }}>GC: {jobInfo.gcName}</div>}
                  {jobInfo.clientName && <div style={{ color: "#888" }}>Client: {jobInfo.clientName}</div>}
                </div>
              )}

              {coOutput ? (
                <>
                  <OutputPanel content={coOutput} title="CHANGE ORDER — BOTH PARTIES MUST SIGN BEFORE WORK BEGINS" />
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={exportChangeOrder} style={{
                      background: "#1a0d0d", color: "#e53935", border: "1px solid #e5393544",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>⬇ EXPORT CHANGE ORDER</button>
                    <button onClick={() => { setCoOutput(""); setCoStatus({ text: "AWAITING INPUT", type: "idle" }); setCoForm({ description: "", reason: "", scopeChanges: "", scheduleImpact: "", addedSF: "", addedThickness: "4", rebarType: "none", addedLaborHours: "", addedLaborRole: "laborer", equipmentDays: "", equipmentType: "pump_truck", manualOverride: false, manualCostImpact: "" }); }} style={{
                      background: "transparent", color: "#555", border: "1px solid #333",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>↺ NEW CHANGE ORDER</button>
                  </div>
                </>
              ) : (
                <div style={{ height: "380px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333" }}>
                  <div style={{ fontSize: "30px", marginBottom: "12px" }}>📋</div>
                  <div style={{ fontSize: "11px", letterSpacing: "2px" }}>FILL FORM → GENERATE CHANGE ORDER</div>
                </div>
              )}
            </>
          )}

          {phase === 4 && (
            <>
              <SectionLabel>SCOPE OF WORK LETTER</SectionLabel>
              <StatusBar text={scopeStatus.text} type={scopeStatus.type} />

              {/* Context banner if job info populated */}
              {(scopeForm.projectName || scopeForm.subName) && (
                <div style={{ background: "#111", border: "1px solid #9c27b033", borderLeft: "3px solid #9c27b0", padding: "10px 14px", marginBottom: "12px", fontSize: "11px" }}>
                  {scopeForm.subName && <div style={{ color: "#f0ece0", marginBottom: "2px" }}>To: {scopeForm.subName}</div>}
                  {scopeForm.projectName && <div style={{ color: "#888" }}>Project: {scopeForm.projectName}</div>}
                  {scopeForm.bidDueDate && <div style={{ color: "#888" }}>Bid Due: {scopeForm.bidDueDate}</div>}
                </div>
              )}

              {scopeOutput ? (
                <>
                  <OutputPanel content={scopeOutput} title="SCOPE OF WORK LETTER — REVIEW BEFORE SENDING" accent="#9c27b0" />
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={exportSubScope} style={{
                      background: "#1a0d1a", color: "#9c27b0", border: "1px solid #9c27b044",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>⬇ EXPORT SCOPE LETTER</button>
                    <button onClick={() => { setScopeOutput(""); setScopeStatus({ text: "AWAITING INPUT", type: "idle" }); }} style={{
                      background: "transparent", color: "#555", border: "1px solid #333",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>↺ NEW SCOPE</button>
                  </div>
                </>
              ) : (
                <div style={{ height: "380px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333" }}>
                  <div style={{ fontSize: "30px", marginBottom: "12px" }}>📄</div>
                  <div style={{ fontSize: "11px", letterSpacing: "2px" }}>FILL FORM → GENERATE SCOPE LETTER</div>
                </div>
              )}
            </>
          )}

          {phase === 5 && (
            <>
              <SectionLabel>SAVED BIDS</SectionLabel>
              <JobHistoryPanel jobs={jobs} onLoad={loadJob} onDelete={deleteJob} />
            </>
          )}

          {phase === 6 && (
            <>
              <SectionLabel>PRICE BOOK EDITOR</SectionLabel>
              <div style={{ fontSize: "10px", color: "#555", letterSpacing: "1px", marginBottom: "16px" }}>
                Click any row to edit inline. Hit ✓ to confirm or ✕ to cancel. Delete removes the item permanently.
              </div>

              {/* Group the items */}
              {[...new Set(Object.values(prices).map(p => p.group))].map(group => {
                const groupItems = Object.entries(prices).filter(([, v]) => v.group === group);
                if (!groupItems.length) return null;
                const groupColors = { Concrete: "#f5a623", Reinforcement: "#2196f3", Materials: "#4caf50", Equipment: "#9c27b0", Labor: "#e53935", Custom: "#00bcd4" };
                const color = groupColors[group] || "#888";
                return (
                  <div key={group} style={{ marginBottom: "20px" }}>
                    <div style={{ fontSize: "9px", letterSpacing: "3px", color, marginBottom: "8px", borderBottom: `1px solid ${color}33`, paddingBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{group.toUpperCase()}</span>
                      <span style={{ color: "#555", fontSize: "9px" }}>{groupItems.length} ITEMS</span>
                    </div>

                    {groupItems.map(([key, item]) => (
                      editingPriceKey === key ? (
                        // Editing row
                        <div key={key} style={{ background: "#1a1a2a", border: "1px solid #2196f3", padding: "10px", marginBottom: "6px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 60px", gap: "6px", marginBottom: "6px" }}>
                            <input style={{ ...inputStyle, fontSize: "12px" }} value={item.label}
                              onChange={e => setPrices({ ...prices, [key]: { ...prices[key], label: e.target.value } })} />
                            <div style={{ position: "relative" }}>
                              <span style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: "#f5a623", fontSize: "12px" }}>$</span>
                              <input style={{ ...inputStyle, paddingLeft: "20px", fontSize: "12px", textAlign: "right" }} type="number" step="0.01" value={item.price}
                                onChange={e => setPrices({ ...prices, [key]: { ...prices[key], price: parseFloat(e.target.value) || 0 } })} />
                            </div>
                            <select style={{ ...inputStyle, fontSize: "11px" }} value={item.unit}
                              onChange={e => setPrices({ ...prices, [key]: { ...prices[key], unit: e.target.value } })}>
                              {["SF", "CY", "LF", "LB", "EA", "DAY", "HR", "TON", "GAL", "LS"].map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                            <select style={{ ...inputStyle, fontSize: "11px" }} value={item.group}
                              onChange={e => setPrices({ ...prices, [key]: { ...prices[key], group: e.target.value } })}>
                              {[...new Set(Object.values(prices).map(p => p.group)), "Custom"].map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button onClick={() => { savePrices({ ...prices }); setEditingPriceKey(null); }} style={{ flex: 1, background: "#4caf50", color: "#fff", border: "none", padding: "8px", fontFamily: "'Courier New', monospace", fontSize: "11px", cursor: "pointer" }}>✓ SAVE</button>
                              <button onClick={() => setEditingPriceKey(null)} style={{ flex: 1, background: "transparent", color: "#888", border: "1px solid #333", padding: "8px", fontFamily: "'Courier New', monospace", fontSize: "11px", cursor: "pointer" }}>✕</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Display row
                        <div key={key} style={{ display: "grid", gridTemplateColumns: "2fr 80px 50px 60px", gap: "6px", alignItems: "center", marginBottom: "4px", padding: "8px 10px", background: "#0d0d0d", border: "1px solid #1a1a1a" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "#2a2a2a"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = "#1a1a1a"}>
                          <div style={{ fontSize: "11px", color: "#c8bfa8" }}>{item.label}</div>
                          <div style={{ fontSize: "12px", color: "#f5a623", textAlign: "right", fontFamily: "'Courier New', monospace" }}>${item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: "10px", color: "#555", textAlign: "center" }}>/{item.unit}</div>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button onClick={() => setEditingPriceKey(key)} style={{ flex: 1, background: "transparent", color: "#2196f3", border: "1px solid #2196f333", padding: "4px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>EDIT</button>
                            <button onClick={() => {
                              if (window.confirm(`Delete "${item.label}"?`)) {
                                const updated = { ...prices };
                                delete updated[key];
                                savePrices(updated);
                              }
                            }} style={{ flex: 1, background: "transparent", color: "#e53935", border: "1px solid #e5393533", padding: "4px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                );
              })}

              <div style={{ background: "#111", border: "1px solid #2196f333", padding: "12px", fontSize: "10px", color: "#555", marginTop: "8px", lineHeight: "1.7" }}>
                → Changes apply to all new bids immediately after saving<br/>
                → Custom items persist across sessions<br/>
                → Reset to defaults removes all custom items
              </div>
            </>
          )}

          {phase === 7 && (
            <>
              <SectionLabel>BRAND PREVIEW</SectionLabel>
              <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #f5a623", padding: "24px" }}>
                <div style={{ borderBottom: "2px solid #f5a623", paddingBottom: "16px", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "18px", fontWeight: "bold", letterSpacing: "2px", color: "#f0ece0" }}>
                      {brand.companyName ? brand.companyName.toUpperCase() : "YOUR COMPANY NAME"}
                    </div>
                    <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#f5a623", marginTop: "4px" }}>BID ESTIMATE — CONFIDENTIAL</div>
                    {brand.licenseNumber && <div style={{ fontSize: "10px", color: "#666", marginTop: "3px" }}>LIC# {brand.licenseNumber}</div>}
                    {brand.tagline && <div style={{ fontSize: "10px", color: "#888", fontStyle: "italic", marginTop: "3px" }}>{brand.tagline}</div>}
                  </div>
                  <div style={{ textAlign: "right", fontSize: "11px", color: "#666", lineHeight: "1.8" }}>
                    <div>{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
                    {brand.phone && <div>{brand.phone}</div>}
                    {brand.email && <div>{brand.email}</div>}
                    {brand.city && brand.state && <div>{brand.city}, {brand.state}</div>}
                    {brand.website && <div>{brand.website}</div>}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
                  {[["JOB SITE", "123 Main St, Anytown VA"], ["POUR TYPE", "Slab on Grade"], ["SQUARE FOOTAGE", "2,400 SF"], ["THICKNESS", '4"'], ["STRENGTH", "3000 PSI"], ["FINISH", "Broom"]].map(([l, v]) => (
                    <div key={l} style={{ background: "#111", padding: "8px 10px" }}>
                      <div style={{ fontSize: "8px", letterSpacing: "2px", color: "#555", marginBottom: "3px" }}>{l}</div>
                      <div style={{ fontSize: "11px", color: "#888" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "10px", color: "#555", borderTop: "1px solid #2a2a2a", paddingTop: "12px", display: "flex", justifyContent: "space-between" }}>
                  <span>{brand.companyName ? brand.companyName.toUpperCase() : "YOUR COMPANY NAME"}{brand.licenseNumber ? ` — LIC# ${brand.licenseNumber}` : ""}</span>
                  <span>VERIFY ALL FIGURES BEFORE SUBMITTING</span>
                </div>
              </div>
              <div style={{ marginTop: "12px", background: "#111", border: "1px solid #2a2a2a", padding: "12px", fontSize: "11px", color: "#555", letterSpacing: "1px" }}>
                → This preview reflects how your branding will appear on all exported bid documents.<br />
                → Fill in your info on the left and hit SAVE BRANDING.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
