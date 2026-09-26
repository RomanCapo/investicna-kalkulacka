// @ts-check
// Finančný plán — generovanie PDF priamo v prehliadači (pdfmake 0.2.x).
//
// Vstup je centralizovaný objekt klienta (types/financial-plan.d.ts), výstup
// je viacstranové PDF: titulná strana s obsahom, zhrnutie a akčný plán, potom
// iba tie moduly, ktoré obsahujú aktívne údaje, a nakoniec predpoklady a podpisy.
//
// Použitie:
//   FinancialPlanPdf.download(plan, { brand: { primary: "#0f6b5c", logo: dataUrl } });
//
/** @typedef {import('../types/financial-plan').FinancialPlanReport} FinancialPlanReport */
/** @typedef {import('../types/financial-plan').PdfOptions} PdfOptions */
/** @typedef {import('../types/financial-plan').BrandOptions} BrandOptions */
/** @typedef {import('../types/financial-plan').Cashflow} Cashflow */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Design tokens
  // ---------------------------------------------------------------------------
  const DEFAULT_BRAND = {
    primary: "#0f6b5c",
    primarySoft: "#e3f1ec",
    ink: "#10231f",
    inkSecondary: "#4b5b57",
    muted: "#7c8b86",
    hairline: "#dfe5e2",
    companyName: "",
    logo: null,
    footerNote: "",
  };
  // Categorical slots in fixed order (validated palette); color follows the entity.
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
  const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", neutral: "#b7c1be" };
  const GRID = "#e1e0d9";
  const TRACK = "#edf0ee";

  const PAGE_W = 595.28;
  const MARGIN_X = 40;
  const CONTENT_W = PAGE_W - 2 * MARGIN_X;

  // ---------------------------------------------------------------------------
  // Labels (all user-facing text in one place)
  // ---------------------------------------------------------------------------
  const L = {
    docTitle: "Finančný plán",
    toc: "Obsah",
    summary: "Zhrnutie a akčný plán",
    closing: "Predpoklady a upozornenia",
    client: "Klient",
    advisor: "Finančný poradca",
    household: "Domácnosť",
    page: (n, of) => `Strana ${n} z ${of}`,
    modules: {
      housing: "Bývanie a reality",
      investments: "Sporenie a investície",
      security: "Zabezpečenie",
      retirement: "Renta",
      incomeScaling: "Navýšenie príjmu",
      general: "Všeobecné",
    },
    relation: { partner: "partner/ka", child: "dieťa", parent: "rodič", other: "člen domácnosti" },
    priority: { high: "Vysoká", medium: "Stredná", low: "Nízka" },
    goalStatus: { on_track: "Na dobrej ceste", at_risk: "Treba navýšiť", off_track: "Mimo plánu" },
    propertyType: { apartment: "Byt", house: "Dom", land: "Pozemok", commercial: "Komerčný priestor", garage: "Garáž", other: "Iné" },
    usage: { own_housing: "vlastné bývanie", rental: "prenájom", holiday: "rekreácia", mixed: "zmiešané" },
    productType: {
      mutual_fund: "Podielový fond", etf: "ETF portfólio", stocks: "Akcie", bonds: "Dlhopisy",
      savings_account: "Sporiaci účet", term_deposit: "Termínovaný vklad", building_savings: "Stavebné sporenie",
      dss_pillar2: "2. pilier (DSS)", dds_pillar3: "3. pilier (DDS)",
      investment_life_insurance: "Investičné životné poistenie", crypto: "Kryptoaktíva", other: "Iné",
      new_offer: "Navrhovaná investícia", retirement_savings: "Investície na dôchodok",
    },
    cashflow: {
      livingExpenses: "Životné náklady",
      debtPayments: "Splátky úverov",
      insurancePremiums: "Poistenie",
      investmentContributions: "Investície a sporenie",
      free: "Voľné prostriedky",
    },
    retirementSources: {
      statePension: "Štátny dôchodok (1. pilier)",
      pillar2: "2. pilier",
      pillar3: "3. pilier",
      investments: "Vlastné investície",
      rental: "Príjem z prenájmu",
      other: "Iné príjmy",
    },
    disclaimer:
      "Tento finančný plán je modelový prepočet vypracovaný na základe údajov, ktoré klient poskytol k dátumu stretnutia. " +
      "Projekcie výnosov, dôchodkov a poistných súm sú odhady a nie sú zaručené; hodnota investícií môže klesať aj stúpať " +
      "a návratnosť pôvodne investovanej sumy nie je zaručená. Plán nepredstavuje ponuku konkrétneho finančného produktu. " +
      "Pred uzavretím zmluvy sa oboznámte s kľúčovými informáciami a predzmluvnou dokumentáciou produktu.",
  };

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  const nf0 = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("sk-SK", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  // Roboto nemá úzku nezlomiteľnú medzeru (U+202F), ktorú používa sk-SK formát.
  const clean = (s) => s.replace(/ /g, " ");
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const eur = (v) => (isNum(v) ? clean(nf0.format(Math.round(v))) + " €" : "—");
  const eurSigned = (v) => (!isNum(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + eur(Math.abs(v)));
  const pct = (v) => (isNum(v) ? clean(nf1.format(v)) + " %" : "—");
  const num1 = (v) => (isNum(v) ? clean(nf1.format(v)) : "—");
  const compactEur = (v) =>
    v >= 1e6 ? clean(nf1.format(v / 1e6)) + " mil. €" :
    v >= 1e3 ? clean(nf0.format(Math.round(v / 1e3))) + " tis. €" : eur(v);
  const unitSuffix = { lump_sum: "", monthly: " / mes.", daily: " / deň" };

  function parseDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  const fmtDate = (iso) => { const p = parseDate(iso); return p ? `${p.d}. ${p.m}. ${p.y}` : "—"; };
  const fmtMonth = (iso) => { const p = parseDate(iso); return p ? `${String(p.m).padStart(2, "0")}/${p.y}` : "—"; };
  function ageAt(birthIso, atIso) {
    const b = parseDate(birthIso), a = parseDate(atIso);
    if (!b || !a) return null;
    return a.y - b.y - (a.m < b.m || (a.m === b.m && a.d < b.d) ? 1 : 0);
  }
  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nn = (arr) => arr.filter((x) => x != null && x !== false);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isSvg = (s) => typeof s === "string" && s.trim().startsWith("<svg");

  // ---------------------------------------------------------------------------
  // Section registry — a section is rendered only if isActive() is true
  // ---------------------------------------------------------------------------
  const hasItems = (a) => Array.isArray(a) && a.length > 0;
  const activeCoverages = (p) => (p.coverages || []).filter((c) => (c.current || 0) > 0 || (c.recommended || 0) > 0);

  // Poradie kapitol = poradie cieľov na stránke plánu.
  const SECTIONS = [
    {
      key: "housing",
      isActive: (s) => !!s && (hasItems(s.properties) || hasItems(s.loans) || hasItems(s.plannedPurchases)),
      render: renderHousing,
    },
    {
      key: "retirement",
      isActive: (s) => !!s && s.targetMonthlyToday > 0,
      render: renderRetirement,
    },
    {
      key: "investments",
      isActive: (s) => !!s && (hasItems(s.accounts) || hasItems(s.goals)),
      render: renderInvestments,
    },
    {
      key: "security",
      isActive: (s) => !!s && (
        (s.people || []).some((p) => activeCoverages(p).length > 0) || hasItems(s.contracts) ||
        (!!s.emergencyFund && s.emergencyFund.target > 0)),
      render: renderSecurity,
    },
    {
      key: "incomeScaling",
      isActive: (s) => !!s && hasItems(s.steps),
      render: renderIncomeScaling,
    },
  ];

  /** @param {FinancialPlanReport} data */
  function activeSections(data) {
    return SECTIONS.filter((s) => s.isActive(data[s.key])).map((s) => s.key);
  }

  // ---------------------------------------------------------------------------
  // Building blocks
  // ---------------------------------------------------------------------------
  function tableLayout(brand) {
    return {
      hLineWidth: (i, node) => {
        const rows = node.table.body.length;
        if (i === 0 || i === rows) return 0;
        if (i === 1 && node.table.headerRows) return 0.8;
        if (node.table.hasTotal && i === rows - 1) return 0.8;
        return 0.4;
      },
      vLineWidth: () => 0,
      hLineColor: (i, node) => (i === 1 && node.table.headerRows) || (node.table.hasTotal && i === node.table.body.length - 1)
        ? brand.inkSecondary : brand.hairline,
      paddingLeft: (i) => (i === 0 ? 0 : 6),
      paddingRight: (i, node) => (i === node.table.widths.length - 1 ? 0 : 6),
      paddingTop: () => 5,
      paddingBottom: () => 5,
    };
  }

  const th = (text, right) => ({ text: text.toUpperCase(), style: "th", alignment: right ? "right" : "left" });
  const td = (text, extra) => Object.assign({ text }, extra || {});
  const tdNum = (text, extra) => Object.assign({ text, alignment: "right", noWrap: true }, extra || {});

  function dataTable(ctx, widths, header, rows, opts) {
    const o = opts || {};
    return {
      style: "table",
      table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths, body: [header, ...rows], hasTotal: !!o.hasTotal },
      layout: tableLayout(ctx.brand),
      margin: [0, 2, 0, 4],
    };
  }

  // Label/value list (no header row).
  function kvTable(ctx, rows) {
    return {
      style: "table",
      table: {
        widths: ["*", "auto"],
        body: rows.map((r) => [
          { text: r[0], color: r[2] && r[2].bold ? ctx.brand.ink : ctx.brand.inkSecondary, bold: !!(r[2] && r[2].bold) },
          { text: r[1], alignment: "right", noWrap: true, bold: !!(r[2] && r[2].bold) },
        ]),
        hasTotal: rows.length > 1 && !!(rows[rows.length - 1][2] && rows[rows.length - 1][2].bold),
      },
      layout: tableLayout(ctx.brand),
    };
  }

  // breakMode: "always" = new page; "auto" = new page only if the previous
  // content filled more than AUTO_BREAK_RATIO of the page; "never" = flow on.
  const AUTO_BREAK_RATIO = 0.45;
  function h1(ctx, num, title, lead, breakMode) {
    return nn([
      {
        text: [{ text: String(num).padStart(2, "0") + "   ", color: ctx.brand.primary }, title],
        style: "h1", tocItem: true,
        // pageBreakBefore only sees whitelisted node props, so headlineLevel 1 marks "auto".
        headlineLevel: breakMode === "auto" ? 1 : undefined,
        pageBreak: breakMode === "always" ? "before" : undefined,
        margin: breakMode === "always" ? undefined : [0, 18, 0, 0],
      },
      { canvas: [{ type: "rect", x: 0, y: 0, w: 40, h: 3, color: ctx.brand.primary }], margin: [0, 6, 0, 12] },
      lead ? { text: lead, style: "lead" } : null,
    ]);
  }

  const h2 = (text) => ({ text, style: "h2", headlineLevel: 2 });

  // Heading + body kept together on one page.
  const block = (title, body, breakable) => ({ stack: [h2(title), ...nn(body)], unbreakable: !breakable });

  function tile(ctx, label, value, sub) {
    return {
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: label, style: "tileLabel" },
            { text: value, style: "tileValue" },
            { text: sub || " ", style: "tileSub" },
          ],
          fillColor: ctx.brand.primarySoft,
          margin: [10, 9, 10, 9],
        }]],
      },
      layout: "noBorders",
    };
  }

  // One table row so all tiles share the height of the tallest one; white
  // vertical rules act as the gaps between them.
  function tiles(items) {
    const cells = items.map((t) => t.table.body[0][0]);
    return {
      table: { widths: cells.map(() => "*"), body: [cells] },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (i) => (i === 0 || i === cells.length ? 0 : 8),
        vLineColor: () => "#ffffff",
        paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      },
      margin: [0, 2, 0, 6],
    };
  }

  function dot(color) {
    return { canvas: [{ type: "ellipse", x: 3.5, y: 5.5, r1: 3.5, r2: 3.5, color }], width: 10 };
  }
  // Status is never color alone: dot + text label.
  const chip = (color, label) => ({ columns: [dot(color), { text: label, width: "*" }], columnGap: 0 });

  function swatch(color) {
    return { canvas: [{ type: "rect", x: 0, y: 1.5, w: 8, h: 8, r: 2, color }], width: 12 };
  }

  function progressBar(ratio, width, color) {
    const r = clamp(isNum(ratio) ? ratio : 0, 0, 1);
    return {
      canvas: nn([
        { type: "rect", x: 0, y: 0, w: width, h: 6, r: 3, color: TRACK },
        r > 0 ? { type: "rect", x: 0, y: 0, w: Math.max(6, width * r), h: 6, r: 3, color } : null,
      ]),
      margin: [0, 3, 0, 0],
    };
  }

  // Horizontal stacked bar; 2px surface gap between segments; optional marker line.
  function stackedBar(values, colors, scale, width, marker, height) {
    const h = height || 16;
    const parts = [];
    let x = 0;
    values.forEach((v, i) => {
      if (!(v > 0) || scale <= 0) return;
      const w = (v / scale) * width;
      parts.push({ type: "rect", x, y: 0, w: Math.max(w - 2, 0.75), h, r: 2, color: colors[i] });
      x += w;
    });
    if (isNum(marker) && scale > 0) {
      const mx = clamp((marker / scale) * width, 1, width - 1);
      parts.push({ type: "line", x1: mx, y1: -4, x2: mx, y2: h + 4, lineWidth: 1.5, lineColor: "#10231f" });
    }
    if (!parts.length) parts.push({ type: "rect", x: 0, y: 0, w: width, h, r: 2, color: TRACK });
    return { canvas: parts, margin: [0, 4, 0, 4] };
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const step = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => f <= s) || 10;
    return step * exp;
  }

  // Line chart as inline SVG (vector, fonts resolved by pdfmake -> Roboto).
  function lineChartSvg(ctx, series, height) {
    const W = CONTENT_W, H = height || 190;
    const padL = 52, padR = 70, padT = 10, padB = 22;
    const all = series.flatMap((s) => s.points);
    const xMin = Math.min(...all.map((p) => p.x)), xMax = Math.max(...all.map((p) => p.x));
    const yMax = niceMax(Math.max(...all.map((p) => p.y)));
    const X = (x) => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
    const Y = (y) => padT + (1 - y / yMax) * (H - padT - padB);
    const font = `font-family="Roboto" font-size="7" fill="${ctx.brand.muted}"`;
    const out = [];

    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4, y = Y(v).toFixed(1);
      out.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${k === 0 ? "#c3c2b7" : GRID}" stroke-width="${k === 0 ? 0.8 : 0.5}"/>`);
      out.push(`<text x="${padL - 6}" y="${(+y + 2.5).toFixed(1)}" text-anchor="end" ${font}>${esc(compactEur(v))}</text>`);
    }
    const span = xMax - xMin, step = Math.max(1, Math.ceil(span / 8));
    for (let x = xMin; x <= xMax; x += step) {
      if (xMax - x < step * 0.6 && x !== xMin) continue;
      out.push(`<text x="${X(x).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${font}>${x}</text>`);
    }
    out.push(`<text x="${X(xMax).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${font}>${xMax}</text>`);

    // Direct end labels, nudged apart when they would collide.
    const ends = series.map((s) => { const p = s.points[s.points.length - 1]; return { s, x: X(p.x), y: Y(p.y), v: p.y }; })
      .sort((a, b) => a.y - b.y)
      .map((e) => Object.assign(e, { ly: e.y }));
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 11) ends[i].ly = ends[i - 1].ly + 11;

    series.forEach((s) => {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
      out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    });
    ends.forEach((e) => {
      out.push(`<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="3" fill="${e.s.color}" stroke="#ffffff" stroke-width="1.5"/>`);
      out.push(`<text x="${(e.x + 7).toFixed(1)}" y="${(e.ly + 2.5).toFixed(1)}" font-family="Roboto" font-size="7.5" font-weight="bold" fill="${ctx.brand.ink}">${esc(compactEur(e.v))}</text>`);
    });

    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`, width: W };
  }

  function legendRow(items) {
    return {
      columns: items.map((it) => ({ columns: [swatch(it.color), { text: it.label, style: "small", width: "auto" }], width: "auto", columnGap: 0 })),
      columnGap: 16,
      margin: [0, 0, 0, 4],
    };
  }

  // ---------------------------------------------------------------------------
  // Cover, header, footer
  // ---------------------------------------------------------------------------
  function logoNode(ctx, fit) {
    const logo = ctx.brand.logo;
    if (!logo) return null;
    return isSvg(logo) ? { svg: logo, fit } : { image: "logo", fit };
  }

  function renderCover(ctx) {
    const { data, brand } = ctx;
    const clientName = `${data.client.firstName} ${data.client.lastName}`;
    const logo = logoNode(ctx, [140, 44]);
    const household = (data.client.household || []).map((m) => {
      const age = ageAt(m.birthDate, data.meta.date);
      return `${m.firstName} (${L.relation[m.relation] || m.relation}${age != null ? `, ${age} r.` : ""})`;
    });
    const clientAge = ageAt(data.client.birthDate, data.meta.date);

    const personBlock = (title, lines) => ({
      stack: [
        { text: title.toUpperCase(), style: "th", margin: [0, 0, 0, 6] },
        ...nn(lines).map((l, i) => ({ text: l, style: i === 0 ? "coverName" : "small", margin: [0, 0, 0, 2] })),
      ],
    });

    return nn([
      logo ? Object.assign(logo, { absolutePosition: { x: MARGIN_X + 12, y: 44 } }) : null,
      {
        text: (brand.companyName || L.docTitle).toUpperCase(),
        absolutePosition: { x: MARGIN_X, y: 150 }, color: "#ffffff", fontSize: 9, bold: true, characterSpacing: 1.5,
      },
      { text: L.docTitle, absolutePosition: { x: MARGIN_X, y: 168 }, color: "#ffffff", fontSize: 34, bold: true },
      { text: clientName, absolutePosition: { x: MARGIN_X, y: 216 }, color: "#ffffff", fontSize: 18 },
      {
        text: `Vypracované ${fmtDate(data.meta.date)}${data.meta.version ? ` · verzia ${data.meta.version}` : ""}`,
        absolutePosition: { x: MARGIN_X, y: 248 }, color: brand.primarySoft, fontSize: 10,
      },
      {
        margin: [0, 262, 0, 0],
        columns: [
          personBlock(L.client, [
            clientName,
            clientAge != null ? `${clientAge} rokov` : null,
            data.client.email, data.client.phone,
            household.length ? `${L.household}: ${household.join(", ")}` : null,
          ]),
          personBlock(L.advisor, [
            data.advisor.name,
            data.advisor.company,
            data.advisor.nbsRegNumber ? `Reg. č. NBS ${data.advisor.nbsRegNumber}` : null,
            data.advisor.email, data.advisor.phone,
          ]),
        ],
        columnGap: 24,
      },
      {
        margin: [0, 36, 0, 0],
        toc: { title: { text: L.toc.toUpperCase(), style: "th", margin: [0, 0, 0, 8] }, textStyle: "tocItem", numberStyle: "tocNumber" },
      },
    ]);
  }

  function coverBackground(ctx) {
    return (currentPage) => {
      if (currentPage !== 1) return null;
      return {
        canvas: nn([
          { type: "rect", x: 0, y: 0, w: PAGE_W, h: 290, color: ctx.brand.primary },
          ctx.brand.logo ? { type: "rect", x: MARGIN_X, y: 34, w: 164, h: 64, r: 6, color: "#ffffff" } : null,
        ]),
      };
    };
  }

  function header(ctx) {
    const { data, brand } = ctx;
    return (currentPage) => {
      if (currentPage === 1) return null;
      const left = logoNode(ctx, [96, 22]) || { text: brand.companyName || L.docTitle, bold: true, color: brand.primary, fontSize: 9 };
      return {
        margin: [MARGIN_X, 22, MARGIN_X, 0],
        stack: [
          {
            columns: [
              Object.assign({ width: "*" }, left),
              { text: `${data.client.firstName} ${data.client.lastName} · ${L.docTitle} · ${fmtDate(data.meta.date)}`, style: "headerText", alignment: "right", width: "auto", margin: [0, 1.5, 0, 0] },
            ],
          },
          { canvas: [{ type: "line", x1: 0, y1: 6, x2: CONTENT_W, y2: 6, lineWidth: 0.5, lineColor: brand.hairline }] },
        ],
      };
    };
  }

  function footer(ctx) {
    const { data, brand } = ctx;
    const left = nn([data.advisor.name, data.advisor.company, data.advisor.nbsRegNumber ? `reg. č. NBS ${data.advisor.nbsRegNumber}` : null, brand.footerNote || null]).join(" · ");
    return (currentPage, pageCount) => {
      if (currentPage === 1) return null;
      return {
        margin: [MARGIN_X, 18, MARGIN_X, 0],
        columns: [
          { text: left, style: "footer", width: "*" },
          { text: L.page(currentPage, pageCount), style: "footer", alignment: "right", width: "auto" },
        ],
      };
    };
  }

  // ---------------------------------------------------------------------------
  // 01 Executive summary & action plan
  // ---------------------------------------------------------------------------
  const CF_KEYS = ["livingExpenses", "debtPayments", "insurancePremiums", "investmentContributions", "free"];

  function cashflowChart(ctx, before, after) {
    const rows = nn([["Dnes", before], after ? ["Po realizácii plánu", after] : null]);
    const outflow = (cf) => cf.livingExpenses + cf.debtPayments + cf.insurancePremiums + cf.investmentContributions;
    const scale = Math.max(...rows.map(([, cf]) => Math.max(cf.netIncome, outflow(cf))));
    const labelW = 88, barW = CONTENT_W - labelW - 8;

    const bars = {
      table: {
        widths: [labelW, barW],
        body: rows.map(([label, cf]) => {
          const vals = CF_KEYS.map((k) => (k === "free" ? Math.max(cf.free, 0) : cf[k]));
          const deficit = cf.free < 0;
          return [
            { text: label, style: "small", margin: [0, 7, 0, 0] },
            stackedBar(vals, SERIES, scale, barW, deficit ? cf.netIncome : null),
          ];
        }),
      },
      layout: "noBorders",
    };

    const header = [th(""), th("Položka"), th("Dnes", true)];
    if (after) header.push(th("Po pláne", true));
    header.push(th(after ? "Podiel (dnes)" : "Podiel na príjme", true));
    const legend = CF_KEYS.map((k, i) => {
      const row = [swatch(SERIES[i]), td(L.cashflow[k]), tdNum(eurSigned(k === "free" ? before[k] : -before[k]))];
      if (after) row.push(tdNum(eurSigned(k === "free" ? after[k] : -after[k])));
      row.push(tdNum(before.netIncome > 0 ? pct((before[k] / before.netIncome) * 100) : "—"));
      return row;
    });
    const incomeRow = [td(""), td("Čistý príjem domácnosti", { bold: true }), tdNum(eur(before.netIncome), { bold: true })];
    if (after) incomeRow.push(tdNum(eur(after.netIncome), { bold: true }));
    incomeRow.push(tdNum("100 %", { bold: true }));
    const widths = after ? [12, "*", 70, 70, 80] : [12, "*", 80, 90];

    const deficitNote = rows.some(([, cf]) => cf.free < 0)
      ? { text: "Zvislá čiara označuje čistý príjem — výdavky ho prevyšujú.", style: "muted", margin: [0, 0, 0, 4] }
      : null;

    return [bars, deficitNote, dataTable(ctx, widths, header, [incomeRow, ...legend])];
  }

  function actionPlan(ctx, actions, active) {
    const order = { high: 0, medium: 1, low: 2 };
    const color = { high: STATUS.critical, medium: STATUS.warning, low: STATUS.neutral };
    const list = actions
      .filter((a) => a.module === "general" || active.includes(a.module))
      .map((a, i) => ({ a, i }))
      .sort((x, y) => order[x.a.priority] - order[y.a.priority] || x.i - y.i)
      .map((x) => x.a);
    if (!list.length) return null;

    const rows = list.map((a, i) => [
      td(String(i + 1), { color: ctx.brand.muted }),
      chip(color[a.priority], L.priority[a.priority]),
      td(L.modules[a.module] || a.module, { color: ctx.brand.inkSecondary }),
      { stack: nn([{ text: a.title, bold: true }, a.detail ? { text: a.detail, style: "small", margin: [0, 2, 0, 0] } : null]) },
      tdNum(isNum(a.monthlyImpact) ? eurSigned(a.monthlyImpact) : "—"),
      tdNum(a.deadline ? fmtMonth(a.deadline) : "—"),
    ]);
    return {
      stack: [
        h2("Akčný plán"),
        { text: "Konkrétne kroky zoradené podľa priority. Vplyv je zmena voľného mesačného cashflow.", style: "muted", margin: [0, 0, 0, 4] },
        dataTable(ctx, [12, 58, 70, "*", 58, 40],
          [th("#"), th("Priorita"), th("Oblasť"), th("Opatrenie"), th("Vplyv / mes.", true), th("Termín", true)], rows),
      ],
    };
  }

  // Ciele, ktoré klient chce riešiť, s odkazom na kapitolu plánu.
  function clientGoalsBlock(ctx, goals, active) {
    if (!hasItems(goals)) return null;
    const rows = goals.map((g) => {
      const idx = active.indexOf(g.key);
      const where = idx >= 0 ? `Kapitola ${String(idx + 2).padStart(2, "0")}`
        : g.status === "soon" ? "Riešime individuálne, kalkulačku pripravujeme"
        : "Kalkulácia sa doplní";
      return [
        td(g.title, { bold: true }),
        td(g.note || "—", { color: g.note ? ctx.brand.ink : ctx.brand.muted }),
        td(where, { color: idx >= 0 ? ctx.brand.primary : ctx.brand.inkSecondary, bold: idx >= 0 }),
      ];
    });
    return block("Ciele klienta", [dataTable(ctx, [120, "*", 130], [th("Cieľ"), th("Čo chce klient dosiahnuť"), th("V pláne")], rows)]);
  }

  function renderSummary(ctx, active) {
    const { data } = ctx;
    const cf = data.summary.cashflow, after = data.summary.cashflowAfterPlan, nw = data.summary.netWorth;
    const moduleNames = active.map((k) => L.modules[k].toLowerCase());
    const list = moduleNames.length > 1
      ? `${moduleNames.slice(0, -1).join(", ")} a ${moduleNames[moduleNames.length - 1]}`
      : moduleNames[0];
    const lead = moduleNames.length > 1
      ? `Plán prepája oblasti ${list} do jedného celku. Zmena v jednej oblasti` +
        (active.includes("housing") ? " — napríklad nový úver — " : " ") +
        "sa premieta do cashflow aj ostatných oblastí."
      : moduleNames.length
        ? `Prehľad aktuálnej finančnej situácie a oblasti ${list}.`
        : "Prehľad aktuálnej finančnej situácie a odporúčaných krokov.";

    const kpis = [
      tile(ctx, "Čistý príjem domácnosti", eur(cf.netIncome), "mesačne"),
      tile(ctx, "Voľný cashflow", eurSigned(cf.free), after ? `po realizácii plánu ${eurSigned(after.free)}` : "mesačne"),
      tile(ctx, "Čistý majetok", eur(nw.net), `záväzky ${compactEur(nw.liabilities)}`),
    ];
    const ef = data.security && data.security.emergencyFund;
    if (active.includes("security") && ef && ef.monthlyEssentialExpenses > 0) {
      kpis.push(tile(ctx, "Finančná rezerva", `${num1(ef.current / ef.monthlyEssentialExpenses)} mes.`, `cieľ ${num1(ef.targetMonths)} mesiacov`));
    } else if (active.includes("retirement")) {
      const r = data.retirement;
      const gap = r.targetMonthlyToday - sum(Object.values(r.sources), (v) => v);
      kpis.push(tile(ctx, "Dôchodok — chýba", gap > 0 ? eur(gap) : "0 €", "mesačne v dnešných cenách"));
    }

    return nn([
      ...h1(ctx, 1, L.summary, lead, "always"),
      tiles(kpis),
      clientGoalsBlock(ctx, data.clientGoals, active),
      block("Kam idú peniaze každý mesiac", cashflowChart(ctx, cf, after)),
      actionPlan(ctx, data.actions || [], active),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Housing
  // ---------------------------------------------------------------------------
  function renderHousing(ctx, s) {
    const out = [];
    const props = s.properties || [], loans = s.loans || [], planned = s.plannedPurchases || [];

    if (props.length) {
      const rows = props.map((p) => [
        { stack: [{ text: p.name, bold: true }, { text: `${L.propertyType[p.type] || p.type} · ${L.usage[p.usage] || p.usage}`, style: "small" }] },
        tdNum(eur(p.value)),
        tdNum(p.loanBalance ? eur(p.loanBalance) : "—"),
        tdNum(p.monthlyRent ? eur(p.monthlyRent) : "—"),
        tdNum(p.monthlyCosts ? eur(p.monthlyCosts) : "—"),
      ]);
      rows.push([td("Spolu", { bold: true }), tdNum(eur(sum(props, (p) => p.value)), { bold: true }),
        tdNum(eur(sum(props, (p) => p.loanBalance)), { bold: true }), tdNum(""), tdNum("")]);
      out.push(block("Vlastnené nehnuteľnosti", [dataTable(ctx, ["*", 70, 70, 60, 60],
        [th("Nehnuteľnosť"), th("Hodnota", true), th("Zostatok úveru", true), th("Nájom / mes.", true), th("Náklady / mes.", true)],
        rows, { hasTotal: true })]));
    }

    if (loans.length) {
      const rows = loans.map((l) => [
        td(l.name, { bold: true }), tdNum(eur(l.balance)), tdNum(pct(l.ratePct)), tdNum(eur(l.monthlyPayment)),
        tdNum(l.fixationEndDate ? fmtMonth(l.fixationEndDate) : "—"), tdNum(l.maturityDate ? fmtMonth(l.maturityDate) : "—"),
      ]);
      out.push(block("Úvery na bývanie", [dataTable(ctx, ["*", 64, 44, 58, 54, 54],
        [th("Úver"), th("Zostatok", true), th("Úrok", true), th("Splátka", true), th("Fixácia do", true), th("Splatnosť", true)], rows)]));
    }

    planned.forEach((p) => {
      const ltv = p.price > 0 ? (p.loanAmount / p.price) * 100 : null;
      const financing = nn([
        ["Kúpna cena", eur(p.price)],
        p.extraCosts ? ["Vedľajšie náklady a rekonštrukcia", eur(p.extraCosts)] : null,
        ["Vlastné zdroje", eur(p.ownFunds)],
        ["Výška úveru", eur(p.loanAmount)],
        ltv != null ? ["LTV", pct(ltv)] : null,
        ["Úroková sadzba", pct(p.ratePct) + (p.fixationYears ? ` (fixácia ${p.fixationYears} r.)` : "")],
        ["Splatnosť", `${p.termYears} rokov`],
        ["Mesačná splátka", eur(p.monthlyPayment), { bold: true }],
      ]);
      const impact = nn([
        ["Nová splátka úveru", eurSigned(-p.monthlyPayment)],
        p.monthlyRunningCosts ? ["Náklady na nehnuteľnosť", eurSigned(-p.monthlyRunningCosts)] : null,
        p.replacedHousingCost ? ["Odpadá súčasné bývanie (nájom)", eurSigned(p.replacedHousingCost)] : null,
        p.expectedMonthlyRent ? ["Príjem z prenájmu", eurSigned(p.expectedMonthlyRent)] : null,
        ["Zmena voľného cashflow", eurSigned(p.freeCashflowAfter - p.freeCashflowBefore), { bold: true }],
      ]);
      const scale = Math.max(p.freeCashflowBefore, p.freeCashflowAfter, 1);
      const beforeAfter = {
        table: {
          widths: [62, "*", 58],
          body: [["Pred kúpou", p.freeCashflowBefore], ["Po kúpe", p.freeCashflowAfter]].map(([l, v]) => [
            { text: l, style: "small", margin: [0, 2, 0, 0] },
            progressBar(Math.max(v, 0) / scale, 90, ctx.brand.primary),
            tdNum(eurSigned(v), { bold: true }),
          ]),
        },
        layout: "noBorders",
        margin: [0, 6, 0, 0],
      };

      out.push({
        unbreakable: true,
        stack: nn([
          h2(`${p.label} · ${L.propertyType[p.type] || p.type}, ${L.usage[p.usage] || p.usage} · plánovaná kúpa ${fmtMonth(p.targetDate)}`),
          {
            columns: [
              { width: "*", stack: [{ text: "FINANCOVANIE", style: "th", margin: [0, 0, 0, 2] }, kvTable(ctx, financing)] },
              { width: 230, stack: [{ text: "DOPAD NA MESAČNÝ CASHFLOW", style: "th", margin: [0, 0, 0, 2] }, kvTable(ctx, impact), beforeAfter] },
            ],
            columnGap: 24,
          },
          hasItems(p.notes) ? {
            margin: [0, 10, 0, 0],
            table: {
              widths: ["*"],
              body: [[{
                fillColor: ctx.brand.primarySoft, margin: [10, 8, 10, 8],
                stack: [
                  { text: "Súvislosti s ďalšími oblasťami plánu", bold: true, margin: [0, 0, 0, 4] },
                  { ul: p.notes, style: "small" },
                ],
              }]],
            },
            layout: "noBorders",
          } : null,
        ]),
      });
    });

    return out;
  }

  // ---------------------------------------------------------------------------
  // Investments
  // ---------------------------------------------------------------------------
  function renderInvestments(ctx, s) {
    const out = [];
    const accounts = (s.accounts || []).filter((a) => a.value > 0 || a.monthlyContribution > 0 || (a.employerContribution || 0) > 0);
    const goals = s.goals || [];

    if (accounts.length) {
      // Stĺpec „Správca“ len ak ho má aspoň jeden účet; typ produktu len ak sa líši od názvu.
      const withProvider = accounts.some((a) => a.provider);
      const rows = accounts.map((a) => nn([
        { stack: nn([{ text: a.name, bold: true },
          (L.productType[a.productType] || a.productType) !== a.name ? { text: L.productType[a.productType] || a.productType, style: "small" } : null]) },
        withProvider ? td(a.provider || "—", { color: ctx.brand.inkSecondary }) : null,
        tdNum(eur(a.value)),
        { stack: nn([
          tdNum(eur(a.monthlyContribution + (a.employerContribution || 0))),
          a.employerContribution ? { text: `z toho zamestnávateľ ${eur(a.employerContribution)}`, style: "small", alignment: "right" } : null,
        ]) },
        tdNum(pct(a.expectedReturnPct)),
        tdNum(pct(a.annualFeePct)),
      ]));
      rows.push(nn([td("Spolu", { bold: true }), withProvider ? td("") : null, tdNum(eur(sum(accounts, (a) => a.value)), { bold: true }),
        tdNum(eur(sum(accounts, (a) => a.monthlyContribution + (a.employerContribution || 0))), { bold: true }), tdNum(""), tdNum("")]));
      out.push(block("Portfólio a sporenie", [dataTable(ctx, nn(["*", withProvider ? 84 : null, 60, 96, 42, 46]),
        nn([th("Produkt"), withProvider ? th("Správca") : null, th("Hodnota", true), th("Vklad / mes.", true), th("Výnos", true), th("Náklady", true)]),
        rows, { hasTotal: true })], rows.length > 10));
    }

    if (goals.length) {
      const color = { on_track: STATUS.good, at_risk: STATUS.warning, off_track: STATUS.critical };
      const rows = goals.map((g) => {
        const ratio = g.targetAmount > 0 ? g.projectedAmount / g.targetAmount : 0;
        return [
          td(g.label, { bold: true }),
          tdNum(fmtMonth(g.targetDate)),
          tdNum(eur(g.targetAmount)),
          { stack: [progressBar(ratio, 84, ctx.brand.primary), { text: `prognóza ${eur(g.projectedAmount)} · ${Math.round(ratio * 100)} %`, style: "small", margin: [0, 3, 0, 0] }] },
          { stack: nn([
            tdNum(eur(g.currentMonthly)),
            g.requiredMonthly > g.currentMonthly ? { text: `potrebný ${eur(g.requiredMonthly)}`, style: "small", alignment: "right" } : null,
          ]) },
          chip(color[g.status], L.goalStatus[g.status]),
        ];
      });
      out.push(block("Finančné ciele", [
        { text: "Cieľové sumy sú v nominálnej hodnote k termínu cieľa. Ak súčasný mesačný vklad nestačí, je pod ním uvedený potrebný vklad.", style: "muted", margin: [0, 0, 0, 4] },
        dataTable(ctx, ["*", 40, 58, 110, 86, 78],
          [th("Cieľ"), th("Termín", true), th("Cieľová suma", true), th("Plnenie"), th("Vklad / mes.", true), th("Stav")], rows),
      ], rows.length > 8));
    }

    const proj = (s.projection || []).filter((p) => isNum(p.year) && isNum(p.value));
    if (proj.length >= 2) {
      const series = [
        { label: "Hodnota portfólia", color: SERIES[0], points: proj.map((p) => ({ x: p.year, y: p.value })) },
        { label: "Vložené prostriedky", color: SERIES[1], points: proj.map((p) => ({ x: p.year, y: p.contributed })) },
      ];
      out.push(block(s.projectionTitle || "Projekcia vývoja portfólia", [
        legendRow(series),
        lineChartSvg(ctx, series, 170),
        { text: "Projekcia pri očakávanom výnose po nákladoch a pravidelných vkladoch; nominálne hodnoty.", style: "muted", margin: [0, 4, 0, 0] },
      ]));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Security & insurance
  // ---------------------------------------------------------------------------
  function renderSecurity(ctx, s) {
    const out = [];
    const ef = s.emergencyFund;
    if (ef && ef.target > 0) {
      const months = ef.monthlyEssentialExpenses > 0 ? ef.current / ef.monthlyEssentialExpenses : null;
      const missing = ef.target - ef.current;
      out.push(block("Finančná rezerva", [
        tiles([
          tile(ctx, "Aktuálna rezerva", eur(ef.current), months != null ? `pokrýva ${num1(months)} mes. výdavkov` : " "),
          tile(ctx, "Cieľová rezerva", eur(ef.target), `${num1(ef.targetMonths)} × nevyhnutné výdavky ${eur(ef.monthlyEssentialExpenses)}`),
          tile(ctx, missing > 0 ? "Chýba doplniť" : "Rezerva je splnená", missing > 0 ? eur(missing) : eur(0), missing > 0 ? "odporúčame dorovnať prednostne" : " "),
        ]),
        progressBar(ef.current / ef.target, CONTENT_W, ctx.brand.primary),
      ]));
    }

    const pb = s.premiumBudget;
    if (pb && (pb.max > 0 || pb.current > 0)) {
      out.push(block("Rozpočet na poistné", [tiles(nn([
        tile(ctx, "Súčasné životné poistenie", eur(pb.current), "mesačne"),
        isNum(pb.proposed) ? tile(ctx, "Navrhované poistné", eur(pb.proposed), `zmena ${eurSigned(pb.proposed - pb.current)}`) : null,
        tile(ctx, "Odporúčaný rozpočet", `${eur(pb.min)} – ${eur(pb.max)}`, "5 – 10 % čistého príjmu"),
      ]))]));
    }

    const contracts = s.contracts || [];
    if (contracts.length) {
      const rows = contracts.map((c) => [
        { stack: nn([{ text: c.type, bold: true }, c.group ? { text: c.group, style: "small" } : null]) },
        { stack: nn([td(c.provider || "—"), c.number ? { text: `č. ${c.number}`, style: "small" } : null]) },
        td(c.subject || "—", { color: ctx.brand.inkSecondary }),
        tdNum(c.sumInsured ? eur(c.sumInsured) : "—"),
        { stack: nn([tdNum(eur(c.monthlyPremium)), c.paymentNote ? { text: c.paymentNote, style: "small", alignment: "right" } : null]) },
        tdNum(c.endDate ? fmtDate(c.endDate) : c.startDate ? `výr. ${fmtDate(c.startDate).replace(/\s?\d{4}$/, "")}` : "—"),
      ]);
      rows.push([td("Spolu", { bold: true }), td(""), td(""), tdNum(""), tdNum(eur(sum(contracts, (c) => c.monthlyPremium)), { bold: true }), tdNum("")]);
      out.push(block("Existujúce zmluvy", [
        { text: "Poistné je prepočítané na mesiac. Krytie zo životných a úrazových zmlúv je porovnané s odporúčaním nižšie.", style: "muted", margin: [0, 0, 0, 4] },
        dataTable(ctx, ["*", 90, 90, 56, 52, 58],
          [th("Zmluva"), th("Poisťovňa"), th("Poistený / predmet"), th("Poistná suma", true), th("€ / mes.", true), th("Koniec / výročie", true)],
          rows, { hasTotal: true }),
      ], rows.length > 8));
    }

    const people = (s.people || []).map((p) => Object.assign({}, p, { coverages: activeCoverages(p) })).filter((p) => p.coverages.length);

    people.forEach((p, idx) => {
      const rows = p.coverages.map((c) => {
        const sfx = unitSuffix[c.unit] || "";
        const ratio = c.recommended > 0 ? c.current / c.recommended : 1;
        const gap = c.recommended - c.current;
        return [
          { stack: nn([{ text: c.label, bold: true }, c.reason ? { text: c.reason, style: "small", margin: [0, 1, 0, 0] } : null]) },
          tdNum(c.current > 0 ? eur(c.current) + sfx : "—"),
          tdNum(eur(c.recommended) + sfx, { bold: true }),
          tdNum(gap > 0 ? eur(gap) + sfx : "—"),
          { columns: [progressBar(ratio, 58, ctx.brand.primary), { text: `${Math.round(clamp(ratio, 0, 9.99) * 100)} %`, alignment: "right", width: 30, style: "small" }], columnGap: 4 },
        ];
      });
      const title = `Poistné krytie — ${p.name}${p.role ? ` (${p.role})` : ""}`;
      const lead = idx === 0 ? { text: "Odporúčané poistné sumy vychádzajú z príjmu, úverov a počtu závislých osôb. Stĺpec pokrytie porovnáva súčasnú zmluvu s odporúčaním.", style: "muted", margin: [0, 0, 0, 4] } : null;
      out.push(block(title, [lead, dataTable(ctx, ["*", 72, 72, 62, 92],
        [th("Riziko"), th("Súčasné", true), th("Odporúčané", true), th("Chýba", true), th("Pokrytie")], rows)], rows.length > 9));
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Retirement
  // ---------------------------------------------------------------------------
  function renderRetirement(ctx, r) {
    const keys = ["statePension", "pillar2", "pillar3", "investments", "rental", "other"];
    const src = keys.map((k, i) => ({ k, label: L.retirementSources[k], value: r.sources[k] || 0, color: SERIES[i] })).filter((x) => x.value > 0);
    const total = sum(src, (x) => x.value);
    const gap = r.targetMonthlyToday - total;
    const yearsLeft = r.retirementAge - r.currentAge;

    const barW = CONTENT_W;
    const scale = Math.max(total, r.targetMonthlyToday) * 1.04;

    // Shortfall shown as a neutral segment up to the target line.
    const GAP_COLOR = "#d5dcd9";
    const segments = gap > 0 ? [...src, { label: "Chýba do cieľa", value: gap, color: GAP_COLOR }] : src;

    const legendRows = segments.map((x) => [swatch(x.color), td(x.label), tdNum(eur(x.value)), tdNum(pct((x.value / r.targetMonthlyToday) * 100))]);
    legendRows.push([td(""), td("Očakávaný príjem spolu", { bold: true }), tdNum(eur(total), { bold: true }), tdNum(pct((total / r.targetMonthlyToday) * 100), { bold: true })]);

    return nn([
      tiles([
        tile(ctx, "Odchod do dôchodku", `${r.retirementAge} rokov`, yearsLeft > 0 ? `o ${yearsLeft} rokov` : " "),
        tile(ctx, "Cieľový príjem", eur(r.targetMonthlyToday), "mesačne, v dnešných cenách"),
        tile(ctx, "Očakávaný príjem", eur(total), "mesačne, v dnešných cenách"),
        tile(ctx, gap > 0 ? "Chýba mesačne" : "Rezerva nad cieľ", eur(Math.abs(gap)),
          gap > 0 && r.requiredExtraMonthlyInvestment ? `treba investovať +${eur(r.requiredExtraMonthlyInvestment)} / mes.` : " "),
      ]),
      block("Zloženie dôchodkového príjmu", [
        { text: "Čiara označuje cieľový mesačný príjem. Všetky sumy sú v dnešných cenách.", style: "muted", margin: [0, 0, 0, 4] },
        stackedBar(segments.map((x) => x.value), segments.map((x) => x.color), scale, barW, r.targetMonthlyToday, 20),
        dataTable(ctx, [12, "*", 80, 90], [th(""), th("Zdroj príjmu"), th("€ / mes.", true), th("Podiel na cieli", true)], legendRows, { hasTotal: true }),
      ]),
      gap > 0 && r.requiredExtraMonthlyInvestment ? {
        margin: [0, 8, 0, 0],
        table: { widths: ["*"], body: [[{
          fillColor: ctx.brand.primarySoft, margin: [10, 8, 10, 8],
          text: [
            { text: "Ako dorovnať rozdiel: ", bold: true },
            `pri súčasnom nastavení bude chýbať ${eur(gap)} mesačne. Na jeho pokrytie odporúčame navýšiť pravidelnú investíciu o ${eur(r.requiredExtraMonthlyInvestment)} mesačne` +
            `${r.payoutEndAge ? ` s čerpaním do veku ${r.payoutEndAge} rokov` : ""}.` +
            (r.note ? ` ${r.note}` : ""),
          ],
        }]] },
        layout: "noBorders",
      } : null,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Income scaling
  // ---------------------------------------------------------------------------
  function renderIncomeScaling(ctx, s) {
    const steps = (s.steps || []).slice().sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    let running = s.currentNetMonthly;
    const rows = steps.map((st) => {
      running += st.extraNetMonthly;
      return [
        { stack: nn([{ text: st.label, bold: true }, st.person ? { text: st.person, style: "small" } : null]) },
        tdNum(fmtMonth(st.startDate)),
        tdNum(eurSigned(st.extraNetMonthly)),
        tdNum(isNum(st.probabilityPct) ? pct(st.probabilityPct) : "—"),
        tdNum(eur(running), { bold: true }),
      ];
    });
    const growth = s.currentNetMonthly > 0 ? ((running - s.currentNetMonthly) / s.currentNetMonthly) * 100 : null;

    const alloc = (s.allocation || []).filter((a) => a.pct > 0);
    return nn([
      tiles([
        tile(ctx, "Čistý príjem dnes", eur(s.currentNetMonthly), "mesačne"),
        tile(ctx, "Po všetkých krokoch", eur(running), growth != null ? `+${pct(growth)}` : " "),
        tile(ctx, "Navýšenie spolu", eurSigned(running - s.currentNetMonthly), "mesačne"),
      ]),
      block("Plán rastu príjmu", [dataTable(ctx, ["*", 50, 90, 70, 90],
        [th("Krok"), th("Od", true), th("Navýšenie / mes.", true), th("Pravdepodob.", true), th("Príjem potom", true)], rows)]),
      alloc.length ? block("Ako rozdeliť každé navýšenie príjmu", [
        stackedBar(alloc.map((a) => a.pct), SERIES, sum(alloc, (a) => a.pct), CONTENT_W),
        dataTable(ctx, [12, "*", 70],
          [th(""), th("Použitie"), th("Podiel", true)],
          alloc.map((a, i) => [swatch(SERIES[i]), td(a.label), tdNum(pct(a.pct))])),
      ]) : null,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Closing: assumptions, disclaimer, signatures
  // ---------------------------------------------------------------------------
  function renderClosing(ctx, num, breakMode) {
    const a = ctx.data.assumptions || {};
    const notes = nn([
      isNum(a.inflationPct) ? `Inflácia ${pct(a.inflationPct)} ročne; sumy „v dnešných cenách“ sú o ňu očistené.` : null,
      ...(a.notes || []),
    ]);
    const sigLine = (label, name) => ({
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6, lineColor: ctx.brand.inkSecondary }], margin: [0, 40, 0, 4] },
        { text: label, style: "small" },
        { text: name, bold: true },
      ],
    });
    return nn([
      ...h1(ctx, num, L.closing, null, breakMode),
      notes.length ? block("Predpoklady výpočtov", [{ ul: notes, style: "small" }]) : null,
      block("Dôležité upozornenie", [{ text: L.disclaimer, style: "small", lineHeight: 1.4 }]),
      {
        unbreakable: true,
        margin: [0, 16, 0, 0],
        stack: [
          { text: `V ................................ dňa ${fmtDate(ctx.data.meta.date)}`, style: "small", margin: [0, 12, 0, 0] },
          { columns: [sigLine(L.client, `${ctx.data.client.firstName} ${ctx.data.client.lastName}`), sigLine(L.advisor, ctx.data.advisor.name)], columnGap: 40 },
        ],
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  /**
   * @param {FinancialPlanReport} data
   * @param {PdfOptions} [options]
   */
  function buildDocDefinition(input, options) {
    // pdfmake annotates the nodes it lays out (arrays included), so work on a
    // copy and never mutate the caller's plan object.
    const data = JSON.parse(JSON.stringify(input));
    const opts = options || {};
    const brand = Object.assign({}, DEFAULT_BRAND, opts.brand || {});
    const ctx = { data, brand };
    const breaks = ["always", "auto", "never"].includes(opts.sectionPageBreaks) ? opts.sectionPageBreaks : "auto";
    const active = activeSections(data);

    const content = [...renderCover(ctx), ...renderSummary(ctx, active)];
    let num = 2;
    SECTIONS.forEach((s) => {
      if (!active.includes(s.key)) return;
      content.push(...h1(ctx, num++, L.modules[s.key], null, breaks));
      content.push(...s.render(ctx, data[s.key]));
    });
    content.push(...renderClosing(ctx, num, breaks));

    const images = {};
    if (brand.logo && !isSvg(brand.logo)) images.logo = brand.logo;

    return {
      pageSize: "A4",
      pageMargins: [MARGIN_X, 62, MARGIN_X, 54],
      info: {
        title: `${L.docTitle} — ${data.client.firstName} ${data.client.lastName}`,
        author: data.advisor.name,
        subject: L.docTitle,
        creator: brand.companyName || data.advisor.company || L.docTitle,
      },
      background: coverBackground(ctx),
      header: header(ctx),
      footer: footer(ctx),
      content,
      images,
      pageBreakBefore: (node, followingNodesOnPage) =>
        // Section heading in "auto" mode: start a new page when this one is mostly used.
        (node.headlineLevel === 1 && node.startPosition.verticalRatio > AUTO_BREAK_RATIO) ||
        // Keep a subheading from being stranded at the bottom of a page.
        (node.headlineLevel === 2 && followingNodesOnPage.length < 4),
      defaultStyle: { font: "Roboto", fontSize: 9.5, color: brand.ink, lineHeight: 1.2 },
      styles: {
        h1: { fontSize: 20, bold: true, color: brand.ink },
        h2: { fontSize: 11.5, bold: true, color: brand.ink, margin: [0, 16, 0, 6] },
        lead: { fontSize: 10.5, color: brand.inkSecondary, lineHeight: 1.35, margin: [0, 0, 0, 8] },
        th: { fontSize: 7, bold: true, color: brand.muted, characterSpacing: 0.4 },
        table: { fontSize: 8.5 },
        small: { fontSize: 7.8, color: brand.inkSecondary },
        muted: { fontSize: 7.8, color: brand.muted },
        tileLabel: { fontSize: 7.5, bold: true, color: brand.inkSecondary },
        tileValue: { fontSize: 15, bold: true, color: brand.ink, margin: [0, 3, 0, 1] },
        tileSub: { fontSize: 7.3, color: brand.inkSecondary },
        coverName: { fontSize: 12, bold: true, color: brand.ink },
        tocItem: { fontSize: 10, color: brand.ink, margin: [0, 3, 0, 3] },
        tocNumber: { fontSize: 10, color: brand.muted, margin: [0, 3, 0, 3] },
        headerText: { fontSize: 7.5, color: brand.muted },
        footer: { fontSize: 7.3, color: brand.muted },
      },
    };
  }

  function requirePdfMake() {
    const pm = global.pdfMake;
    if (!pm || typeof pm.createPdf !== "function") {
      throw new Error("pdfmake nie je načítaný — pridajte pdfmake.min.js a vfs_fonts.js pred plan-pdf.js.");
    }
    return pm;
  }

  /** @param {FinancialPlanReport} data */
  function defaultFileName(data) {
    const slug = `${data.client.firstName} ${data.client.lastName}`
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `financny-plan-${slug || "klient"}-${(data.meta.date || new Date().toISOString()).slice(0, 10)}.pdf`;
  }

  /**
   * Generates the PDF and starts the download in the browser.
   * @param {FinancialPlanReport} data
   * @param {PdfOptions} [options]
   * @returns {Promise<void>}
   */
  function download(data, options) {
    const pm = requirePdfMake();
    const name = (options && options.fileName) || defaultFileName(data);
    return new Promise((resolve) => pm.createPdf(buildDocDefinition(data, options)).download(name, () => resolve()));
  }

  /**
   * @param {FinancialPlanReport} data
   * @param {PdfOptions} [options]
   * @returns {Promise<Blob>}
   */
  function getBlob(data, options) {
    const pm = requirePdfMake();
    return new Promise((resolve) => pm.createPdf(buildDocDefinition(data, options)).getBlob(resolve));
  }

  /**
   * Reads a File (e.g. logo upload) as a data URL usable in `brand.logo`.
   * @param {Blob} file
   * @returns {Promise<string>}
   */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  const api = { buildDocDefinition, download, getBlob, activeSections, defaultFileName, fileToDataUrl, DEFAULT_BRAND };
  global.FinancialPlanPdf = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
