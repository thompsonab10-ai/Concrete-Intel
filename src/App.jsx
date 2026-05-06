import { useState, useRef, useEffect } from "react";

const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const PHASES = ["DASHBOARD", "BID ENGINE", "CHANGE ORDER", "JOB HISTORY", "PRICE BOOK", "SETTINGS", "HELP"];

// ── Deterministic estimate engine ─────────────────────────────────────────
// All dollar totals are calculated here, not parsed from AI text.
function calculateBidTotal(bidForm, prices, markupState = {}) {
  const P = prices || {};
  const sf = parseFloat(bidForm?.sqft) || 0;
  const tk = parseFloat(bidForm?.thickness) || 4;
  const cy = sf > 0 ? (sf * (tk / 12)) / 27 * 1.05 : 0;

  // Concrete
  const psiKey = `concrete_${bidForm?.psi || "3000"}`;
  const concreteRate = P[psiKey]?.price || P.concrete_3000?.price || 155;
  const concreteCost = cy * concreteRate;

  // Rebar
  const rebarItem = P[bidForm?.rebar];
  const rebarLbPerSF = bidForm?.rebar?.includes("5") ? 0.85 : 0.55;
  const rebarCost = (!rebarItem || bidForm?.rebar === "none") ? 0
    : rebarItem.unit === "SF" ? sf * rebarItem.price
    : sf * rebarLbPerSF * rebarItem.price;

  // Labor (placement + finishing)
  const laborCost = sf * ((P.placement_labor?.price || 1.20) + (P.finishing_labor?.price || 2.85));

  // Access surcharge
  const accessSurcharge = bidForm?.accessDifficulty === "pump-required"
    ? (P.pump_truck?.price || 1200) : bidForm?.accessDifficulty === "difficult" ? 350 : 0;

  const directCost = concreteCost + rebarCost + laborCost + accessSurcharge;

  // Markup
  const ohPct = parseFloat(markupState?.overhead || 12) / 100;
  const profitPct = parseFloat(markupState?.profit || 10) / 100;
  const contingencyPct = parseFloat(markupState?.contingency || 0) / 100;

  const overhead = directCost * ohPct;
  const profit = (directCost + overhead) * profitPct;
  const contingency = (directCost + overhead + profit) * contingencyPct;
  const totalBid = directCost + overhead + profit + contingency;

  return {
    cy: parseFloat(cy.toFixed(2)),
    directCost: Math.round(directCost),
    concreteCost: Math.round(concreteCost),
    rebarCost: Math.round(rebarCost),
    laborCost: Math.round(laborCost),
    accessSurcharge: Math.round(accessSurcharge),
    overhead: Math.round(overhead),
    profit: Math.round(profit),
    contingency: Math.round(contingency),
    totalBid: Math.round(totalBid),
  };
}

// Helper to get total bid from a job — prefers stored estimate, falls back to regex
function getJobBidTotal(job) {
  if (job?.estimate?.totalBid) return job.estimate.totalBid;
  const match = job?.bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
  return match ? parseFloat(match[1].replace(/,/g, "")) : 0;
}

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

function CloseoutPanel({ job, onSave, labelStyle, inputStyle }) {
  const co = job.closeout || {};
  const bidVal = getJobBidTotal(job);
  const revenue = parseFloat(co.actualRevenue || bidVal || 0);
  const cost = parseFloat(co.actualCost || 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ actualRevenue: co.actualRevenue || "", actualCost: co.actualCost || "", costNotes: co.costNotes || "" });

  return (
    <div style={{ marginTop: "10px", background: "#0d1a0d", border: "1px solid #4caf5033", borderLeft: "3px solid #4caf50", padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#4caf50" }}>JOB CLOSE-OUT</div>
        <button onClick={() => setEditing(!editing)} style={{ background: "transparent", color: "#4caf50", border: "1px solid #4caf5044", padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "8px", cursor: "pointer" }}>
          {editing ? "CANCEL" : "ENTER ACTUALS"}
        </button>
      </div>
      {editing ? (
        <div>
          <div style={{ marginBottom: "8px" }}>
            <label style={{ ...labelStyle, fontSize: "9px" }}>ACTUAL REVENUE ($)</label>
            <input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder={bidVal || "0"}
              value={form.actualRevenue} onChange={e => setForm({ ...form, actualRevenue: e.target.value })} />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label style={{ ...labelStyle, fontSize: "9px" }}>ACTUAL COST ($)</label>
            <input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="Total materials + labor + equipment"
              value={form.actualCost} onChange={e => setForm({ ...form, actualCost: e.target.value })} />
          </div>
          <div style={{ marginBottom: "10px" }}>
            <label style={{ ...labelStyle, fontSize: "9px" }}>NOTES</label>
            <input style={inputStyle} placeholder="What drove cost over/under? Lessons learned..."
              value={form.costNotes} onChange={e => setForm({ ...form, costNotes: e.target.value })} />
          </div>
          <button onClick={() => { onSave(job.id, form); setEditing(false); }} style={{
            width: "100%", background: "#4caf50", color: "#000", border: "none", padding: "8px",
            fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer",
          }}>✓ SAVE CLOSE-OUT</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          <div style={{ background: "#111", padding: "6px 8px" }}>
            <div style={{ fontSize: "7px", color: "#555", marginBottom: "2px" }}>REVENUE</div>
            <div style={{ fontSize: "11px", color: "#f0ece0", fontWeight: "bold" }}>{revenue > 0 ? `$${revenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</div>
          </div>
          <div style={{ background: "#111", padding: "6px 8px" }}>
            <div style={{ fontSize: "7px", color: "#555", marginBottom: "2px" }}>COST</div>
            <div style={{ fontSize: "11px", color: "#e53935" }}>{cost > 0 ? `$${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</div>
          </div>
          <div style={{ background: profit > 0 ? "#0d1a0d" : "#1a0d0d", padding: "6px 8px", border: `1px solid ${profit > 0 ? "#4caf5033" : "#e5393533"}` }}>
            <div style={{ fontSize: "7px", color: "#555", marginBottom: "2px" }}>PROFIT {margin ? `(${margin}%)` : ""}</div>
            <div style={{ fontSize: "11px", color: profit > 0 ? "#4caf50" : "#e53935", fontWeight: "bold" }}>{cost > 0 ? `$${profit.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</div>
          </div>
        </div>
      )}
      {co.costNotes && !editing && <div style={{ fontSize: "9px", color: "#666", marginTop: "6px", fontStyle: "italic" }}>📝 {co.costNotes}</div>}
    </div>
  );
}

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
  if (rebar !== "none" && P[rebar]) {
    const rebarItem = P[rebar];
    if (rebarItem.unit === "SF") {
      rebarCost = sf * rebarItem.price;
      rebarLabel = `${sf} SF × $${rebarItem.price}/SF`;
    } else {
      // LB-based — estimate weight
      const lbPerSF = rebar.includes("5") ? 0.85 : 0.55;
      const lb = sf * lbPerSF;
      rebarCost = lb * rebarItem.price;
      rebarLabel = `${lb.toFixed(0)} LB × $${rebarItem.price}/LB`;
    }
  }

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
function JobHistoryPanel({ jobs, onLoad, onDelete, onStatusChange }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const bids = jobs.filter(j => j.type !== "change_order");
  const changeOrders = jobs.filter(j => j.type === "change_order");

  if (bids.length === 0 && changeOrders.length === 0) return (
    <div style={{ color: "#444", fontSize: "11px", letterSpacing: "1px", textAlign: "center", padding: "60px 0" }}>
      NO SAVED JOBS<br /><span style={{ fontSize: "10px", marginTop: "8px", display: "block" }}>SAVE YOUR FIRST BID TO SEE IT HERE</span>
    </div>
  );

  const grouped = {};
  bids.forEach(job => {
    const jobNum = job.jobInfo?.jobNumber || job.projectKey || `legacy_${job.id}`;
    if (!grouped[jobNum]) grouped[jobNum] = { bids: [], cos: [] };
    grouped[jobNum].bids.push(job);
  });
  changeOrders.forEach(co => {
    const jobNum = co.linkedJobNumber || "__unlinked__";
    if (!grouped[jobNum]) grouped[jobNum] = { bids: [], cos: [] };
    grouped[jobNum].cos.push(co);
  });
  Object.values(grouped).forEach(g => g.bids.sort((a, b) => (b.version || 1) - (a.version || 1)));
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
    const aL = Math.max(...[...a.bids, ...a.cos].map(j => j.id), 0);
    const bL = Math.max(...[...b.bids, ...b.cos].map(j => j.id), 0);
    return bL - aL;
  });
  const statusColors = { draft: "#666", submitted: "#2196f3", won: "#4caf50", lost: "#e53935" };

  return (
    <div>
      {sortedGroups.map(([jobNum, group]) => {
        const latest = group.bids[0];
        const isExpanded = expandedKey === jobNum;
        const hasCOs = group.cos.length > 0;
        const origValue = getJobBidTotal(latest);
        const coTotal = group.cos.reduce((sum, co) => {
          const m = co.coOutput?.match(/NET CHANGE[^$\d]*\$?([\d,]+)/i);
          return sum + (m ? parseFloat(m[1].replace(/,/g, "")) : 0);
        }, 0);
        const status = latest?.status || "draft";

        return (
          <div key={jobNum} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", marginBottom: "12px" }}>
            <div style={{ padding: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px", flexWrap: "wrap" }}>
                    <span style={{ background: "#f5a62322", color: "#f5a623", border: "1px solid #f5a62344", borderRadius: "4px", padding: "2px 8px", fontSize: "10px", fontWeight: "bold" }}>
                      {jobNum === "__unlinked__" ? "UNLINKED COs" : jobNum}
                    </span>
                    <span style={{ background: `${statusColors[status]}22`, color: statusColors[status], border: `1px solid ${statusColors[status]}44`, borderRadius: "4px", padding: "1px 6px", fontSize: "9px" }}>
                      {status.toUpperCase()}
                    </span>
                    {hasCOs && <span style={{ color: "#e53935", fontSize: "9px" }}>{group.cos.length} CO{group.cos.length > 1 ? "s" : ""}</span>}
                  </div>
                  <div style={{ color: "#f0ece0", fontSize: "13px", fontWeight: "bold", marginBottom: "2px" }}>
                    {latest?.jobInfo?.projectName || latest?.address || "Unnamed Project"}
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    {latest?.jobInfo?.clientName && <span style={{ fontSize: "10px", color: "#666" }}>Client: {latest.jobInfo.clientName}</span>}
                    {latest?.jobInfo?.gcName && <span style={{ fontSize: "10px", color: "#666" }}>GC: {latest.jobInfo.gcName}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "10px" }}>
                  {latest && <button onClick={() => onLoad(latest)} style={{ background: "#f5a623", color: "#000", border: "none", padding: "5px 12px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>LOAD</button>}
                  <button onClick={() => setExpandedKey(isExpanded ? null : jobNum)} style={{ background: "transparent", color: "#2196f3", border: "1px solid #2196f344", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>{isExpanded ? "▲" : "▼"}</button>
                  {latest && <button onClick={() => onDelete(latest.id)} style={{ background: "transparent", color: "#e53935", border: "1px solid #e5393544", padding: "5px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>}
                </div>
              </div>

              {latest && onStatusChange && (
                <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
                  {[{ value: "draft", label: "DRAFT", color: "#666" }, { value: "submitted", label: "SUBMITTED", color: "#2196f3" }, { value: "won", label: "WON", color: "#4caf50" }, { value: "lost", label: "LOST", color: "#e53935" }].map(({ value, label, color }) => {
                    const isActive = (latest.status || "draft") === value;
                    return <button key={value} onClick={() => onStatusChange(latest.id, value)} style={{ flex: 1, background: isActive ? `${color}22` : "transparent", color: isActive ? color : "#333", border: `1px solid ${isActive ? color : "#2a2a2a"}`, padding: "4px 2px", fontFamily: "'Courier New', monospace", fontSize: "7px", cursor: "pointer", fontWeight: isActive ? "bold" : "normal" }}>{label}</button>;
                  })}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: origValue > 0 && hasCOs ? "1fr 1fr 1fr" : origValue > 0 ? "1fr 1fr" : "1fr", gap: "6px" }}>
                {origValue > 0 && <div style={{ background: "#111", padding: "6px 8px" }}><div style={{ fontSize: "7px", color: "#444", marginBottom: "2px" }}>ORIGINAL BID</div><div style={{ fontSize: "12px", color: "#4caf50", fontWeight: "bold" }}>${origValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div></div>}
                {hasCOs && coTotal > 0 && <div style={{ background: "#111", padding: "6px 8px" }}><div style={{ fontSize: "7px", color: "#444", marginBottom: "2px" }}>CO TOTAL</div><div style={{ fontSize: "12px", color: "#e53935", fontWeight: "bold" }}>+${coTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div></div>}
                {origValue > 0 && hasCOs && <div style={{ background: "#f5a62311", border: "1px solid #f5a62333", padding: "6px 8px" }}><div style={{ fontSize: "7px", color: "#f5a623", marginBottom: "2px" }}>RUNNING TOTAL</div><div style={{ fontSize: "13px", color: "#f5a623", fontWeight: "bold" }}>${(origValue + coTotal).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div></div>}
              </div>
            </div>

            {isExpanded && (
              <div style={{ padding: "10px 14px", borderTop: "1px solid #1a1a1a" }}>
                {group.bids.length > 0 && (
                  <>
                    <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#555", marginBottom: "8px" }}>BID REVISIONS</div>
                    {group.bids.map(bid => (
                      <div key={bid.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", marginBottom: "4px", background: "#111", border: "1px solid #1a1a1a" }}>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <span style={{ background: bid.id === group.bids[0].id ? "#f5a62322" : "#1a1a1a", color: bid.id === group.bids[0].id ? "#f5a623" : "#666", border: `1px solid ${bid.id === group.bids[0].id ? "#f5a62344" : "#2a2a2a"}`, borderRadius: "4px", padding: "1px 6px", fontSize: "9px" }}>v{bid.version || 1}</span>
                          <span style={{ color: "#666", fontSize: "10px" }}>{bid.savedAt}</span>
                        </div>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button onClick={() => onLoad(bid)} style={{ background: "transparent", color: "#f5a623", border: "1px solid #f5a62344", padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>LOAD</button>
                          <button onClick={() => onDelete(bid.id)} style={{ background: "transparent", color: "#e53935", border: "1px solid #e5393544", padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {group.cos.length > 0 && (
                  <>
                    <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#e53935", marginBottom: "8px", marginTop: "12px" }}>CHANGE ORDERS</div>
                    {group.cos.map((co, i) => (
                      <div key={co.id} style={{ padding: "8px 10px", marginBottom: "4px", background: "#1a0d0d", border: "1px solid #e5393522" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <span style={{ color: "#e53935", fontSize: "10px", fontWeight: "bold" }}>CO-{String(i + 1).padStart(2, "0")}</span>
                            <span style={{ color: "#666", fontSize: "10px", marginLeft: "10px" }}>{co.savedAt}</span>
                          </div>
                          <button onClick={() => onDelete(co.id)} style={{ background: "transparent", color: "#e53935", border: "1px solid #e5393533", padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>DEL</button>
                        </div>
                        {co.coForm?.description && <div style={{ fontSize: "10px", color: "#888", marginTop: "4px" }}>{co.coForm.description.slice(0, 80)}{co.coForm.description.length > 80 ? "..." : ""}</div>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── PDF Export (Blob download — no popup blocker) ──────────────────
function exportMaterialList(address, bidForm, bidOutput, brand = {}, jobInfo = {}, prices = {}) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const filename = `MaterialList_${(jobInfo.projectName || address || "Project").replace(/[^a-z0-9]/gi, "_").slice(0, 30)}_${new Date().toISOString().slice(0,10)}.html`;
  const coName = brand.companyName || "CONCRETE CONTRACTOR";
  const sf = parseFloat(bidForm.sqft) || 0;
  const tk = parseFloat(bidForm.thickness) || 4;
  const cy = sf > 0 ? ((sf * (tk / 12)) / 27 * 1.05) : 0;
  const psiKey = `concrete_${bidForm.psi}`;
  const concreteItem = prices[psiKey] || { label: `Ready-Mix ${bidForm.psi} PSI`, price: 0, unit: "CY" };

  // Build material rows
  const rows = [];
  if (cy > 0) rows.push({ category: "CONCRETE", item: concreteItem.label, qty: `${cy.toFixed(1)} CY`, unit: "CY", note: "Include 5% waste — verify with supplier" });

  // Rebar
  const rebarItem = prices[bidForm.rebar];
  if (rebarItem && bidForm.rebar !== "none") {
    if (rebarItem.unit === "SF") {
      rows.push({ category: "REINFORCEMENT", item: rebarItem.label, qty: `${sf} SF`, unit: "SF", note: "" });
    } else {
      const lbPerSF = bidForm.rebar?.includes("5") ? 0.85 : 0.55;
      const lb = (sf * lbPerSF).toFixed(0);
      const lf = Math.round(sf * lbPerSF / 2.67); // approx LF for #4 rebar
      rows.push({ category: "REINFORCEMENT", item: rebarItem.label, qty: `${lb} LB (~${lf} LF)`, unit: "LB", note: "Verify spacing with structural drawings" });
    }
  }

  // Standard materials
  const materialItems = [
    { key: "vapor_barrier", qty: () => `${sf} SF`, note: "6-mil poly — overlap seams 12\"" },
    { key: "curing_compound", qty: () => `${(sf / 200).toFixed(0)} GAL`, note: "1 gal per ~200 SF" },
    { key: "form_lumber", qty: () => `${Math.ceil(Math.sqrt(sf) * 4)} LF`, note: "Perimeter estimate — adjust for layout" },
    { key: "expansion_joint", qty: () => `${Math.ceil(Math.sqrt(sf) * 2)} LF`, note: "Every 10-12 ft in each direction" },
    { key: "concrete_sealer", qty: () => `${(sf / 200).toFixed(0)} GAL`, note: "Apply after cure — 1 gal per ~200 SF" },
  ];

  materialItems.forEach(({ key, qty, note }) => {
    if (prices[key]) rows.push({ category: "MATERIALS", item: prices[key].label, qty: qty(), unit: prices[key].unit, note });
  });

  // Equipment
  if (bidForm.accessDifficulty === "pump-required" && prices.pump_truck) {
    rows.push({ category: "EQUIPMENT", item: prices.pump_truck.label, qty: "1 DAY", unit: "DAY", note: "Reserve 48hrs in advance" });
  }

  const byCategory = {};
  rows.forEach(r => { if (!byCategory[r.category]) byCategory[r.category] = []; byCategory[r.category].push(r); });
  const catColors = { CONCRETE: "#f5a623", REINFORCEMENT: "#2196f3", MATERIALS: "#4caf50", EQUIPMENT: "#9c27b0" };

  const tableRows = rows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#f9f9f9"}">
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:10px;letter-spacing:1px;color:${catColors[r.category] || "#666"};font-weight:bold">${r.category}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:11px;font-weight:bold">${r.item}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;font-weight:bold;font-family:'Courier New',monospace;color:#1a1a1a">${r.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:10px;color:#999;font-style:italic">${r.note}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center"><input type="checkbox" style="width:16px;height:16px"></td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Material List — ${coName}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; color:#222; }
  .header { background:#1a1a1a; color:#fff; padding:28px 40px; display:flex; justify-content:space-between; align-items:flex-start; }
  .co-name { font-size:20px; font-weight:bold; margin-bottom:3px; }
  .doc-type { font-size:10px; letter-spacing:3px; color:#f5a623; text-transform:uppercase; }
  .doc-info { text-align:right; font-size:10px; color:#aaa; line-height:1.8; }
  .accent { height:4px; background:#f5a623; }
  .body { padding:32px 40px; }
  .project-bar { background:#f5f5f5; border-left:4px solid #f5a623; padding:12px 20px; margin-bottom:24px; display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
  .project-bar .item label { font-size:8px; letter-spacing:2px; color:#999; display:block; margin-bottom:3px; text-transform:uppercase; }
  .project-bar .item span { font-size:12px; font-weight:bold; }
  table { width:100%; border-collapse:collapse; margin-bottom:32px; }
  th { background:#1a1a1a; color:#f5a623; padding:10px 12px; text-align:left; font-size:9px; letter-spacing:2px; text-transform:uppercase; }
  .confirm-box { border:1px solid #ddd; padding:20px; margin-bottom:24px; }
  .confirm-box h3 { font-size:9px; letter-spacing:2px; color:#f5a623; text-transform:uppercase; margin-bottom:12px; }
  .confirm-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .confirm-field label { font-size:9px; color:#999; display:block; margin-bottom:4px; }
  .confirm-field .line { border-bottom:1px solid #ccc; height:24px; }
  .footer { background:#f0f0f0; padding:10px 40px; display:flex; justify-content:space-between; font-size:8px; color:#999; letter-spacing:1px; text-transform:uppercase; margin-top:24px; }
  @media print { @page { margin:0.6in; } }
</style></head><body>

<div class="header">
  <div>
    <div class="co-name">${coName}</div>
    <div class="doc-type">Material Takeoff &amp; Order List</div>
  </div>
  <div class="doc-info">
    <div>${date}</div>
    ${brand.phone ? `<div>${brand.phone}</div>` : ""}
    ${brand.licenseNumber ? `<div>Lic# ${brand.licenseNumber}</div>` : ""}
  </div>
</div>
<div class="accent"></div>

<div class="body">
  <div class="project-bar">
    <div class="item"><label>Project</label><span>${jobInfo.projectName || address || "—"}</span></div>
    <div class="item"><label>Pour Type</label><span>${bidForm.pourType || "—"}</span></div>
    <div class="item"><label>Area</label><span>${sf > 0 ? sf + " SF" : "—"}</span></div>
    <div class="item"><label>Concrete</label><span>${cy > 0 ? cy.toFixed(1) + " CY" : "—"}</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Category</th>
        <th>Item</th>
        <th>Quantity to Order</th>
        <th>Notes</th>
        <th style="text-align:center;width:60px">✓ Ordered</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <div class="confirm-box">
    <h3>Supplier Confirmation</h3>
    <div class="confirm-grid">
      <div class="confirm-field"><label>Supplier / Ready-Mix Co.</label><div class="line"></div></div>
      <div class="confirm-field"><label>Contact Name</label><div class="line"></div></div>
      <div class="confirm-field"><label>Pour Date Confirmed</label><div class="line"></div></div>
      <div class="confirm-field"><label>Delivery Time</label><div class="line"></div></div>
      <div class="confirm-field"><label>Confirmed By</label><div class="line"></div></div>
      <div class="confirm-field"><label>Confirmation #</label><div class="line"></div></div>
    </div>
  </div>
</div>

<div class="footer">
  <span>${coName}</span>
  <span>${jobInfo.projectName || address || "Project"} — Material List</span>
  <span>${date}</span>
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportToPDF(address, bidForm, bidOutput, brand = {}, jobInfo = {}) {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const expiryDate = jobInfo.bidExpiry || (() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  })();
  const filename = `BidProposal_${(jobInfo.projectName || address || "Project").replace(/[^a-z0-9]/gi, "_").slice(0, 30)}_${new Date().toISOString().slice(0,10)}.html`;
  const coName = brand.companyName || "CONCRETE CONTRACTOR";
  const bidNumber = jobInfo.jobNumber || jobInfo.bidNumber || `JOB-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;

  // Parse total bid value from output
  const totalMatch = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
  const totalBid = totalMatch ? `$${totalMatch[1]}` : "See estimate below";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>BID PROPOSAL — ${coName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #222; font-size: 11pt; }

  /* COVER HEADER */
  .cover-header {
    background: #1a1a1a;
    color: #fff;
    padding: 40px 48px 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .co-name { font-size: 24px; font-weight: bold; letter-spacing: 1px; color: #fff; margin-bottom: 4px; }
  .co-tagline { font-size: 11px; color: #f5a623; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
  .co-contact { font-size: 10px; color: #aaa; line-height: 1.8; }
  .co-lic { font-size: 10px; color: #888; margin-top: 6px; }
  .doc-info { text-align: right; }
  .doc-title { font-size: 13px; font-weight: bold; color: #f5a623; letter-spacing: 2px; margin-bottom: 6px; }
  .doc-number { font-size: 11px; color: #aaa; margin-bottom: 4px; }
  .doc-date { font-size: 11px; color: #aaa; }

  /* AMBER ACCENT BAR */
  .accent-bar { height: 4px; background: #f5a623; }

  /* BODY */
  .body { padding: 40px 48px; }

  /* TO/FROM BLOCK */
  .to-from { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #eee; }
  .to-from-block label { font-size: 8px; letter-spacing: 3px; color: #f5a623; display: block; margin-bottom: 8px; text-transform: uppercase; font-weight: bold; }
  .to-from-block .name { font-size: 13px; font-weight: bold; color: #222; margin-bottom: 2px; }
  .to-from-block .sub { font-size: 11px; color: #666; line-height: 1.6; }

  /* PROJECT SUMMARY BOX */
  .project-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-left: 4px solid #f5a623; padding: 20px 24px; margin-bottom: 28px; }
  .project-box h3 { font-size: 9px; letter-spacing: 3px; color: #f5a623; text-transform: uppercase; margin-bottom: 14px; }
  .project-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .project-item label { font-size: 8px; letter-spacing: 1px; color: #999; display: block; margin-bottom: 3px; text-transform: uppercase; }
  .project-item span { font-size: 12px; font-weight: bold; color: #222; }

  /* TOTAL BID CALLOUT */
  .bid-callout { background: #1a1a1a; color: #f5a623; padding: 16px 24px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center; }
  .bid-callout .label { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #888; }
  .bid-callout .amount { font-size: 28px; font-weight: bold; }

  /* ESTIMATE DETAIL */
  .section-title { font-size: 9px; letter-spacing: 3px; color: #f5a623; text-transform: uppercase; font-weight: bold; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #f5a62333; }
  .estimate-body { font-family: 'Courier New', monospace; font-size: 10pt; white-space: pre-wrap; line-height: 1.8; color: #333; margin-bottom: 32px; background: #f8f8f8; padding: 20px; border: 1px solid #eee; }

  /* TERMS */
  .terms { margin-bottom: 32px; }
  .terms p { font-size: 10px; color: #666; line-height: 1.7; margin-bottom: 6px; }
  .terms strong { color: #333; }

  /* SIGNATURE BLOCK */
  .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 40px; padding-top: 24px; border-top: 1px solid #eee; }
  .sig-party label { font-size: 8px; letter-spacing: 2px; color: #999; display: block; margin-bottom: 40px; text-transform: uppercase; }
  .sig-line { border-bottom: 1px solid #333; margin-bottom: 6px; height: 1px; }
  .sig-name { font-size: 10px; color: #666; }
  .sig-title { font-size: 9px; color: #999; margin-top: 2px; }

  /* FOOTER */
  .footer { background: #f0f0f0; padding: 12px 48px; display: flex; justify-content: space-between; font-size: 8px; color: #999; letter-spacing: 1px; text-transform: uppercase; margin-top: 40px; }

  @media print { @page { margin: 0.75in; } body { font-size: 10pt; } .cover-header { padding: 32px; } .body { padding: 32px; } }
</style>
</head>
<body>

<!-- COVER HEADER -->
<div class="cover-header">
  <div>
    <div class="co-name">${coName.toUpperCase()}</div>
    <div class="co-tagline">${brand.tagline || "Concrete Contractor"}</div>
    <div class="co-contact">
      ${brand.phone ? `<div>${brand.phone}</div>` : ""}
      ${brand.email ? `<div>${brand.email}</div>` : ""}
      ${brand.city && brand.state ? `<div>${brand.city}, ${brand.state}</div>` : ""}
      ${brand.website ? `<div>${brand.website}</div>` : ""}
    </div>
    ${brand.licenseNumber ? `<div class="co-lic">License #${brand.licenseNumber}</div>` : ""}
  </div>
  <div class="doc-info">
    <div class="doc-title">BID PROPOSAL</div>
    <div class="doc-number">${bidNumber}</div>
    <div class="doc-date">Date: ${date}</div>
    <div class="doc-date" style="color:#f5a623;margin-top:4px;">Valid Until: ${expiryDate}</div>
  </div>
</div>
<div class="accent-bar"></div>

<div class="body">

  <!-- TO / FROM -->
  <div class="to-from">
    <div class="to-from-block">
      <label>Submitted To</label>
      <div class="name">${jobInfo.clientName || jobInfo.gcName || "___________________________"}</div>
      ${jobInfo.gcName && jobInfo.clientName ? `<div class="sub">GC: ${jobInfo.gcName}</div>` : ""}
      ${jobInfo.poNumber ? `<div class="sub">PO / Contract #: ${jobInfo.poNumber}</div>` : ""}
    </div>
    <div class="to-from-block">
      <label>Submitted By</label>
      <div class="name">${coName}</div>
      <div class="sub">${brand.phone || ""}${brand.phone && brand.email ? " · " : ""}${brand.email || ""}</div>
      ${brand.licenseNumber ? `<div class="sub">License #${brand.licenseNumber}</div>` : ""}
    </div>
  </div>

  <!-- PROJECT SUMMARY -->
  <div class="project-box">
    <h3>Project Information</h3>
    <div class="project-grid">
      <div class="project-item"><label>Project Name</label><span>${jobInfo.projectName || "—"}</span></div>
      <div class="project-item"><label>Job Site Address</label><span>${address || "—"}</span></div>
      <div class="project-item"><label>Pour Type</label><span>${bidForm.pourType || "—"}</span></div>
      <div class="project-item"><label>Area</label><span>${bidForm.sqft ? bidForm.sqft + " SF" : "—"}</span></div>
      <div class="project-item"><label>Thickness</label><span>${bidForm.thickness ? bidForm.thickness + '"' : "—"}</span></div>
      <div class="project-item"><label>Concrete Strength</label><span>${bidForm.psi ? bidForm.psi + " PSI" : "—"}</span></div>
      <div class="project-item"><label>Finish Type</label><span>${bidForm.finishType || "—"}</span></div>
      <div class="project-item"><label>Bid Number</label><span>${bidNumber}</span></div>
      <div class="project-item"><label>Valid Until</label><span>${expiryDate}</span></div>
    </div>
  </div>

  <!-- TOTAL BID CALLOUT -->
  <div class="bid-callout">
    <div>
      <div class="label">Total Bid Price</div>
      <div style="font-size:10px;color:#666;margin-top:2px;">All materials, labor, and equipment included</div>
    </div>
    <div class="amount">${totalBid}</div>
  </div>

  <!-- DETAILED ESTIMATE -->
  <div class="section-title">Detailed Estimate</div>
  <div class="estimate-body">${(bidOutput || "No estimate generated.").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>

  <!-- TERMS -->
  <div class="terms">
    <div class="section-title">Terms &amp; Conditions</div>
    <p><strong>Validity:</strong> This proposal is valid for 30 days from the date above. Pricing is subject to change after the expiration date.</p>
    <p><strong>Scope:</strong> This bid covers the concrete scope described above only. Any additional work, changes in scope, or unforeseen conditions will be addressed via written change order prior to execution.</p>
    <p><strong>Payment:</strong> Payment terms to be agreed upon contract execution. Standard terms are net 30 days from invoice date.</p>
    <p><strong>Exclusions:</strong> Permits, inspections, soil testing, underground utility locates, and survey work are excluded unless explicitly listed above.</p>
    <p><strong>Acceptance:</strong> This proposal becomes a binding agreement upon signature by both parties.</p>
  </div>

  <!-- SIGNATURE BLOCK -->
  <div class="signature-block">
    <div class="sig-party">
      <label>Contractor Acceptance</label>
      <div class="sig-line"></div>
      <div class="sig-name">${coName}</div>
      <div class="sig-title">Authorized Representative &nbsp;&nbsp;&nbsp; Date: ___________</div>
    </div>
    <div class="sig-party">
      <label>Client / GC Acceptance</label>
      <div class="sig-line"></div>
      <div class="sig-name">${jobInfo.clientName || jobInfo.gcName || "Client / General Contractor"}</div>
      <div class="sig-title">Authorized Representative &nbsp;&nbsp;&nbsp; Date: ___________</div>
    </div>
  </div>

</div>

<!-- FOOTER -->
<div class="footer">
  <span>${coName}${brand.licenseNumber ? ` · License #${brand.licenseNumber}` : ""}</span>
  <span>${bidNumber} · ${date}</span>
  <span>Verify all quantities before ordering</span>
</div>

</body>
</html>`;

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
  const [contacts, setContacts] = useState([]);
  const [newContact, setNewContact] = useState({ name: "", company: "", role: "GC", phone: "", email: "" });
  const [showContacts, setShowContacts] = useState(false);

  const [prices, setPrices] = useState(() => {
    const p = {};
    Object.entries(DEFAULT_PRICES).forEach(([k, v]) => { p[k] = { ...v }; });
    return p;
  });
  const [newPriceItem, setNewPriceItem] = useState({ label: "", price: "", unit: "SF", group: "Materials" });
  const [editingPriceKey, setEditingPriceKey] = useState(null);

  const [jobInfo, setJobInfo] = useState({
    clientName: "", gcName: "", projectName: "", jobNumber: "", bidExpiry: "", poNumber: "", notes: "",
  });

  const generateJobNumber = (existingJobs) => {
    const year = new Date().getFullYear();
    const nums = existingJobs
      .map(j => j.jobInfo?.jobNumber)
      .filter(n => n && n.startsWith(`JOB-${year}-`))
      .map(n => parseInt(n.split("-")[2]) || 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `JOB-${year}-${String(next).padStart(3, "0")}`;
  };

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
    linkedJobNumber: "",
    // Cost calculator
    addedSF: "", addedThickness: "4", rebarType: "none",
    laborItems: [{ role: "laborer", hours: "" }],
    equipmentItems: [{ type: "pump_truck", days: "" }],
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
      const jobKeys = await window.storage.list("job:");
      const coKeys = await window.storage.list("co:");
      const loaded = [];
      for (const key of (jobKeys?.keys || [])) {
        try {
          const res = await window.storage.get(key);
          if (res?.value) loaded.push(JSON.parse(res.value));
        } catch {}
      }
      for (const key of (coKeys?.keys || [])) {
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
    try {
      const res = await window.storage.get("contacts:book");
      if (res?.value) setContacts(JSON.parse(res.value));
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

  const saveContact = async (contact) => {
    const updated = [...contacts, { ...contact, id: Date.now() }];
    try { await window.storage.set("contacts:book", JSON.stringify(updated)); } catch {}
    setContacts(updated);
    setNewContact({ name: "", company: "", role: "GC", phone: "", email: "" });
  };

  const deleteContact = async (id) => {
    const updated = contacts.filter(c => c.id !== id);
    try { await window.storage.set("contacts:book", JSON.stringify(updated)); } catch {}
    setContacts(updated);
  };

  const applyContact = (contact) => {
    setJobInfo(prev => ({
      ...prev,
      clientName: contact.role === "Client" ? contact.name : prev.clientName,
      gcName: contact.role === "GC" ? contact.name : prev.gcName,
    }));
    setShowContacts(false);
    setPhase(1);
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
      estimate: calculateBidTotal(bidForm, prices),
      status: "draft",
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

  const saveChangeOrder = async (coOutput, linkedJobNumber) => {
    if (!coOutput || !linkedJobNumber) return;
    const co = {
      id: Date.now(),
      type: "change_order",
      linkedJobNumber,
      coOutput,
      coForm: { ...coForm },
      savedAt: new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    };
    try {
      await window.storage.set(`co:${co.id}`, JSON.stringify(co));
      await loadJobsFromStorage();
    } catch {
      setJobs(prev => [co, ...prev]);
    }
  };

  const updateJobStatus = async (id, status) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const updated = { ...job, status };
    try {
      await window.storage.set(`job:${id}`, JSON.stringify(updated));
      await loadJobsFromStorage();
    } catch {
      setJobs(prev => prev.map(j => j.id === id ? updated : j));
    }
  };

  const updateJobCloseout = async (id, closeout) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const updated = { ...job, closeout };
    try {
      await window.storage.set(`job:${id}`, JSON.stringify(updated));
      await loadJobsFromStorage();
    } catch {
      setJobs(prev => prev.map(j => j.id === id ? updated : j));
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

  const quickRebid = (job) => {
    setAddress(job.address || "");
    setBidForm({ ...job.bidForm });
    setBidOutput(""); // clear output so they generate fresh
    if (job.jobInfo) setJobInfo({ ...job.jobInfo, notes: job.jobInfo.notes || "" });
    setCurrentJobKey(job.projectKey || null);
    setBidStatus({ text: `REBID READY — ADJUST SPECS AND GENERATE`, type: "idle" });
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
    const res = await fetch("/api/claude", {
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
Rebar Required: ${bidForm.rebar === "none" ? "None" : (prices[bidForm.rebar]?.label || bidForm.rebar)} ${bidForm.rebar !== "none" && prices[bidForm.rebar] ? `@ $${prices[bidForm.rebar].price}/${prices[bidForm.rebar].unit}` : ""}
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
      const res = await fetch("/api/claude", {
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
Original Contract Value: ${(() => { const m = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i); return m ? `$${m[1]}` : "Not available"; })()}
Estimated Cost Impact: ${coForm.manualOverride ? (coForm.manualCostImpact || "To be calculated") : (() => {
      const P = prices;
      const sf = parseFloat(coForm.addedSF || 0);
      const tk = parseFloat(coForm.addedThickness || 4);
      const cy = sf > 0 ? (sf * (tk / 12)) / 27 * 1.05 : 0;
      const concreteCost = cy * (P[`concrete_${bidForm.psi}`]?.price || P.concrete_3000?.price || 155);
      const rebarItem = P[coForm.rebarType];
      const rebarLbPerSF = coForm.rebarType?.includes("5") ? 0.85 : 0.55;
      const rebarCost = coForm.rebarType === "none" || !rebarItem ? 0
        : rebarItem.unit === "SF" ? sf * rebarItem.price
        : sf * rebarLbPerSF * rebarItem.price;
      const laborCost = (coForm.laborItems || []).reduce((sum, item) => {
        return sum + parseFloat(item.hours || 0) * (P[item.role]?.price || P.laborer?.price || 42);
      }, 0);
      const equipCost = (coForm.equipmentItems || []).reduce((sum, item) => {
        return sum + parseFloat(item.days || 0) * (P[item.type]?.price || 0);
      }, 0);
      const sfCost = sf * ((P.placement_labor?.price || 1.20) + (P.finishing_labor?.price || 2.85));
      const subtotal = concreteCost + rebarCost + sfCost + laborCost + equipCost;
      const total = subtotal * 1.12 * 1.10;
      const origMatch = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
      const orig = origMatch ? parseFloat(origMatch[1].replace(/,/g, "")) : null;
      const revised = orig && total > 0 ? `$${(orig + total).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "N/A";
      return total > 0 ? `+$${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} — Revised Contract Total: ${revised}` : "To be calculated";
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
          .header-bar { padding: 10px 16px !important; }
          .form-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Header */}
      <div className="header-bar" style={{ background: "#111", borderBottom: "2px solid #f5a623", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "17px", fontWeight: "bold", letterSpacing: "1px", color: "#fff" }}>
              {brand.companyName || "CONCRETE FIELD OPS"}
            </div>
            <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#f5a623", marginTop: "2px" }}>
              {brand.licenseNumber ? `LIC# ${brand.licenseNumber}` : "POWERED BY CLAUDE AI"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {brand.phone && <div style={{ fontSize: "11px", color: "#666" }}>{brand.phone}</div>}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "10px", color: "#4caf50", letterSpacing: "1px" }}>● LIVE</div>
            <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{jobs.length} JOB{jobs.length !== 1 ? "S" : ""} SAVED</div>
          </div>
          <button onClick={() => setPhase(5)} style={{ background: "transparent", border: "1px solid #333", color: "#555", padding: "6px 12px", fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer" }}>
            ⚙ SETTINGS
          </button>
        </div>
      </div>

      {/* Phase Tabs */}
      <div className="tab-bar" style={{ display: "flex", borderBottom: "2px solid #1a1a1a", background: "#0d0d0d", overflowX: "auto" }}>
        {PHASES.map((p, i) => (
          <button key={p} onClick={() => setPhase(i)} style={{
            background: phase === i ? "#111" : "transparent",
            color: phase === i ? "#f5a623" : "#444",
            border: "none", borderBottom: phase === i ? "2px solid #f5a623" : "2px solid transparent",
            padding: "13px 22px", fontFamily: "'Courier New', monospace", fontSize: "10px",
            letterSpacing: "2px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            transition: "all 0.15s",
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
              <SectionLabel>MONDAY MORNING NUMBERS</SectionLabel>
              {(() => {
                const latestByProject = {};
                jobs.forEach(j => {
                  const key = j.projectKey || j.id;
                  if (!latestByProject[key] || (j.version || 1) > (latestByProject[key].version || 1)) latestByProject[key] = j;
                });
                const latest = Object.values(latestByProject);
                const won = latest.filter(j => j.status === "won");
                const lost = latest.filter(j => j.status === "lost");
                const submitted = latest.filter(j => j.status === "submitted");
                const decided = won.length + lost.length;
                const closeRate = decided > 0 ? Math.round((won.length / decided) * 100) : null;
                const pipelineValue = submitted.reduce((s, j) => s + getJobBidTotal(j), 0);
                const closedJobs = latest.filter(j => j.status === "won" && j.closeout?.actualCost);
                const totalRevenue = closedJobs.reduce((s, j) => s + parseFloat(j.closeout.actualRevenue || 0), 0);
                const totalCost = closedJobs.reduce((s, j) => s + parseFloat(j.closeout.actualCost || 0), 0);
                const avgMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1) : null;

                return (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                      <div style={{ background: "#111", borderLeft: "3px solid #2196f3", padding: "12px 14px" }}>
                        <div style={{ fontSize: "8px", letterSpacing: "2px", color: "#555", marginBottom: "4px" }}>PIPELINE VALUE</div>
                        <div style={{ fontSize: "20px", fontWeight: "bold", color: "#2196f3" }}>
                          {pipelineValue > 0 ? `$${pipelineValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                        </div>
                        <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{submitted.length} bid{submitted.length !== 1 ? "s" : ""} outstanding</div>
                      </div>
                      <div style={{ background: "#111", borderLeft: "3px solid #4caf50", padding: "12px 14px" }}>
                        <div style={{ fontSize: "8px", letterSpacing: "2px", color: "#555", marginBottom: "4px" }}>CLOSE RATE</div>
                        <div style={{ fontSize: "20px", fontWeight: "bold", color: closeRate !== null ? (closeRate >= 50 ? "#4caf50" : "#f5a623") : "#333" }}>
                          {closeRate !== null ? `${closeRate}%` : "—"}
                        </div>
                        <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{won.length}W · {lost.length}L of {decided} decided</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <div style={{ background: "#111", borderLeft: "3px solid #f5a623", padding: "12px 14px" }}>
                        <div style={{ fontSize: "8px", letterSpacing: "2px", color: "#555", marginBottom: "4px" }}>JOBS TRACKED</div>
                        <div style={{ fontSize: "20px", fontWeight: "bold", color: "#f5a623" }}>{latest.length}</div>
                        <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>across all statuses</div>
                      </div>
                      <div style={{ background: "#111", borderLeft: "3px solid #9c27b0", padding: "12px 14px" }}>
                        <div style={{ fontSize: "8px", letterSpacing: "2px", color: "#555", marginBottom: "4px" }}>AVG MARGIN</div>
                        <div style={{ fontSize: "20px", fontWeight: "bold", color: avgMargin !== null ? (parseFloat(avgMargin) >= 20 ? "#4caf50" : parseFloat(avgMargin) >= 10 ? "#f5a623" : "#e53935") : "#333" }}>
                          {avgMargin !== null ? `${avgMargin}%` : "—"}
                        </div>
                        <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>{closedJobs.length} closed job{closedJobs.length !== 1 ? "s" : ""} with actuals</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <button onClick={() => setPhase(1)} style={{ width: "100%", background: "#f5a623", color: "#000", border: "none", padding: "10px", fontFamily: "'Courier New', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer", fontWeight: "bold", marginTop: "4px" }}>
                + NEW BID
              </button>
            </>
          )}

          {/* PHASE 1: Bid Engine */}
          {phase === 1 && (
            <>
              <SectionLabel>POUR SPECIFICATIONS</SectionLabel>

              {/* Job site address — plain input */}
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>JOB SITE ADDRESS</label>
                <input
                  style={inputStyle}
                  placeholder="123 Main St, City, State..."
                  value={address}
                  autoComplete="off"
                  onChange={e => setAddress(e.target.value)}
                />
              </div>
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
                  <label style={labelStyle}>CONCRETE MIX</label>
                  <select style={inputStyle} value={bidForm.psi} onChange={e => setBidForm({ ...bidForm, psi: e.target.value })}>
                    {Object.entries(prices)
                      .filter(([, v]) => v.group === "Concrete")
                      .map(([key, item]) => {
                        // Extract PSI value from key (e.g. concrete_3000 → 3000)
                        const psiMatch = key.match(/concrete_(\d+)/);
                        const psiVal = psiMatch ? psiMatch[1] : key;
                        return (
                          <option key={key} value={psiVal}>
                            {item.label} — ${item.price}/{item.unit}
                          </option>
                        );
                      })
                    }
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>REBAR / REINFORCEMENT</label>
                  <select style={inputStyle} value={bidForm.rebar} onChange={e => setBidForm({ ...bidForm, rebar: e.target.value })}>
                    <option value="none">None</option>
                    {Object.entries(prices)
                      .filter(([, v]) => v.group === "Reinforcement")
                      .map(([key, item]) => (
                        <option key={key} value={key}>
                          {item.label} — ${item.price}/{item.unit}
                        </option>
                      ))
                    }
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
              <button onClick={() => {
                if (!showJobInfo && !jobInfo.jobNumber) {
                  setJobInfo(prev => ({ ...prev, jobNumber: generateJobNumber(jobs) }));
                }
                setShowJobInfo(!showJobInfo);
              }} style={{
                width: "100%", background: showJobInfo ? "#1a1a2a" : "transparent", color: showJobInfo ? "#ff9800" : "#555",
                border: `1px solid ${showJobInfo ? "#ff9800" : "#333"}`, padding: "8px",
                fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer", marginBottom: showJobInfo ? "10px" : "0",
              }}>
                {showJobInfo ? "▲" : "▼"} CLIENT / JOB INFO
              </button>

              {/* Contact quick-select */}
              {showJobInfo && contacts.length > 0 && (
                <div style={{ background: "#0d0d0d", border: "1px solid #ff980033", padding: "10px", marginBottom: "10px" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#ff9800", marginBottom: "8px" }}>QUICK SELECT FROM CONTACTS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {contacts.map(c => (
                      <button key={c.id} onClick={() => applyContact(c)} style={{
                        background: "#1a1a00", color: "#f5a623", border: "1px solid #f5a62344",
                        padding: "4px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer",
                      }}>
                        {c.name} ({c.role})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showJobInfo && (
                <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #ff9800", padding: "14px", marginBottom: "8px" }}>
                  <div style={{ ...labelStyle, color: "#ff9800", marginBottom: "12px" }}>JOB & CLIENT DETAILS</div>
                  {[
                    { key: "projectName", label: "PROJECT NAME", placeholder: "Main St. Warehouse Slab" },
                    { key: "clientName", label: "CLIENT NAME", placeholder: "Acme Properties LLC" },
                    { key: "gcName", label: "GENERAL CONTRACTOR", placeholder: "BuildRight Construction" },
                    { key: "jobNumber", label: "JOB NUMBER", placeholder: "JOB-2025-001" },
                    { key: "poNumber", label: "PO / CONTRACT #", placeholder: "PO-88432" },
                    { key: "bidExpiry", label: "BID EXPIRY DATE", placeholder: "30 days from date" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key} style={{ marginBottom: "10px" }}>
                      <label style={labelStyle}>{label}</label>
                      <input style={inputStyle} placeholder={placeholder} value={jobInfo[key]} onChange={e => setJobInfo({ ...jobInfo, [key]: e.target.value })} />
                    </div>
                  ))}
                  <div style={{ marginBottom: "10px" }}>
                    <label style={labelStyle}>BID NOTES</label>
                    <textarea style={{ ...inputStyle, height: "70px", resize: "vertical" }}
                      placeholder="GC wants VE options... tight access, add mobilization... owner may expand scope..."
                      value={jobInfo.notes}
                      onChange={e => setJobInfo({ ...jobInfo, notes: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* PHASE 2: As-Built */}
          {/* PHASE 2: Change Order */}
          {phase === 2 && (
            <>
              <SectionLabel>CHANGE ORDER DETAILS</SectionLabel>

              {/* Job number selector — dropdown + manual entry */}
              <div style={{ marginBottom: "14px" }}>
                <label style={labelStyle}>REFERENCE JOB NUMBER *</label>
                {(() => {
                  const savedJobs = jobs.filter(j => j.type !== "change_order" && j.jobInfo?.jobNumber);
                  const uniqueJobs = [];
                  const seen = new Set();
                  savedJobs.forEach(j => {
                    if (!seen.has(j.jobInfo.jobNumber)) {
                      seen.add(j.jobInfo.jobNumber);
                      uniqueJobs.push(j);
                    }
                  });
                  return (
                    <div>
                      {uniqueJobs.length > 0 && (
                        <select style={{ ...inputStyle, marginBottom: "8px" }}
                          value={coForm.linkedJobNumber}
                          onChange={e => {
                            const val = e.target.value;
                            const selected = uniqueJobs.find(j => j.jobInfo.jobNumber === val);
                            if (selected) {
                              loadJob(selected);
                              setCoForm(prev => ({ ...prev, linkedJobNumber: val }));
                              setPhase(2);
                            } else {
                              setCoForm(prev => ({ ...prev, linkedJobNumber: val }));
                            }
                          }}>
                          <option value="">— Select saved job —</option>
                          {uniqueJobs.map(j => (
                            <option key={j.id} value={j.jobInfo.jobNumber}>
                              {j.jobInfo.jobNumber} — {j.jobInfo.projectName || j.address || "No name"} · ${getJobBidTotal(j).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </option>
                          ))}
                        </select>
                      )}
                      <div style={{ fontSize: "9px", color: "#555", marginBottom: "4px", letterSpacing: "1px" }}>
                        {uniqueJobs.length > 0 ? "OR ENTER MANUALLY:" : "ENTER JOB NUMBER:"}
                      </div>
                      <input style={inputStyle} placeholder="JOB-2025-001"
                        value={coForm.linkedJobNumber}
                        onChange={e => setCoForm({ ...coForm, linkedJobNumber: e.target.value })} />
                    </div>
                  );
                })()}
              </div>

              {/* Original contract value — auto-pulled from loaded bid */}
              {(() => {
                const match = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
                const originalValue = match ? parseFloat(match[1].replace(/,/g, "")) : null;
                return originalValue ? (
                  <div style={{ background: "#0d1a0d", border: "1px solid #4caf5033", borderLeft: "3px solid #4caf50", padding: "10px 14px", marginBottom: "14px", fontFamily: "'Courier New', monospace" }}>
                    <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#4caf50", marginBottom: "4px" }}>ORIGINAL CONTRACT VALUE</div>
                    <div style={{ fontSize: "18px", fontWeight: "bold", color: "#4caf50" }}>${originalValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
                    <div style={{ fontSize: "9px", color: "#555", marginTop: "3px" }}>{bidForm.pourType} · {bidForm.sqft} SF · {address || "No address"}</div>
                  </div>
                ) : (
                  <div style={{ background: "#111", border: "1px solid #e5393522", padding: "10px 12px", marginBottom: "14px", fontSize: "10px", color: "#888", lineHeight: "1.7" }}>
                    No bid loaded. Go to BID ENGINE, generate a bid, then return here — the original contract value will auto-populate.
                  </div>
                );
              })()}

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
                  const rebarItem2 = P[coForm.rebarType];
                  const rebarLbPerSF = coForm.rebarType?.includes("5") ? 0.85 : 0.55;
                  const rebarCost = coForm.rebarType === "none" || !rebarItem2 ? 0
                    : rebarItem2.unit === "SF" ? sfVal * rebarItem2.price
                    : sfVal * rebarLbPerSF * rebarItem2.price;
                  const concreteRate = P[`concrete_${bidForm.psi}`]?.price || P.concrete_3000?.price || 155;
                  const laborCost = (coForm.laborItems || []).reduce((sum, item) => sum + parseFloat(item.hours || 0) * (P[item.role]?.price || P.laborer?.price || 42), 0);
                  const equipCost = (coForm.equipmentItems || []).reduce((sum, item) => sum + parseFloat(item.days || 0) * (P[item.type]?.price || 0), 0);
                  const concreteCost = cyVal * concreteRate;
                  const sfCost = sfVal * ((P.placement_labor?.price || 1.20) + (P.finishing_labor?.price || 2.85));
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
                          {Object.entries(prices)
                            .filter(([, v]) => v.group === "Reinforcement")
                            .map(([key, item]) => (
                              <option key={key} value={key}>{item.label} — ${item.price}/{item.unit}</option>
                            ))
                          }
                        </select>
                      </div>

                      {/* LABOR — multiple rows */}
                      <div style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>LABOR</label>
                          <button onClick={() => setCoForm(prev => ({ ...prev, laborItems: [...(prev.laborItems || []), { role: "laborer", hours: "" }] }))} style={{ background: "transparent", color: "#f5a623", border: "1px solid #f5a62344", padding: "2px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>+ ADD</button>
                        </div>
                        {(coForm.laborItems || [{ role: "laborer", hours: "" }]).map((item, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 80px 28px", gap: "4px", marginBottom: "4px", alignItems: "center" }}>
                            <select style={{ ...inputStyle, fontSize: "11px" }} value={item.role}
                              onChange={e => {
                                const updated = [...(coForm.laborItems || [])];
                                updated[idx] = { ...updated[idx], role: e.target.value };
                                setCoForm(prev => ({ ...prev, laborItems: updated }));
                              }}>
                              {[["foreman","Foreman"],["journeyman","Journeyman"],["laborer","Laborer"],["rebar_crew","Rebar Crew"]].map(([v,l]) => <option key={v} value={v}>{l} — ${P[v]?.price || "?"}/HR</option>)}
                            </select>
                            <input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="hrs"
                              value={item.hours}
                              onChange={e => {
                                const updated = [...(coForm.laborItems || [])];
                                updated[idx] = { ...updated[idx], hours: e.target.value };
                                setCoForm(prev => ({ ...prev, laborItems: updated }));
                              }} />
                            <button onClick={() => {
                              const updated = (coForm.laborItems || []).filter((_, i) => i !== idx);
                              setCoForm(prev => ({ ...prev, laborItems: updated.length ? updated : [{ role: "laborer", hours: "" }] }));
                            }} style={{ background: "transparent", color: "#e53935", border: "none", fontSize: "14px", cursor: "pointer", padding: "0" }}>×</button>
                          </div>
                        ))}
                      </div>

                      {/* EQUIPMENT — multiple rows */}
                      <div style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <label style={{ ...labelStyle, fontSize: "9px", color: "#888" }}>EQUIPMENT</label>
                          <button onClick={() => setCoForm(prev => ({ ...prev, equipmentItems: [...(prev.equipmentItems || []), { type: "pump_truck", days: "" }] }))} style={{ background: "transparent", color: "#f5a623", border: "1px solid #f5a62344", padding: "2px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>+ ADD</button>
                        </div>
                        {(coForm.equipmentItems || [{ type: "pump_truck", days: "" }]).map((item, idx) => (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 80px 28px", gap: "4px", marginBottom: "4px", alignItems: "center" }}>
                            <select style={{ ...inputStyle, fontSize: "11px" }} value={item.type}
                              onChange={e => {
                                const updated = [...(coForm.equipmentItems || [])];
                                updated[idx] = { ...updated[idx], type: e.target.value };
                                setCoForm(prev => ({ ...prev, equipmentItems: updated }));
                              }}>
                              {[["pump_truck","Pump Truck"],["bull_float","Bull Float"],["power_trowel","Power Trowel"],["plate_compactor","Compactor"],["concrete_saw","Concrete Saw"]].map(([v,l]) => <option key={v} value={v}>{l} — ${P[v]?.price || "?"}/DAY</option>)}
                            </select>
                            <input style={{ ...inputStyle, fontSize: "12px" }} type="number" placeholder="days"
                              value={item.days}
                              onChange={e => {
                                const updated = [...(coForm.equipmentItems || [])];
                                updated[idx] = { ...updated[idx], days: e.target.value };
                                setCoForm(prev => ({ ...prev, equipmentItems: updated }));
                              }} />
                            <button onClick={() => {
                              const updated = (coForm.equipmentItems || []).filter((_, i) => i !== idx);
                              setCoForm(prev => ({ ...prev, equipmentItems: updated.length ? updated : [{ type: "pump_truck", days: "" }] }));
                            }} style={{ background: "transparent", color: "#e53935", border: "none", fontSize: "14px", cursor: "pointer", padding: "0" }}>×</button>
                          </div>
                        ))}
                      </div>
                      {/* Live cost summary */}
                      <div style={{ background: "#111", border: "1px solid #e5393533", padding: "10px 12px", fontFamily: "'Courier New', monospace", fontSize: "11px" }}>
                        {[
                          concreteCost > 0 && [`Concrete (${cyVal.toFixed(1)} CY @ $${concreteRate})`, concreteCost],
                          sfCost > 0 && [`Placement + Finish (${sfVal} SF)`, sfCost],
                          rebarCost > 0 && [`Reinforcement (${P[coForm.rebarType]?.label || coForm.rebarType})`, rebarCost],
                          laborCost > 0 && [`Labor (${(coForm.laborItems || []).length} role${(coForm.laborItems || []).length !== 1 ? "s" : ""})`, laborCost],
                          equipCost > 0 && [`Equipment (${(coForm.equipmentItems || []).length} item${(coForm.equipmentItems || []).length !== 1 ? "s" : ""})`, equipCost],
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
                        {(() => {
                          const origMatch = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
                          const orig = origMatch ? parseFloat(origMatch[1].replace(/,/g, "")) : null;
                          if (!orig || total === 0) return null;
                          return (
                            <div style={{ borderTop: "1px solid #2a2a2a", marginTop: "6px", paddingTop: "6px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", color: "#555", fontSize: "10px", marginBottom: "3px" }}>
                                <span>Original Contract</span><span>${orig.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", color: "#4caf50", fontWeight: "bold", fontSize: "12px" }}>
                                <span>REVISED CONTRACT</span><span>${(orig + total).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                              </div>
                            </div>
                          );
                        })()}
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
          {/* PHASE 3: Job History Controls */}
          {phase === 3 && (
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
          {phase === 4 && (
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
          {phase === 5 && (
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

              {/* CLIENT CONTACT BOOK */}
              <div style={{ marginTop: "20px" }}>
                <SectionLabel>CLIENT CONTACT BOOK</SectionLabel>
                <div style={{ fontSize: "10px", color: "#555", marginBottom: "12px", lineHeight: "1.6" }}>
                  Save GC and client contacts. Quick-select them when building a bid.
                </div>

                {/* Add new contact */}
                <div style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: "3px solid #ff9800", padding: "12px", marginBottom: "12px" }}>
                  <div style={{ ...labelStyle, color: "#ff9800", marginBottom: "10px" }}>ADD CONTACT</div>
                  <div style={{ marginBottom: "8px" }}>
                    <label style={{ ...labelStyle, fontSize: "9px" }}>NAME</label>
                    <input style={inputStyle} placeholder="John Smith" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <label style={{ ...labelStyle, fontSize: "9px" }}>COMPANY</label>
                    <input style={inputStyle} placeholder="BuildRight Construction" value={newContact.company} onChange={e => setNewContact({ ...newContact, company: e.target.value })} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: "9px" }}>ROLE</label>
                      <select style={inputStyle} value={newContact.role} onChange={e => setNewContact({ ...newContact, role: e.target.value })}>
                        {["GC", "Client", "Owner", "Architect", "Engineer", "Other"].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ ...labelStyle, fontSize: "9px" }}>PHONE</label>
                      <input style={inputStyle} placeholder="555-000-0000" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ marginBottom: "10px" }}>
                    <label style={{ ...labelStyle, fontSize: "9px" }}>EMAIL</label>
                    <input style={inputStyle} placeholder="john@builright.com" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
                  </div>
                  <button onClick={() => newContact.name && saveContact(newContact)} style={{
                    width: "100%", background: newContact.name ? "#ff9800" : "#2a2a2a",
                    color: newContact.name ? "#000" : "#555", border: "none", padding: "10px",
                    fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: newContact.name ? "pointer" : "not-allowed",
                  }}>+ SAVE CONTACT</button>
                </div>

                {/* Contact list */}
                {contacts.length === 0 ? (
                  <div style={{ color: "#444", fontSize: "10px", textAlign: "center", padding: "20px 0" }}>NO CONTACTS YET</div>
                ) : (
                  contacts.map(c => (
                    <div key={c.id} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", padding: "10px 12px", marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ color: "#f0ece0", fontSize: "12px", fontWeight: "bold" }}>{c.name}</div>
                        <div style={{ color: "#888", fontSize: "10px" }}>{c.role} · {c.company}</div>
                        {c.phone && <div style={{ color: "#666", fontSize: "9px" }}>{c.phone}</div>}
                        {c.email && <div style={{ color: "#666", fontSize: "9px" }}>{c.email}</div>}
                      </div>
                      <button onClick={() => deleteContact(c.id)} style={{
                        background: "transparent", color: "#e53935", border: "1px solid #e5393533",
                        padding: "3px 8px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer",
                      }}>DEL</button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {/* PHASE 6: Help */}
          {phase === 6 && (
            <>
              <SectionLabel>HELP & GUIDE</SectionLabel>
              <div style={{ fontSize: "11px", color: "#666", lineHeight: "1.8", marginBottom: "16px" }}>
                Concrete Field Ops is an AI-powered platform built for concrete subcontractors. It handles bidding, change orders, job tracking, and profit analysis — all in one place.
              </div>

              {[
                { label: "📊 Dashboard", desc: "Home base. Job status, win rate, profit analytics." },
                { label: "🏗 Bid Engine", desc: "AI-generated estimates using your Price Book rates. Export proposals and material lists." },
                { label: "📋 Change Order", desc: "Link COs to jobs by number. Auto-pulls original contract value." },
                { label: "📂 Job History", desc: "Full job file per job number — bids, revisions, and COs in one view." },
                { label: "💲 Price Book", desc: "Your actual rates. All calculations use these numbers." },
                { label: "⚙ Settings", desc: "Company branding and client contact book." },
              ].map(({ label, desc }) => (
                <div key={label} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", padding: "10px 12px", marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#f0ece0", marginBottom: "3px" }}>{label}</div>
                  <div style={{ fontSize: "10px", color: "#666", lineHeight: "1.5" }}>{desc}</div>
                </div>
              ))}

              <div style={{ background: "#0d1a0d", border: "1px solid #4caf5033", borderLeft: "3px solid #4caf50", padding: "12px", marginTop: "8px" }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#4caf50", marginBottom: "8px" }}>FIRST TIME SETUP</div>
                {["1. Set your rates in Price Book", "2. Add branding in Settings", "3. Create your first bid in Bid Engine", "4. Save it — it appears in Dashboard and Job History"].map(s => (
                  <div key={s} style={{ fontSize: "10px", color: "#888", marginBottom: "6px" }}>→ {s}</div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right Panel */}
        <div className="right-panel" style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#0a0a0a" }}>

          {phase === 0 && (
            <>
              {jobs.length === 0 ? (
                <div style={{ color: "#444", fontSize: "12px", letterSpacing: "1px", marginTop: "40px", textAlign: "center" }}>
                  <div style={{ fontSize: "32px", marginBottom: "16px" }}>📋</div>
                  <div>NO JOBS SAVED YET</div>
                  <div style={{ fontSize: "10px", color: "#333", marginTop: "8px" }}>Generate a bid and hit SAVE JOB to get started.</div>
                </div>
              ) : (() => {
                const latestByProject = {};
                jobs.forEach(j => {
                  const key = j.projectKey || j.id;
                  if (!latestByProject[key] || (j.version || 1) > (latestByProject[key].version || 1)) latestByProject[key] = j;
                });
                const latest = Object.values(latestByProject).sort((a, b) => b.id - a.id);
                const now = Date.now();

                // Expiring soon (submitted bids within 7 days)
                const expiringSoon = latest.filter(j => {
                  if ((j.status || "draft") !== "submitted") return false;
                  const expiryDate = j.jobInfo?.bidExpiry
                    ? new Date(j.jobInfo.bidExpiry).getTime()
                    : j.id + (30 * 24 * 60 * 60 * 1000);
                  const daysLeft = Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000));
                  return daysLeft <= 7;
                });

                // Open closeouts — won but no actual cost
                const openCloseouts = latest.filter(j => j.status === "won" && !j.closeout?.actualCost);

                // Active submitted bids
                const submitted = latest.filter(j => j.status === "submitted");

                // Best pour type by margin
                const closedWithActuals = latest.filter(j => j.status === "won" && j.closeout?.actualCost);
                const byPourType = {};
                closedWithActuals.forEach(j => {
                  const pt = j.bidForm?.pourType || "other";
                  const rev = parseFloat(j.closeout.actualRevenue || 0);
                  const cost = parseFloat(j.closeout.actualCost || 0);
                  if (!byPourType[pt]) byPourType[pt] = { revenue: 0, cost: 0, count: 0 };
                  byPourType[pt].revenue += rev;
                  byPourType[pt].cost += cost;
                  byPourType[pt].count++;
                });
                const bestPourType = Object.entries(byPourType)
                  .map(([pt, d]) => ({ pt, margin: d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0, count: d.count }))
                  .sort((a, b) => b.margin - a.margin)[0];

                return (
                  <div>
                    {/* EXPIRING SOON */}
                    {expiringSoon.length > 0 && (
                      <div style={{ marginBottom: "24px" }}>
                        <SectionLabel>⚠ EXPIRING THIS WEEK</SectionLabel>
                        {expiringSoon.map(job => {
                          const expiryDate = job.jobInfo?.bidExpiry
                            ? new Date(job.jobInfo.bidExpiry).getTime()
                            : job.id + (30 * 24 * 60 * 60 * 1000);
                          const daysLeft = Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000));
                          const bidValue = getJobBidTotal(job);
                          return (
                            <div key={job.id} style={{ background: "#0d0d0d", border: `1px solid ${daysLeft <= 3 ? "#e53935" : "#f5a623"}`, borderLeft: `3px solid ${daysLeft <= 3 ? "#e53935" : "#f5a623"}`, padding: "12px 14px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "12px", color: "#f0ece0", fontWeight: "bold", marginBottom: "2px" }}>{job.jobInfo?.projectName || job.address || "Unnamed"}</div>
                                <div style={{ fontSize: "10px", color: "#888" }}>{bidValue > 0 ? `$${bidValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"} · {job.jobInfo?.clientName || job.jobInfo?.gcName || "No client"}</div>
                                <div style={{ fontSize: "9px", color: daysLeft <= 3 ? "#e53935" : "#f5a623", marginTop: "4px", fontWeight: "bold" }}>
                                  {daysLeft <= 0 ? "EXPIRED" : `EXPIRES IN ${daysLeft} DAY${daysLeft === 1 ? "" : "S"}`}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button onClick={() => { loadJob(job); setPhase(1); }} style={{ background: "#f5a623", color: "#000", border: "none", padding: "6px 12px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer", fontWeight: "bold" }}>REVISE</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* OPEN CLOSEOUTS */}
                    {openCloseouts.length > 0 && (
                      <div style={{ marginBottom: "24px" }}>
                        <SectionLabel>ACTION NEEDED — CLOSE OUT WON JOBS</SectionLabel>
                        {openCloseouts.map(job => {
                          const bidValue = getJobBidTotal(job);
                          return (
                            <div key={job.id} style={{ background: "#0d0d0d", border: "1px solid #4caf5033", borderLeft: "3px solid #4caf50", padding: "12px 14px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "12px", color: "#f0ece0", fontWeight: "bold", marginBottom: "2px" }}>{job.jobInfo?.projectName || job.address || "Unnamed"}</div>
                                <div style={{ fontSize: "10px", color: "#888" }}>{bidValue > 0 ? `$${bidValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"} · Enter actuals to track margin</div>
                              </div>
                              <button onClick={() => { loadJob(job); setPhase(0); }} style={{ background: "transparent", color: "#4caf50", border: "1px solid #4caf5044", padding: "6px 12px", fontFamily: "'Courier New', monospace", fontSize: "9px", cursor: "pointer" }}>CLOSE OUT</button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* BEST POUR TYPE */}
                    {bestPourType && (
                      <div style={{ marginBottom: "24px" }}>
                        <SectionLabel>BEST MARGIN WORK</SectionLabel>
                        <div style={{ background: "#0d0d0d", border: "1px solid #9c27b033", borderLeft: "3px solid #9c27b0", padding: "14px" }}>
                          <div style={{ fontSize: "16px", fontWeight: "bold", color: "#9c27b0", marginBottom: "4px" }}>
                            {bestPourType.pt.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                          </div>
                          <div style={{ fontSize: "12px", color: "#4caf50", marginBottom: "2px" }}>{bestPourType.margin.toFixed(1)}% avg margin</div>
                          <div style={{ fontSize: "10px", color: "#555" }}>Based on {bestPourType.count} closed job{bestPourType.count !== 1 ? "s" : ""} with actual costs entered</div>
                        </div>
                      </div>
                    )}

                    {/* SUBMITTED PIPELINE */}
                    {submitted.length > 0 && (
                      <div style={{ marginBottom: "24px" }}>
                        <SectionLabel>SUBMITTED — AWAITING DECISION</SectionLabel>
                        {submitted.map(job => {
                          const bidValue = getJobBidTotal(job);
                          const expiryDate = job.jobInfo?.bidExpiry
                            ? new Date(job.jobInfo.bidExpiry).getTime()
                            : job.id + (30 * 24 * 60 * 60 * 1000);
                          const daysLeft = Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000));
                          return (
                            <div key={job.id} style={{ background: "#0d0d0d", border: "1px solid #2196f333", borderLeft: "3px solid #2196f3", padding: "12px 14px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: "12px", color: "#f0ece0", fontWeight: "bold", marginBottom: "2px" }}>{job.jobInfo?.projectName || job.address || "Unnamed"}</div>
                                <div style={{ fontSize: "10px", color: "#888" }}>
                                  {bidValue > 0 ? `$${bidValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                                  {job.jobInfo?.clientName ? ` · ${job.jobInfo.clientName}` : ""}
                                  {job.bidForm?.pourType ? ` · ${job.bidForm.pourType.replace(/-/g, " ")}` : ""}
                                </div>
                                <div style={{ fontSize: "9px", color: daysLeft <= 7 ? "#f5a623" : "#555", marginTop: "4px" }}>
                                  {daysLeft > 0 ? `${daysLeft} days until expiry` : "Expired"}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button onClick={() => updateJobStatus(job.id, "won")} style={{ background: "#4caf5022", color: "#4caf50", border: "1px solid #4caf5044", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "8px", cursor: "pointer" }}>WON</button>
                                <button onClick={() => updateJobStatus(job.id, "lost")} style={{ background: "#e5393522", color: "#e53935", border: "1px solid #e5393544", padding: "5px 10px", fontFamily: "'Courier New', monospace", fontSize: "8px", cursor: "pointer" }}>LOST</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* ACTIVE JOBS WITH CLOSEOUT */}
                    {(() => {
                      const wonWithCloseout = latest.filter(j => j.status === "won" && j.closeout?.actualCost);
                      if (wonWithCloseout.length === 0) return null;
                      return (
                        <div style={{ marginBottom: "24px" }}>
                          <SectionLabel>CLOSED JOBS — PROFIT SUMMARY</SectionLabel>
                          {wonWithCloseout.map(job => {
                            const rev = parseFloat(job.closeout.actualRevenue || 0);
                            const cost = parseFloat(job.closeout.actualCost || 0);
                            const profit = rev - cost;
                            const margin = rev > 0 ? ((profit / rev) * 100).toFixed(1) : 0;
                            return (
                              <div key={job.id} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", padding: "10px 14px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: "11px", color: "#f0ece0", fontWeight: "bold", marginBottom: "2px" }}>{job.jobInfo?.projectName || job.address || "Unnamed"}</div>
                                  <div style={{ fontSize: "10px", color: "#888" }}>{job.bidForm?.pourType?.replace(/-/g, " ") || "—"}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: "13px", fontWeight: "bold", color: profit >= 0 ? "#4caf50" : "#e53935" }}>
                                    {profit >= 0 ? "+" : ""}${profit.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                                  </div>
                                  <div style={{ fontSize: "9px", color: parseFloat(margin) >= 20 ? "#4caf50" : parseFloat(margin) >= 10 ? "#f5a623" : "#e53935" }}>{margin}% margin</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
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
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                    <button onClick={async () => {
                      try {
                        const res = await fetch("/api/docx", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ address, bidForm, bidOutput, brand, jobInfo, estimate: calculateBidTotal(bidForm, prices) }),
                        });
                        if (!res.ok) throw new Error("Failed");
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `BidProposal_${(jobInfo.jobNumber || "BID").replace(/[^a-z0-9]/gi, "_")}.docx`;
                        document.body.appendChild(a); a.click();
                        document.body.removeChild(a); URL.revokeObjectURL(url);
                      } catch (e) {
                        alert("Export failed — check connection");
                      }
                    }} style={{
                      background: "#1a1a2a", color: "#7986cb", border: "1px solid #7986cb44",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>
                      ⬇ BID PROPOSAL (.docx)
                    </button>
                    <button onClick={async () => {
                      try {
                        const res = await fetch("/api/material-list", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ address, bidForm, bidOutput, brand, jobInfo, prices, estimate: calculateBidTotal(bidForm, prices) }),
                        });
                        if (!res.ok) throw new Error("Failed");
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `MaterialList_${(jobInfo.jobNumber || "JOB").replace(/[^a-z0-9]/gi, "_")}.docx`;
                        document.body.appendChild(a); a.click();
                        document.body.removeChild(a); URL.revokeObjectURL(url);
                      } catch (e) {
                        alert("Export failed — check connection");
                      }
                    }} style={{
                      background: "#1a2a1a", color: "#4caf50", border: "1px solid #4caf5044",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>
                      📋 MATERIAL LIST (.docx)
                    </button>
                    <button onClick={saveJob} style={{
                      background: "#0d1a0d", color: "#4caf50", border: "1px solid #4caf5044",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>
                      💾 {savedMsg || "SAVE JOB"}
                    </button>
                  </div>

                  {/* Email summary */}
                  {(() => {
                    const totalMatch = bidOutput?.match(/TOTAL\s+BID[^$\d]*\$?([\d,]+)/i);
                    const total = totalMatch ? `$${totalMatch[1]}` : "see attached";
                    const expiryDate = jobInfo.bidExpiry || (() => {
                      const d = new Date(); d.setDate(d.getDate() + 30);
                      return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                    })();
                    const emailBody = `Hi ${jobInfo.clientName || jobInfo.gcName || "[Name]"},

Please find our bid proposal attached for ${jobInfo.projectName || address || "the above-referenced project"}.

Project: ${jobInfo.projectName || address || "—"}
Pour Type: ${bidForm.pourType || "—"}
Total Bid: ${total}
Bid Valid Through: ${expiryDate}

Please review the attached proposal and let me know if you have any questions or need any clarifications. We are available to discuss scope, scheduling, or value engineering options at your convenience.

Thank you for the opportunity to bid on this project. We look forward to working with you.

${brand.companyName || ""}
${brand.phone || ""}
${brand.email || ""}`;

                    return (
                      <div style={{ marginTop: "8px", background: "#0d0d0d", border: "1px solid #2a2a2a", padding: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#555" }}>✉ EMAIL SUMMARY</div>
                          <button onClick={() => navigator.clipboard.writeText(emailBody).then(() => alert("Copied to clipboard!"))} style={{
                            background: "#f5a62322", color: "#f5a623", border: "1px solid #f5a62344",
                            padding: "4px 10px", fontFamily: "'Courier New', monospace", fontSize: "9px", letterSpacing: "1px", cursor: "pointer",
                          }}>COPY</button>
                        </div>
                        <pre style={{ fontSize: "10px", color: "#888", whiteSpace: "pre-wrap", lineHeight: "1.6", fontFamily: "'Courier New', monospace", maxHeight: "160px", overflowY: "auto" }}>{emailBody}</pre>
                      </div>
                    );
                  })()}
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

          {phase === 2 && (
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
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
                    <button onClick={exportChangeOrder} style={{
                      background: "#1a0d0d", color: "#e53935", border: "1px solid #e5393544",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>⬇ EXPORT CO</button>
                    <button onClick={() => saveChangeOrder(coOutput, coForm.linkedJobNumber || jobInfo.jobNumber)} style={{
                      background: "#0d1a0d", color: "#4caf50", border: "1px solid #4caf5044",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>💾 SAVE TO JOB {coForm.linkedJobNumber || jobInfo.jobNumber || ""}</button>
                    <button onClick={() => { setCoOutput(""); setCoStatus({ text: "AWAITING INPUT", type: "idle" }); setCoForm({ description: "", reason: "", scopeChanges: "", scheduleImpact: "", linkedJobNumber: "", addedSF: "", addedThickness: "4", rebarType: "none", addedLaborHours: "", addedLaborRole: "laborer", equipmentDays: "", equipmentType: "pump_truck", manualOverride: false, manualCostImpact: "" }); }} style={{
                      background: "transparent", color: "#555", border: "1px solid #333",
                      padding: "10px 16px", fontFamily: "'Courier New', monospace", fontSize: "10px", letterSpacing: "2px", cursor: "pointer", flex: 1,
                    }}>↺ NEW CO</button>
                  </div>
                </>
              ) : (
                <div style={{ height: "380px", background: "#0d0d0d", border: "1px dashed #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "#333" }}>
                  <div style={{ fontSize: "30px", marginBottom: "12px" }}>📋</div>
                  <div style={{ fontSize: "11px", letterSpacing: "2px" }}>SELECT JOB → FILL FORM → GENERATE CO</div>
                </div>
              )}
            </>
          )}

          {phase === 3 && (
            <>
              <SectionLabel>SAVED BIDS</SectionLabel>
              <JobHistoryPanel jobs={jobs} onLoad={loadJob} onDelete={deleteJob} onStatusChange={updateJobStatus} />
            </>
          )}

          {phase === 4 && (
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

          {phase === 5 && (
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

          {/* HELP RIGHT PANEL */}
          {phase === 6 && (
            <>
              <SectionLabel>HOW TO USE THIS PLATFORM</SectionLabel>
              <div style={{ fontSize: "11px", color: "#666", marginBottom: "20px", lineHeight: "1.7" }}>
                Concrete Field Ops is built for concrete subcontractors. Everything here is designed to save you time on paperwork and help you understand your business better.
              </div>

              {[
                {
                  title: "DASHBOARD",
                  color: "#f5a623",
                  icon: "📊",
                  steps: [
                    "Your home base. Open this first every morning.",
                    "Quick Stats show total bids, submitted, won, and lost counts at a glance.",
                    "Win Rate Analytics shows your close rate and average bid size — only populates after you save jobs.",
                    "Active Jobs shows every project with its status, bid value, and revision count.",
                    "Mark jobs WON → a green close-out panel appears to enter actual revenue and cost.",
                    "Profit by Pour Type chart appears once you have closed jobs with actuals entered — shows which work makes you the most money.",
                    "LOAD button on any job card restores that bid to the Bid Engine.",
                    "REBID copies all specs from a job into a fresh bid — use this when a GC asks for a revised number.",
                  ]
                },
                {
                  title: "BID ENGINE",
                  color: "#f5a623",
                  icon: "🏗",
                  steps: [
                    "Enter the job site address at the top — starts auto-completing as you type.",
                    "A Job Number is auto-generated (e.g. JOB-2025-001). You can edit it. This links your bid to any change orders later.",
                    "Fill in Pour Type, Square Footage, Thickness, Concrete Mix, and Rebar. These drive the estimate.",
                    "Concrete Mix and Rebar dropdowns pull directly from your Price Book — update your rates there and they show here.",
                    "LIVE PRICING toggle shows a material takeoff with quantities and costs as you fill the form.",
                    "MARKUP CALC lets you apply overhead and profit % on top of the estimate.",
                    "CLIENT / JOB INFO section adds project name, client, GC, PO number, expiry date, and notes to the bid.",
                    "Hit GENERATE BID ESTIMATE — Claude AI writes a professional estimate using your actual rates.",
                    "BID PROPOSAL exports a print-ready document with your branding, signature block, and terms.",
                    "MATERIAL LIST exports a supplier order sheet with quantities and checkboxes for your foreman.",
                    "EMAIL SUMMARY auto-generates a copy/paste email body to send with the proposal.",
                    "SAVE JOB stores the bid in Job History under the job number.",
                  ]
                },
                {
                  title: "CHANGE ORDER",
                  color: "#e53935",
                  icon: "📋",
                  steps: [
                    "Select the Reference Job from the dropdown — shows all saved jobs with their numbers and bid values.",
                    "Selecting a job auto-fills the original contract value so you can see the full picture.",
                    "Describe what changed, why, and what work was added or removed.",
                    "Use the Cost Calculator to enter added SF, rebar, labor hours, and equipment days — Claude calculates the cost impact using your Price Book rates.",
                    "The live summary shows Net Change + Revised Contract Total before you generate.",
                    "GENERATE CHANGE ORDER writes a formal CO document with both parties' signature blocks.",
                    "SAVE TO JOB links the CO to the original job number — it appears in Job History under that job file.",
                    "EXPORT CO downloads a print-ready change order document.",
                  ]
                },
                {
                  title: "JOB HISTORY",
                  color: "#2196f3",
                  icon: "📂",
                  steps: [
                    "Every saved bid and change order lives here, organized by Job Number.",
                    "One card per job — expands to show all bid revisions (v1, v2, v3) and all change orders (CO-01, CO-02).",
                    "The card shows Original Bid, CO Total, and Running Total side by side.",
                    "Use status buttons to mark each job DRAFT / SUBMITTED / WON / LOST.",
                    "LOAD restores any revision to the Bid Engine with all form fields intact.",
                    "DEL removes individual revisions or change orders from the file.",
                  ]
                },
                {
                  title: "PRICE BOOK",
                  color: "#4caf50",
                  icon: "💲",
                  steps: [
                    "This is the most important setup step. Enter your actual rates here.",
                    "Groups: Concrete, Reinforcement, Materials, Equipment, Labor.",
                    "ADD NEW LINE ITEM — enter name, price, unit, and category. Saves instantly.",
                    "EDIT any existing item inline — click EDIT on the row, change the values, hit SAVE.",
                    "DEL removes any item — default or custom.",
                    "RESET TO DEFAULTS restores the original market reference rates.",
                    "All bid estimates, material takeoffs, and change order calculations use these rates. Keep them current.",
                    "Concrete Mix and Rebar dropdowns in Bid Engine are built from this list automatically.",
                  ]
                },
                {
                  title: "SETTINGS",
                  color: "#888",
                  icon: "⚙",
                  steps: [
                    "COMPANY BRANDING — enter your company name, license number, phone, email, city, state, tagline.",
                    "This information appears on every exported document: bid proposals, change orders, material lists.",
                    "Hit SAVE BRANDING to persist across sessions.",
                    "CLIENT CONTACT BOOK — add GCs and clients with name, company, role, phone, email.",
                    "Saved contacts appear as quick-select buttons in the Bid Engine when Client / Job Info is open.",
                    "One tap fills in GC name or client name — no more retyping.",
                  ]
                },
              ].map(({ title, color, icon, steps }) => (
                <div key={title} style={{ background: "#0d0d0d", border: "1px solid #2a2a2a", borderLeft: `3px solid ${color}`, marginBottom: "16px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "18px" }}>{icon}</span>
                    <div style={{ fontSize: "11px", letterSpacing: "3px", color, fontWeight: "bold" }}>{title}</div>
                  </div>
                  {steps.map((step, i) => (
                    <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "8px", alignItems: "flex-start" }}>
                      <span style={{ color, fontSize: "10px", flexShrink: 0, marginTop: "2px" }}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ fontSize: "11px", color: "#888", lineHeight: "1.6" }}>{step}</span>
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ background: "#111", border: "1px solid #f5a62333", padding: "14px", marginTop: "8px" }}>
                <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#f5a623", marginBottom: "8px" }}>WORKFLOW — START TO FINISH</div>
                {[
                  "Set up your Price Book with actual rates",
                  "Add company branding in Settings",
                  "Open Bid Engine → enter address, fill specs, generate estimate",
                  "Export Bid Proposal and email to GC",
                  "Mark job SUBMITTED on Dashboard",
                  "GC awards job → mark WON → generate Change Orders as scope evolves",
                  "Job complete → enter actual revenue and cost in close-out panel",
                  "Review Profit by Pour Type on Dashboard to understand where you make money",
                ].map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: "12px", marginBottom: "8px", alignItems: "flex-start" }}>
                    <span style={{ background: "#f5a62322", color: "#f5a623", border: "1px solid #f5a62344", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: "11px", color: "#888", lineHeight: "1.6", paddingTop: "2px" }}>{step}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
