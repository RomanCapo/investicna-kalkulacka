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
      children: "Sporenie pre deti",
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
      isActive: (s) => !!s && (!!s.mortgage || hasItems(s.properties) || hasItems(s.loans) || hasItems(s.plannedPurchases)),
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
      key: "children",
      isActive: (s) => !!s && (s.kids || []).some((k) => k.monthly > 0 || k.principal > 0),
      render: renderChildren,
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
      isActive: (s) => !!s && (!!s.referral || hasItems(s.steps)),
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
  function lineChartSvg(ctx, series, height, opts) {
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
      if (!(opts && opts.noEndLabels)) out.push(`<text x="${(e.x + 7).toFixed(1)}" y="${(e.ly + 2.5).toFixed(1)}" font-family="Roboto" font-size="7.5" font-weight="bold" fill="${ctx.brand.ink}">${esc(compactEur(e.v))}</text>`);
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
    const mort = s.mortgage;
    if (mort && mort.motivation) out.push(...housingIntro(ctx, mort.motivation));
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
          h2([p.label, p.type ? `${L.propertyType[p.type] || p.type}${p.usage ? `, ${L.usage[p.usage] || p.usage}` : ""}` : null, p.targetDate ? `plánovaná kúpa ${fmtMonth(p.targetDate)}` : null].filter(Boolean).join(" · ")),
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

    if (mort) {
      const dur = (months) => { const y = Math.round((months / 12) * 10) / 10; return Number.isInteger(y) ? `${y} ${rokov(y)}` : `${num1(y)} roka`; };
      const rows = [["Bez zmeny", mort.base], ["Mimoriadne splátky", mort.prepay], ["Investovanie popri hypotéke", mort.invest]].map(([l, sc], i) => [
        td(l + (i > 0 && (mort.planChoice === "invest" ? i === 2 : i === 1) ? " (v pláne)" : ""), { bold: true }),
        tdNum(`${sc.endAge} r.`), tdNum(i ? dur(sc.savedMonths) : "—"), tdNum(eur(sc.out != null ? sc.out : sc.interest)), tdNum(i ? eur(sc.saved) : "—", { bold: true }),
      ]);
      const chart = mort.chart || [];
      // Každá čiara končí v roku splatenia (inak by sa popisky „0 €“ na konci prekrývali).
      const upToPayoff = (key) => { const i = chart.findIndex((p, j) => j > 0 && p[key] <= 0.5); return (i < 0 ? chart : chart.slice(0, i + 1)).map((p) => ({ x: p.age, y: p[key] })); };
      const series = [
        { label: "Bez zmeny", color: MOT_DANGER, points: upToPayoff("base") },
        { label: "Mimoriadne splátky", color: ctx.brand.primary, points: upToPayoff("prepay") },
        { label: "Investovanie", color: SERIES[0], points: upToPayoff("invest") },
      ];
      const extra = `${eur(mort.extra)} mesačne navyše${mort.lump > 0 ? ` a ${eur(mort.lump)} jednorazovo` : ""}`;
      out.push(block(mort.mode === "new" ? "Nová hypotéka a predčasné splatenie" : "Predčasné splatenie hypotéky", nn([
        tiles([
          tile(ctx, mort.mode === "new" ? "Výška úveru" : "Zostatok úveru", eur(mort.loan), `${pct(mort.rate)} · fixácia ${mort.fixYears} r.`),
          tile(ctx, "Mesačná splátka", eur(mort.payment), `${mort.years} ${rokov(mort.years)}, posledná v ${mort.base.endAge} r.`),
          tile(ctx, "Úroky spolu", eur(mort.base.interest), `zaplatíte ${eur(mort.totalPaid)}`),
        ]),
        { text: `Porovnanie pri ${extra}. Mimoriadne splátky raz ročne (bez poplatku do 20 % istiny a pri konci fixácie); pri investovaní sa hypotéka splatí naraz, keď investícia dosiahne zostatok (výnos ${pct(mort.invPct)} ročne, nie je zaručený).`,
          style: "muted", margin: [0, 8, 0, 4] },
        dataTable(ctx, ["*", 70, 70, 80, 80], [th("Scenár"), th("Splatená vo veku", true), th("Skôr o", true), th("Zaplatíte spolu", true), th("Ušetríte", true)], rows),
        chart.length >= 2 ? legendRow(series) : null,
        chart.length >= 2 ? lineChartSvg(ctx, series, 150, { noEndLabels: true }) : null,
        chart.length >= 2 ? { text: "Zostatok úveru podľa veku klienta; bodka = splatenie.", style: "muted", margin: [0, 4, 0, 0] } : null,
      ])));
    }

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
    if (s.motivation) out.push(...securityIntro(ctx, s.motivation));
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
  // ---------------------------------------------------------------------------
  // Úvod pre klienta v kapitole Renta (rovnaký obsah ako v dôchodkovej kalkulačke):
  // strana 1 „ponožka vs. pripravený“, strana 2 predčasný dôchodok. Farby berie
  // z brandingu plánu; červená len pre to, čo chýba.
  // ---------------------------------------------------------------------------
  const MOT_DANGER = "#c23b32";
  const MOT_DANGER_SOFT = "#f8e8e6";
  const MOT_TINT = "#f5f7f5";
  const rokov = (n) => (n === 1 ? "rok" : n >= 2 && n <= 4 ? "roky" : "rokov");

  const MOT_WORK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#eef2f0"/>
    ${[40, 78, 116].map((y) => `<rect x="18" y="${y}" width="150" height="6" rx="3" fill="#cfd9d5"/>`).join("")}
    ${[22, 52, 84, 118, 142].map((x, i) => `<rect x="${x}" y="${18 + (i % 2) * 4}" width="20" height="22" rx="3" fill="${["#d08a16", "#9fb8b0", "#c23b32", "#0f6b5c", "#9fb8b0"][i]}" opacity="0.75"/>`).join("")}
    ${[26, 60, 96, 130].map((x, i) => `<rect x="${x}" y="${56 + (i % 2) * 3}" width="24" height="22" rx="3" fill="${["#9fb8b0", "#d08a16", "#9fb8b0", "#c23b32"][i]}" opacity="0.65"/>`).join("")}
    ${[24, 58, 92, 126].map((x, i) => `<rect x="${x}" y="${94 + (i % 2) * 3}" width="26" height="20" rx="3" fill="${["#0f6b5c", "#9fb8b0", "#d08a16", "#9fb8b0"][i]}" opacity="0.65"/>`).join("")}
    <rect x="0" y="146" width="320" height="54" fill="#10231f"/>
    <rect x="176" y="112" width="92" height="40" rx="6" fill="#2b4a43"/>
    <rect x="188" y="120" width="44" height="14" rx="3" fill="#bfe3d6"/>
    <circle cx="252" cy="127" r="6" fill="#d08a16"/>
    <circle cx="268" cy="54" r="30" fill="#ffffff" stroke="#10231f" stroke-width="5"/>
    <line x1="268" y1="54" x2="268" y2="34" stroke="#10231f" stroke-width="5" stroke-linecap="round"/>
    <line x1="268" y1="54" x2="283" y2="62" stroke="#c23b32" stroke-width="5" stroke-linecap="round"/>
    <text x="160" y="182" text-anchor="middle" font-family="Roboto" font-size="15" font-weight="bold" fill="#ffffff">zmena 6:00 – 14:00</text>
  </svg>`;
  const MOT_HOLIDAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d5eeea"/><stop offset="1" stop-color="#fbf4e4"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#sky)"/>
    <circle cx="252" cy="52" r="26" fill="#e3a33b"/>
    <path d="M0 132 Q40 122 80 132 T160 132 T240 132 T320 132 V200 H0Z" fill="#5cb8aa"/>
    <path d="M0 150 Q40 140 80 150 T160 150 T240 150 T320 150 V200 H0Z" fill="#2f9486"/>
    <rect x="0" y="168" width="320" height="32" fill="#efe1c2"/>
    <path d="M70 170 C74 130 70 104 80 78" stroke="#8a5a2b" stroke-width="8" fill="none" stroke-linecap="round"/>
    ${[[-60, "#0f6b5c"], [-20, "#1baf7a"], [20, "#0f6b5c"], [60, "#1baf7a"], [150, "#0c5a4d"]].map(([a, c]) => `<ellipse cx="80" cy="78" rx="34" ry="9" fill="${c}" transform="rotate(${a} 80 78) translate(24 0)"/>`).join("")}
    <rect x="170" y="158" width="58" height="8" rx="4" fill="#ffffff" transform="rotate(-14 199 162)"/>
    <rect x="236" y="160" width="58" height="8" rx="4" fill="#ffffff" transform="rotate(-14 265 164)"/>
    <rect x="218" y="122" width="6" height="44" fill="#c23b32"/>
    <path d="M186 124 Q221 96 256 124 Z" fill="#c23b32"/>
    <path d="M204 124 Q221 106 238 124 Z" fill="#ffffff" opacity="0.6"/>
  </svg>`;

  // Ako vznikol štátny dôchodok — rovnaká veta ako v kalkulačke.
  function pensionExplain(p) {
    const n = (x, d) => new Intl.NumberFormat("sk-SK", { maximumFractionDigits: d }).format(x);
    const state = p.mode === "manual"
      ? `Štátny dôchodok ${eur(p.state)} je zadaný ručne (napr. z listu Sociálnej poisťovne).`
      : `Štátny dôchodok ${eur(p.state)} = osobný mzdový bod ${n(p.pomb, 3)} (mzda ${eur(p.wage)} ÷ priemerná mzda ${eur(p.avgWage)}) × ` +
        `${n(p.effYears, 1)} rokov poistenia${p.p2Enabled ? " (po krátení za 2. pilier)" : ""} × ADH ${n(p.adh, 2)} €.`;
    return p.p2Enabled && p.p2 > 0.5 ? `${state} K tomu renta z 2. piliera ${eur(p.p2)}.` : state;
  }

  // Rámček s jednou bunkou (pdfmake nemá zaoblené rohy ani prechody).
  const box = (content, fill, border, margin) => ({
    table: { widths: ["*"], body: [[Object.assign({ fillColor: fill, margin: [9, 6, 9, 7] }, content)]] },
    layout: { hLineWidth: () => (border ? 0.8 : 0), vLineWidth: () => (border ? 0.8 : 0), hLineColor: () => border, vLineColor: () => border },
    margin: margin || [0, 0, 0, 0],
  });

  const centered = (node, width) => ({ columns: [{ width: "*", text: "" }, Object.assign({ width }, node), { width: "*", text: "" }] });

  function motTop(ctx, title, subtitle, compact) {
    return {
      stack: nn([
        compact ? null : { text: "ÚVOD PRE KLIENTA", fontSize: 8, bold: true, characterSpacing: 1.2, color: ctx.brand.primary },
        { text: title, fontSize: compact ? 17 : 20, bold: true, color: ctx.brand.ink, margin: [0, compact ? 0 : 3, 0, 0] },
        subtitle ? Object.assign({ italics: true, fontSize: 10.5, color: ctx.brand.inkSecondary, lineHeight: 1.3, margin: [0, 3, 0, 0] }, subtitle) : null,
      ]),
      margin: [0, 0, 0, compact ? 7 : 10],
    };
  }

  const pill = (text, fill) => centered({
    table: { body: [[{ text, color: "#ffffff", bold: true, fontSize: 15, fillColor: fill, margin: [14, 4, 14, 5], alignment: "center" }]] },
    layout: "noBorders",
  }, "auto");

  function motDivider(ctx) {
    const mid = CONTENT_W / 2;
    const dot = (x) => ({ type: "ellipse", x, y: 4, r1: 2.2, r2: 2.2, color: ctx.brand.primary });
    return {
      canvas: [
        { type: "line", x1: mid - 140, y1: 4, x2: mid - 20, y2: 4, lineWidth: 0.6, lineColor: ctx.brand.hairline },
        dot(mid - 10), dot(mid), dot(mid + 10),
        { type: "line", x1: mid + 20, y1: 4, x2: mid + 140, y2: 4, lineWidth: 0.6, lineColor: ctx.brand.hairline },
      ],
      margin: [0, 6, 0, 6],
    };
  }

  function duelCard(ctx, title, sub, monthly, monthlyNote, total, accent, soft) {
    return {
      table: {
        widths: ["*"],
        body: [
          [{ fillColor: soft, margin: [6, 5, 6, 5], stack: [
            { text: title, bold: true, fontSize: 15, color: accent, alignment: "center" },
            { text: sub, italics: true, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 0] },
          ] }],
          [{ margin: [6, 5, 6, 6], stack: [
            { text: eur(monthly), bold: true, fontSize: 17, color: ctx.brand.ink, alignment: "center" },
            { text: monthlyNote, bold: true, fontSize: 8, color: ctx.brand.muted, alignment: "center" },
            { text: "Celkovo odložím", fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 3, 0, 0] },
            { text: eur(total), bold: true, fontSize: 11.5, color: ctx.brand.ink, alignment: "center" },
          ] }],
        ],
      },
      layout: { hLineWidth: (i) => (i === 1 ? 0 : 1.2), vLineWidth: () => 1.2, hLineColor: () => accent, vLineColor: () => accent },
    };
  }

  function retirementIntro(ctx, m) {
    const P = ctx.brand.primary, SOFT = ctx.brand.primarySoft, INK = ctx.brand.ink;
    const hasGap = m.capNeedReal > 0.5 && isFinite(m.capNeedReal);
    const saveMonthly = (m.sockMonthly || 0) - (m.fundMonthly || 0);
    const saveTotal = (m.sockTotal || 0) - (m.fundTotal || 0);
    const max = Math.max(m.currentNet || 0, m.statePillars || 0, m.target || 0, 1);
    const barW = 240;
    const barRow = (label, value, color) => [
      { text: label, fontSize: 8.5, bold: true, color: ctx.brand.inkSecondary, margin: [0, 1, 0, 0] },
      { canvas: [{ type: "rect", x: 0, y: 2, w: Math.max(6, (value / max) * barW), h: 8, r: 4, color }] },
      { text: eur(value), fontSize: 9.5, bold: true, color: INK, alignment: "right" },
    ];
    const chip = (label, value) => ({
      stack: [{ text: label.toUpperCase(), fontSize: 7, bold: true, color: ctx.brand.muted, characterSpacing: 0.4 }, { text: value, fontSize: 13, bold: true, color: INK, margin: [0, 1, 0, 0] }],
      fillColor: MOT_TINT, margin: [10, 4, 10, 5],
    });
    const dyn = m.dynamization > 0 ? ` (+${pct(m.dynamization)} ročne)` : "";

    const page1 = nn([
      motTop(ctx, "Dôchodok", { text: "Dôchodcovia – ich životné krédo? Ich životné heslo?\nŽiť len zo spomienok! Z dôchodku to nešlo…" }, true),
      {
        table: { widths: ["*", "*", "*"], body: [[chip("Čistý príjem dnes", eur(m.currentNet)), chip("Vek", `${m.age} ${rokov(m.age)}`), chip("Do dôchodku", `${m.yearsToRet} ${rokov(m.yearsToRet)}`)]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === 3 ? 0 : 8), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        margin: [0, 0, 0, 8],
      },
      { text: "Buď sa nedožijete dôchodku, alebo budete pracujúci dôchodca až do smrti.", alignment: "center", bold: true, fontSize: 10.5, color: INK },
      { text: "PREČO?", alignment: "center", bold: true, fontSize: 8, characterSpacing: 1, color: ctx.brand.muted, margin: [0, 3, 0, 1] },
      { text: [`Pretože váš dôchodok bude o ${m.yearsToRet} ${rokov(m.yearsToRet)} iba `, { text: eur(m.statePillars), color: MOT_DANGER }], alignment: "center", bold: true, fontSize: 16, color: INK },
      centered({
        table: { widths: [90, barW, "*"], body: [barRow("Dnes zarábate", m.currentNet, INK), barRow("Dôchodok od štátu", m.statePillars, MOT_DANGER), barRow("Chcete mať", m.target, P)] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 4, paddingRight: () => 4 },
        margin: [0, 6, 0, 2],
      }, 390),
      m.dropPct != null && m.dropPct > 1
        ? { text: ["To je o ", { text: `${Math.round(m.dropPct)} %`, color: MOT_DANGER, bold: true }, " menej, než dnes zarábate."], alignment: "center", fontSize: 8.5, bold: true, color: ctx.brand.inkSecondary }
        : null,
      m.pension ? box({ text: [{ text: "Ako sme to počítali: ", bold: true, color: INK }, pensionExplain(m.pension), " Sumy sú v dnešných cenách."], fontSize: 8, color: ctx.brand.inkSecondary, lineHeight: 1.25 }, MOT_TINT, ctx.brand.hairline, [0, 6, 0, 0]) : null,
    ]);

    if (hasGap) {
      let status = null;
      if (m.currentMonthly > 0.5) {
        status = m.missing > 0.5
          ? { warn: true, text: [`Dnes už investujete `, { text: eur(m.currentMonthly), bold: true }, ` mesačne — renta z toho bude ${eur(m.ownRenta)}. Do cieľa ešte chýba ${eur(m.missing)} mesačne, preto treba pridať `, { text: `${eur(m.extraMonthly)} mesačne`, bold: true }, "."] }
          : { warn: false, text: [`Dnes už investujete `, { text: eur(m.currentMonthly), bold: true }, ` mesačne — to na cieľ stačí. Spolu budete mať ${eur(m.totalIncome)} mesačne.`] };
      } else if (m.currentMonthly != null) {
        status = { warn: true, text: `Zatiaľ si na dôchodok pravidelne neodkladáte — celý rozdiel ${eur(m.missing)} mesačne treba vytvoriť.` };
      }
      page1.push(
        { stack: [pill("Ako to zmeniť?", P)], margin: [0, 6, 0, 4] },
        { text: [
          "Pri odchode do dôchodku potrebujete mať na účte ",
          { text: ` ${eur(m.capNeedReal)} `, bold: true, fontSize: 13, color: P, background: SOFT },
          `, aby ste si udržali príjem ${eur(m.target)} mesačne — tento balík peňazí vám bude `,
          { text: "generovať ďalšie peniaze", color: P },
          ".",
        ], alignment: "center", bold: true, fontSize: 10, color: INK, lineHeight: 1.3, margin: [24, 0, 24, 0] },
        { text: `Suma je v dnešných cenách — o ${m.yearsToRet} ${rokov(m.yearsToRet)} to s infláciou bude ${eur(m.capNeedNom)}.`, alignment: "center", fontSize: 8, color: ctx.brand.muted, margin: [0, 3, 0, 0] },
        { text: "Ak ich máte, gratulujem — od zajtra môžete byť rentierom a nemusíte už chodiť do práce.", alignment: "center", italics: true, fontSize: 8.5, color: ctx.brand.muted, margin: [0, 2, 0, 1] },
        { text: "Ak ich nemáte, musíte si ich vytvoriť odkladaním —\nmesačne do ponožky, alebo tým správnym sporením.", alignment: "center", bold: true, fontSize: 10.5, color: INK },
        {
          columns: [
            { width: "*", stack: [duelCard(ctx, "Ponožka", "Už dnes si musíš odkladať", m.sockMonthly, "mesačne", m.sockTotal, MOT_DANGER, MOT_DANGER_SOFT)] },
            { width: 50, text: "ALEBO", bold: true, fontSize: 8.5, characterSpacing: 1, color: ctx.brand.muted, alignment: "center", margin: [0, 50, 0, 0] },
            { width: "*", stack: [duelCard(ctx, "Pripravený", "Som s tým v pohode a rozumne sa pripravujem", m.fundMonthly, `mesačne${dyn}`, m.fundTotal, P, SOFT)] },
          ],
          columnGap: 6,
          margin: [30, 5, 30, 4],
        },
        saveMonthly > 0.5 ? { text: [
          "Výhoda byť ", { text: "pripravený", color: P, decoration: "underline" }, " je v tom, že mesačne usporím ",
          { text: eur(saveMonthly), color: P }, "\na celkovo ", { text: eur(saveTotal), color: P }, " za celé obdobie sporenia.",
        ], alignment: "center", bold: true, fontSize: 11.5, color: INK, lineHeight: 1.25 } : null,
        status ? box({ text: status.text, fontSize: 9, color: INK, lineHeight: 1.25 }, status.warn ? MOT_DANGER_SOFT : SOFT, status.warn ? "#e8b9b4" : ctx.brand.hairline, [0, 7, 0, 0]) : null,
      );
    } else {
      page1.push(
        { stack: [pill("Ste na dobrej ceste", P)], margin: [0, 8, 0, 5] },
        { text: `Štát a piliere pokryjú cieľový príjem ${eur(m.target)} mesačne. Stačí v tom vytrvať — a možno môžete ísť do dôchodku aj skôr.`, alignment: "center", bold: true, fontSize: 10.5, color: INK, margin: [30, 0, 30, 0] },
      );
    }

    const tag = (text, fill) => ({ table: { body: [[{ text, bold: true, fontSize: 8, characterSpacing: 0.6, color: "#ffffff", fillColor: fill, margin: [6, 2, 6, 2] }]] }, layout: "noBorders", margin: [0, 0, 0, 4] });
    const sceneW = (CONTENT_W - 18) / 2;
    const earlyCard = (e) => ({
      fillColor: SOFT, margin: [6, 10, 6, 11], stack: [
        { text: `v ${e.age} rokoch`, bold: true, fontSize: 14, color: P, alignment: "center" },
        { text: "už dnes si musím odkladať", fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 3, 0, 7] },
        centered({ table: { body: [[{ text: [eur(e.monthly), { text: " / mes.", fontSize: 8 }], bold: true, fontSize: 12, color: "#ffffff", fillColor: P, margin: [10, 3, 10, 4] }]] }, layout: "noBorders" }, "auto"),
      ],
    });

    const page2 = nn([
      motTop(ctx, "Predčasný dôchodok", { text: ["Kedy už ", { text: "nemusím", color: MOT_DANGER, bold: true }, " chodiť do práce, ale ", { text: "chcem", color: P, bold: true }, " pracovať"] }),
      { text: "Stačí naozaj málo, aby bol aj život na dôchodku plnohodnotný.\nRozhodnutie je na vás, ako chcete tráviť dôchodok.", alignment: "center", italics: true, fontSize: 11.5, color: ctx.brand.inkSecondary, lineHeight: 1.3, margin: [0, 0, 0, 10] },
      {
        columns: [
          { width: sceneW, stack: [tag("V PRÁCI", MOT_DANGER), { svg: MOT_WORK_SVG, width: sceneW }] },
          { width: sceneW, stack: [tag("NA DOVOLENKE", P), { svg: MOT_HOLIDAY_SVG, width: sceneW }] },
        ],
        columnGap: 18,
      },
      { text: "Predstavte si odísť do dôchodku skôr, ako diktuje štát.\nUžívať si dôchodok a nechodiť už do práce.", alignment: "center", bold: true, fontSize: 12.5, color: INK, margin: [0, 12, 0, 0] },
      motDivider(ctx),
      { text: [
        "Niekto tento stav nedosiahne ", { text: "nikdy", color: MOT_DANGER, bold: true }, ",\n",
        "niekto v ", { text: `${m.retAge} rokoch`, bold: true }, ",\n",
        "a pripravený to ", { text: "dosiahne skôr", color: P, bold: true }, ".",
      ], alignment: "center", italics: true, fontSize: 14, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      m.early && m.early.length ? { text: "Čo preto musím spraviť?", alignment: "center", bold: true, fontSize: 11, color: INK, margin: [0, 0, 0, 8] } : null,
      m.early && m.early.length ? {
        table: { widths: m.early.map(() => "*"), body: [m.early.map(earlyCard)] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === m.early.length ? 0 : 10), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      } : { text: "Aj pár rokov skôr sa dá — prepočítajme si to spolu.", alignment: "center", bold: true, fontSize: 11, color: INK },
      { text: "Nikdy nie je neskoro, ani skoro začať.", alignment: "center", bold: true, italics: true, fontSize: 13, color: INK, margin: [0, 12, 0, 8] },
      { text: `Predčasný dôchodok: do ${m.retAge} rokov sa celý príjem ${eur(m.target)} vypláca z vlastných peňazí, potom už len rozdiel k štátnemu dôchodku. ` +
          `Suma je prvý mesačný vklad${m.dynamization > 0 ? ", ďalej sa zvyšuje ako pri pravidelnej investícii" : ""}. ` +
          `Sumy sú v dnešných cenách. Predpoklad: výnos ${pct(m.netReturn)} ročne po nákladoch, inflácia ${pct(m.inflation)}, ${m.perpetual ? "renta len z výnosov" : `renta do ${m.endAge} rokov`}; ponožka = rovnaká suma každý mesiac bez zhodnotenia.`,
        alignment: "center", fontSize: 7.5, color: ctx.brand.muted, lineHeight: 1.25 },
    ]);

    // Bez „unbreakable“: pdfmake nedeliteľný blok vyšší ako strana nevykreslí vôbec.
    return [
      { stack: page1 },
      { stack: page2, pageBreak: "before" },
      { text: "", pageBreak: "after" },
    ];
  }

  // ---------------------------------------------------------------------------
  // Úvod pre klienta v kapitole Zabezpečenie (rovnaký obsah ako v životnej kalkulačke):
  // strana 1 príbeh „Čo keby zajtra…“ s ilustráciami, strana 2 „čo keď príjem vypadne“ (bez poistenia vs. poistený), strana 3 čo a prečo poisťujeme.
  // ---------------------------------------------------------------------------
  // Ilustrácie ako v úvode k dôchodku (font Roboto je vo VFS pdfmake).
  // Ilustrácie úvodu: „bez poistenia“ (noc nad upomienkami) a „s poistením“ (rodina drží spolu).
  const lifeSceneSvgs = (font) => ({
    alone: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#26332f"/>
    <rect x="214" y="22" width="80" height="62" rx="4" fill="#131c1a" stroke="#465753" stroke-width="4"/>
    <line x1="254" y1="22" x2="254" y2="84" stroke="#465753" stroke-width="3"/>
    <line x1="214" y1="53" x2="294" y2="53" stroke="#465753" stroke-width="3"/>
    <circle cx="276" cy="38" r="9" fill="#e8e3c8"/><circle cx="281" cy="35" r="8" fill="#131c1a"/>
    ${[[226, 32], [238, 68], [270, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#e8e3c8"/>`).join("")}
    <rect x="34" y="30" width="46" height="44" rx="3" fill="#dfe4e1"/>
    <rect x="34" y="30" width="46" height="10" rx="3" fill="#c23b32"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${39 + c * 10}" y="${45 + r * 9}" width="6" height="5" fill="#9fb0ab"/>`).join("")).join("")}
    <path d="M39 45 L75 70 M75 45 L39 70" stroke="#c23b32" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="128" y1="0" x2="128" y2="30" stroke="#465753" stroke-width="2"/>
    <path d="M112 30 H144 L137 18 H119 Z" fill="#d08a16"/>
    <path d="M112 30 L78 146 H178 L144 30 Z" fill="#f3d9a4" opacity="0.13"/>
    <path d="M104 142 Q104 104 128 102 Q152 104 152 142 Z" fill="#0d1715"/>
    <circle cx="128" cy="88" r="14" fill="#0d1715"/>
    <path d="M108 124 L116 92" stroke="#0d1715" stroke-width="9" stroke-linecap="round"/>
    <path d="M148 124 L140 92" stroke="#0d1715" stroke-width="9" stroke-linecap="round"/>
    <rect x="28" y="140" width="212" height="9" rx="2" fill="#6b4f36"/>
    <rect x="40" y="149" width="7" height="24" fill="#503a27"/><rect x="221" y="149" width="7" height="24" fill="#503a27"/>
    <rect x="156" y="124" width="58" height="17" rx="2" fill="#f4f1ea" transform="rotate(-8 185 132)"/>
    <rect x="162" y="118" width="60" height="17" rx="2" fill="#ffffff" transform="rotate(5 192 126)"/>
    <text x="192" y="130" text-anchor="middle" font-family="${font}" font-size="7.5" font-weight="700" fill="#c23b32" transform="rotate(5 192 126)">UPOMIENKA</text>
    <rect x="58" y="128" width="26" height="12" rx="2" fill="#dfe4e1"/>
    <rect x="61" y="130" width="20" height="3" fill="#465753"/>
    <rect x="0" y="173" width="320" height="27" fill="#0d1715"/>
    <text x="160" y="191" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">3. mesiac bez výplaty</text>
  </svg>`,
    together: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs><linearGradient id="room" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3f1ec"/><stop offset="1" stop-color="#fbf4e4"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#room)"/>
    <rect x="228" y="20" width="72" height="58" rx="4" fill="#fdf6e3" stroke="#ffffff" stroke-width="4"/>
    <circle cx="264" cy="46" r="14" fill="#e3a33b"/>
    <line x1="264" y1="20" x2="264" y2="78" stroke="#ffffff" stroke-width="3"/>
    <rect x="26" y="126" width="18" height="22" rx="3" fill="#c96f3b"/>
    ${[[-38, "#1baf7a"], [-13, "#0f6b5c"], [13, "#1baf7a"], [38, "#0f6b5c"]].map(([a, c]) => `<ellipse cx="35" cy="106" rx="6" ry="18" fill="${c}" transform="rotate(${a} 35 126)"/>`).join("")}
    <path d="M160 58 C140 44 138 28 150 24 C156 22 160 28 160 31 C160 28 164 22 170 24 C182 28 180 44 160 58 Z" fill="#c23b32"/>
    <rect x="0" y="172" width="320" height="28" fill="#efe1c2"/>
    <circle cx="112" cy="74" r="12" fill="#e6b48c"/>
    <path d="M104 66 Q112 56 121 66 Z" fill="#6b4f36"/>
    <rect x="98" y="88" width="28" height="50" rx="12" fill="#0f6b5c"/>
    <rect x="102" y="134" width="9" height="36" rx="3" fill="#10231f"/><rect x="114" y="134" width="9" height="36" rx="3" fill="#10231f"/>
    <path d="M124 100 L142 110" stroke="#0f6b5c" stroke-width="7" stroke-linecap="round"/>
    <circle cx="152" cy="150" r="19" fill="none" stroke="#10231f" stroke-width="4"/>
    <circle cx="152" cy="150" r="3" fill="#10231f"/>
    <circle cx="180" cy="166" r="5" fill="none" stroke="#10231f" stroke-width="3"/>
    <path d="M140 108 L142 138 H176 L180 161" fill="none" stroke="#10231f" stroke-width="4" stroke-linejoin="round"/>
    <rect x="143" y="106" width="18" height="30" rx="8" fill="#1baf7a"/>
    <rect x="148" y="128" width="26" height="10" rx="5" fill="#2a78d6"/>
    <path d="M172 136 L175 156" stroke="#2a78d6" stroke-width="8" stroke-linecap="round"/>
    <circle cx="153" cy="94" r="11" fill="#e6b48c"/>
    <path d="M143 91 Q153 80 163 90 Z" fill="#10231f"/>
    <circle cx="212" cy="116" r="9" fill="#e6b48c"/>
    <path d="M203 113 Q212 104 221 113 Z" fill="#d08a16"/>
    <rect x="202" y="125" width="20" height="26" rx="8" fill="#d08a16"/>
    <rect x="204" y="149" width="7" height="22" rx="3" fill="#10231f"/><rect x="213" y="149" width="7" height="22" rx="3" fill="#10231f"/>
    <path d="M203 132 L172 124" stroke="#d08a16" stroke-width="6" stroke-linecap="round"/>
    <text x="160" y="191" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#10231f">život sa zmenil, domov zostal</text>
  </svg>`,
  });
  const LIFE_SCENES = lifeSceneSvgs("Roboto");

  function securityIntro(ctx, m) {
    const P = ctx.brand.primary, SOFT = ctx.brand.primarySoft, INK = ctx.brand.ink;
    const max = Math.max(m.net || 0, 1);
    const barW = 240;
    const barRow = (label, value, color) => [
      { text: label, fontSize: 8.5, bold: true, color: ctx.brand.inkSecondary, margin: [0, 1, 0, 0] },
      { canvas: [{ type: "rect", x: 0, y: 2, w: Math.max(6, (value / max) * barW), h: 8, r: 4, color }] },
      { text: eur(value), fontSize: 9.5, bold: true, color: INK, alignment: "right" },
    ];
    const chip = (label, value) => ({
      stack: [{ text: label.toUpperCase(), fontSize: 7, bold: true, color: ctx.brand.muted, characterSpacing: 0.4 }, { text: value, fontSize: 13, bold: true, color: INK, margin: [0, 1, 0, 0] }],
      fillColor: MOT_TINT, margin: [10, 4, 10, 5],
    });
    const premiumText = m.premium ? eur(m.premium) : `${eur(m.budgetLo)} – ${eur(m.budgetHi)}`;
    const card = (title, sub, amount, note, totalLabel, total, accent, soft) => ({
      table: {
        widths: ["*"],
        body: [
          [{ fillColor: soft, margin: [6, 5, 6, 5], stack: [
            { text: title, bold: true, fontSize: 15, color: accent, alignment: "center" },
            { text: sub, italics: true, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 0] },
          ] }],
          [{ margin: [6, 5, 6, 6], stack: [
            { text: amount, bold: true, fontSize: 17, color: INK, alignment: "center" },
            { text: note, bold: true, fontSize: 8, color: ctx.brand.muted, alignment: "center" },
            { text: totalLabel, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 3, 0, 0] },
            { text: total, bold: true, fontSize: 11.5, color: accent === P ? INK : MOT_DANGER, alignment: "center" },
          ] }],
        ],
      },
      layout: { hLineWidth: (i) => (i === 1 ? 0 : 1.2), vLineWidth: () => 1.2, hLineColor: () => accent, vLineColor: () => accent },
    });

    const tag = (text, fill) => ({ table: { body: [[{ text, bold: true, fontSize: 8, characterSpacing: 0.6, color: "#ffffff", fillColor: fill, margin: [6, 2, 6, 2] }]] }, layout: "noBorders", margin: [0, 0, 0, 4] });
    const sceneW = (CONTENT_W - 18) / 2;
    const page0 = nn([
      motTop(ctx, "Čo keby zajtra…", { text: ["…ste nemohli ísť do práce? Nie na týždeň. ", { text: "Na roky.", color: MOT_DANGER, bold: true }] }),
      { text: "Ráno ešte obyčajný deň — káva, cesta do práce, správa od detí. Stačí jeden nepozorný vodič, jedna diagnóza, jeden zlý krok na schodoch. " +
          "A zrazu sa doma nerieši, kam pôjdete v lete, ale z čoho zaplatíte ďalší mesiac.",
        alignment: "center", fontSize: 11, color: ctx.brand.inkSecondary, lineHeight: 1.35, margin: [20, 0, 20, 12] },
      {
        columns: [
          { width: sceneW, stack: [tag("BEZ POISTENIA", MOT_DANGER), { svg: LIFE_SCENES.alone, width: sceneW }] },
          { width: sceneW, stack: [tag("S POISTENÍM", P), { svg: LIFE_SCENES.together, width: sceneW }] },
        ],
        columnGap: 18,
      },
      { text: [`Z vašej výplaty ${eur(m.net)} by zostalo len `, { text: eur(m.inv40), color: MOT_DANGER }, "."], alignment: "center", bold: true, fontSize: 16, color: INK, margin: [0, 14, 0, 2] },
      { text: m.loans > 0 ? `Úver ${eur(m.loans)} sa pritom nezastaví — splátka príde aj v mesiaci, keď vy nemôžete.` : "Nájom, energie, nákupy a krúžky detí sa pritom nezastavia.",
        alignment: "center", fontSize: 9.5, color: ctx.brand.muted },
      motDivider(ctx),
      { text: [
        "Najväčší strach ľudí nie je z choroby.\n",
        "Je z toho, že sa stanú ", { text: "bremenom", color: MOT_DANGER, bold: true }, " pre tých, ktorých ", { text: "milujú", color: P, bold: true }, ".",
      ], alignment: "center", italics: true, fontSize: 14, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      { text: "Rozdiel medzi týmito dvoma obrázkami nie je šťastie.\nJe to jedno rozhodnutie urobené včas.", alignment: "center", bold: true, italics: true, fontSize: 13, color: INK, lineHeight: 1.3, margin: [0, 4, 0, 0] },
    ]);

    const page1 = nn([
      motTop(ctx, "Životné poistenie", { text: "Nepoisťujeme sa preto, že čakáme nešťastie.\nPoisťujeme sa, aby jeden zlý deň nezmazal roky práce." }, true),
      {
        table: { widths: ["*", "*", "*"], body: [[chip("Čistý príjem dnes", eur(m.net)), chip("Vek", `${m.age} ${rokov(m.age)}`), chip("Do dôchodku", `${m.yearsToRet} ${rokov(m.yearsToRet)}`)]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === 3 ? 0 : 8), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        margin: [0, 0, 0, 8],
      },
      { text: "Váš najcennejší majetok nie je byt ani auto. Je to vaša schopnosť zarábať.", alignment: "center", bold: true, fontSize: 10.5, color: INK },
      { text: "KOĽKO MÁ HODNOTU?", alignment: "center", bold: true, fontSize: 8, characterSpacing: 1, color: ctx.brand.muted, margin: [0, 3, 0, 1] },
      { text: [`Do ${m.retAge} rokov zarobíte ešte `, { text: eur(m.lifetime), color: P }], alignment: "center", bold: true, fontSize: 16, color: INK },
      { text: "Keby to bol stroj vo fabrike, poistili by ste ho ako prvý. Pri sebe na to väčšina ľudí zabudne.", alignment: "center", italics: true, fontSize: 8.5, color: ctx.brand.muted, margin: [0, 2, 0, 0] },
      { stack: [pill("Čo keď príjem vypadne?", P)], margin: [0, 8, 0, 4] },
      centered({
        table: { widths: [100, barW, "*"], body: [
          barRow("Dnes zarábate", m.net, INK), barRow("Počas PN dostanete", m.sickness, MOT_DANGER),
          barRow("Pri invalidite 40 %", m.inv40, MOT_DANGER), barRow("Pri invalidite 70 %", m.inv70, MOT_DANGER),
        ] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 4, paddingRight: () => 4 },
        margin: [0, 2, 0, 4],
      }, 400),
      { text: [
        "Pri invalidite vám bude každý mesiac chýbať ",
        { text: ` ${eur(m.lossInv40)} `, bold: true, fontSize: 13, color: P, background: SOFT },
        " — do dôchodku spolu ",
        { text: ` ${eur(m.lossTotal40)} `, bold: true, fontSize: 13, color: P, background: SOFT },
        ".",
      ], alignment: "center", bold: true, fontSize: 10, color: INK, lineHeight: 1.3, margin: [24, 2, 24, 0] },
      { text: `Počas PN chýba ${eur(m.lossSick)} mesačne${m.loans > 0 ? " a splátky úverov bežia ďalej" : " a výdavky sa nezastavia"}.`, alignment: "center", fontSize: 8.5, color: ctx.brand.muted, margin: [0, 3, 0, 0] },
      m.family && m.family.gap > 0.5
        ? box({ text: ["Keby ste tu zajtra neboli, rodine bude mesačne chýbať ", { text: eur(m.family.gap), bold: true }, `. Na ${m.family.years} ${rokov(m.family.years)} spolu s úvermi a pohrebom je to `, { text: eur(m.family.need), bold: true }, "."], fontSize: 9, color: INK, lineHeight: 1.25 }, MOT_DANGER_SOFT, "#e8b9b4", [0, 7, 0, 0])
        : null,
      {
        columns: [
          { width: "*", stack: [card("Bez poistenia", "Riziko nesiem sám", eur(m.lossTotal40), "strata pri invalidite do dôchodku", "Zaplatia to", "úspory, majetok, rodina", MOT_DANGER, MOT_DANGER_SOFT)] },
          { width: 50, text: "ALEBO", bold: true, fontSize: 8.5, characterSpacing: 1, color: ctx.brand.muted, alignment: "center", margin: [0, 50, 0, 0] },
          { width: "*", stack: [card("Poistený", "Riziko nesie poisťovňa", premiumText, m.premium ? "mesačne" : "mesačne (5–10 % príjmu)", "Príjem aj rodina", "zostanú chránené", P, SOFT)] },
        ],
        columnGap: 6,
        margin: [30, 8, 30, 4],
      },
      { text: ["Za ", { text: premiumText, color: P }, " mesačne prenesiete na poisťovňu\nriziko v hodnote ", { text: eur(m.lossTotal40), color: P }, "."],
        alignment: "center", bold: true, fontSize: 11.5, color: INK, lineHeight: 1.25 },
    ]);

    const riderRows = (items) => items.map((r) => [{ margin: [8, 5, 8, 5], stack: [
      { columns: [
        { text: r.label, bold: true, fontSize: 10, color: INK },
        { text: eur(r.value) + String(r.unit || "").replace(/^€/, ""), bold: true, fontSize: 10, color: P, alignment: "right", width: "auto" },
      ], columnGap: 6 },
      { text: r.pitch || "", fontSize: 8.5, color: ctx.brand.inkSecondary, lineHeight: 1.2, margin: [0, 2, 0, 0] },
    ] }]);
    const group = (title, items, head, fill) => (items && items.length ? {
      table: { widths: ["*"], body: [[{ text: title.toUpperCase(), bold: true, fontSize: 8.5, characterSpacing: 0.6, color: head, fillColor: fill, margin: [8, 5, 8, 5] }], ...riderRows(items)] },
      layout: { hLineWidth: (i) => (i === 0 ? 0 : 0.6), vLineWidth: () => 0, hLineColor: () => ctx.brand.hairline },
      margin: [0, 0, 0, 10],
    } : null);

    const page2 = nn([
      motTop(ctx, "Čo a prečo poisťujeme", { text: ["Najprv to, čo by vás ", { text: "finančne položilo", color: MOT_DANGER, bold: true }, ", až potom to, čo vás ", { text: "iba zamrzí", color: P, bold: true }, "."] }),
      group("Kľúčové krytie", m.core, MOT_DANGER, MOT_DANGER_SOFT),
      group("Doplnkové krytie", m.extra, P, SOFT),
      motDivider(ctx),
      { text: [
        "Poistenie si ", { text: "nekupujete pre seba", color: MOT_DANGER, bold: true }, ".\n",
        "Kupujete ho pre tých, ktorí by inak ", { text: "zaplatili účet za zlý deň", color: P, bold: true }, ".",
      ], alignment: "center", italics: true, fontSize: 13, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      { text: "Najlacnejšie poistenie je to, ktoré uzavriete, kým ste zdravý.", alignment: "center", bold: true, italics: true, fontSize: 12, color: INK, margin: [0, 4, 0, 8] },
      { text: "Odporúčané sumy sú minimálne a vychádzajú z čistého príjmu, úverov a dávok Sociálnej poisťovne (nemocenská 55 % denného vymeriavacieho základu, invalidný dôchodok podľa odpracovaných rokov a percenta invalidity). " +
          "Strata do dôchodku = mesačný výpadok × 12 × roky do dôchodku, v dnešných cenách. Ilustratívny prepočet, nie je ponukou poistenia.",
        alignment: "center", fontSize: 7.5, color: ctx.brand.muted, lineHeight: 1.25 },
    ]);

    return [
      { stack: page0 },
      { stack: page1, pageBreak: "before" },
      { stack: page2, pageBreak: "before" },
      { text: "", pageBreak: "after" },
    ];
  }

  // Ilustrácie úvodu k sporeniu pre deti (rovnaké ako v detskej kalkulačke).
  const kidSceneSvgs = (font) => ({
    noPlan: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#dde3e1"/>
    <ellipse cx="236" cy="40" rx="40" ry="16" fill="#9fb0ab"/><ellipse cx="206" cy="46" rx="26" ry="13" fill="#9fb0ab"/><ellipse cx="262" cy="48" rx="24" ry="12" fill="#9fb0ab"/>
    ${[196, 214, 232, 250, 268].map((x, i) => `<line x1="${x}" y1="${64 + (i % 2) * 6}" x2="${x - 6}" y2="${82 + (i % 2) * 6}" stroke="#7f928d" stroke-width="2.5" stroke-linecap="round"/>`).join("")}
    <rect x="24" y="92" width="64" height="60" fill="#b9c4c0"/><rect x="34" y="104" width="14" height="14" fill="#dde3e1"/><rect x="62" y="104" width="14" height="14" fill="#dde3e1"/><rect x="48" y="128" width="16" height="24" fill="#8a9893"/>
    <path d="M18 94 L56 66 L94 94 Z" fill="#8a9893"/>
    <circle cx="160" cy="70" r="13" fill="#e6b48c"/>
    <path d="M147 66 Q160 52 173 66 Z" fill="#6b4f36"/>
    <rect x="142" y="84" width="16" height="46" rx="6" fill="#6b7b77"/>
    <rect x="146" y="84" width="28" height="50" rx="11" fill="#9fb0ab"/>
    <rect x="148" y="132" width="10" height="38" rx="3" fill="#465753"/><rect x="162" y="132" width="10" height="38" rx="3" fill="#465753"/>
    <rect x="176" y="92" width="58" height="60" rx="3" fill="#ffffff" transform="rotate(6 205 122)"/>
    <text x="206" y="113" text-anchor="middle" font-family="${font}" font-size="12" font-weight="700" fill="#c23b32" transform="rotate(6 205 122)">ÚVER</text>
    ${[122, 130, 138].map((y) => `<rect x="188" y="${y}" width="34" height="3" fill="#b9c4c0" transform="rotate(6 205 122)"/>`).join("")}
    <path d="M172 100 L184 108" stroke="#9fb0ab" stroke-width="7" stroke-linecap="round"/>
    <rect x="0" y="170" width="320" height="30" fill="#465753"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">18 rokov a prvý úver</text>
  </svg>`,
    plan: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs><linearGradient id="kidsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d5eeea"/><stop offset="1" stop-color="#fbf4e4"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#kidsky)"/>
    <circle cx="270" cy="42" r="20" fill="#e3a33b"/>
    ${[[40, 30, "#c23b32"], [80, 52, "#e3a33b"], [120, 24, "#2a78d6"], [210, 30, "#1baf7a"], [236, 76, "#c23b32"], [60, 84, "#1baf7a"]].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="7" height="4" rx="1" fill="${c}" transform="rotate(${i * 35} ${x} ${y})"/>`).join("")}
    <rect x="210" y="98" width="76" height="72" fill="#ffffff"/><path d="M200 100 L248 62 L296 100 Z" fill="#0f6b5c"/>
    <rect x="220" y="112" width="18" height="18" fill="#d5eeea"/><rect x="258" y="112" width="18" height="18" fill="#d5eeea"/><rect x="238" y="140" width="20" height="30" fill="#c96f3b"/>
    <circle cx="140" cy="72" r="13" fill="#e6b48c"/>
    <path d="M124 60 L140 52 L156 60 L140 68 Z" fill="#10231f"/><rect x="134" y="60" width="12" height="6" fill="#10231f"/>
    <line x1="156" y1="60" x2="158" y2="72" stroke="#e3a33b" stroke-width="2"/>
    <rect x="126" y="86" width="28" height="48" rx="11" fill="#0f6b5c"/>
    <rect x="128" y="132" width="10" height="38" rx="3" fill="#10231f"/><rect x="142" y="132" width="10" height="38" rx="3" fill="#10231f"/>
    <path d="M152 96 L172 80" stroke="#0f6b5c" stroke-width="7" stroke-linecap="round"/>
    <circle cx="178" cy="74" r="7" fill="none" stroke="#e3a33b" stroke-width="3.5"/>
    <path d="M183 79 L194 90 M189 85 L185 89 M192 88 L188 92" stroke="#e3a33b" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M128 96 L112 110" stroke="#0f6b5c" stroke-width="7" stroke-linecap="round"/>
    <rect x="0" y="170" width="320" height="30" fill="#efe1c2"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#10231f">18 rokov a vlastný štart</text>
  </svg>`,
  });
  const KID_SCENES = kidSceneSvgs("Roboto");

  // ---------------------------------------------------------------------------
  // Sporenie pre deti: úvod pre klienta (2 strany) + prepočet pre každé dieťa.
  // ---------------------------------------------------------------------------
  function childrenIntro(ctx, m) {
    const P = ctx.brand.primary, SOFT = ctx.brand.primarySoft, INK = ctx.brand.ink;
    const who = m.name || "vaše dieťa";
    const tag = (text, fill) => ({ table: { body: [[{ text, bold: true, fontSize: 8, characterSpacing: 0.6, color: "#ffffff", fillColor: fill, margin: [6, 2, 6, 2] }]] }, layout: "noBorders", margin: [0, 0, 0, 4] });
    const sceneW = (CONTENT_W - 18) / 2;
    const chip = (label, value) => ({
      stack: [{ text: label.toUpperCase(), fontSize: 7, bold: true, color: ctx.brand.muted, characterSpacing: 0.4 }, { text: value, fontSize: 13, bold: true, color: INK, margin: [0, 1, 0, 0] }],
      fillColor: MOT_TINT, margin: [10, 4, 10, 5],
    });
    const chips = (items) => ({
      table: { widths: items.map(() => "*"), body: [items] },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === items.length ? 0 : 8), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      margin: [0, 0, 0, 8],
    });
    const card = (title, sub, amount, note, total, accent, soft) => ({
      table: {
        widths: ["*"],
        body: [
          [{ fillColor: soft, margin: [6, 5, 6, 5], stack: [
            { text: title, bold: true, fontSize: 15, color: accent, alignment: "center" },
            { text: sub, italics: true, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 0] },
          ] }],
          [{ margin: [6, 5, 6, 6], stack: [
            { text: eur(amount), bold: true, fontSize: 17, color: INK, alignment: "center" },
            { text: note, bold: true, fontSize: 8, color: ctx.brand.muted, alignment: "center" },
            { text: "Vložím", fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 3, 0, 0] },
            { text: eur(total), bold: true, fontSize: 11.5, color: INK, alignment: "center" },
          ] }],
        ],
      },
      layout: { hLineWidth: (i) => (i === 1 ? 0 : 1.2), vLineWidth: () => 1.2, hLineColor: () => accent, vLineColor: () => accent },
    });

    const page1 = nn([
      motTop(ctx, "Najlepší štart do života", { text: "Deťom nemôžeme dať všetko.\nAle môžeme im dať náskok." }, true),
      chips([chip("Dieťa", m.name || "Vaše dieťa"), chip("Vek dnes", `${m.age} ${rokov(m.age)}`), chip(`Do ${m.targetAge} rokov`, `${m.years} ${rokov(m.years)}`)]),
      { text: `Raz príde deň, keď sa ${who} postaví na vlastné nohy — štúdium, prvý nájom, prvé auto. Otázka nie je, či ten deň príde. Otázka je, či doň vykročí s úverom, alebo s vlastným kapitálom.`,
        alignment: "center", fontSize: 10.5, color: ctx.brand.inkSecondary, lineHeight: 1.35, margin: [20, 0, 20, 10] },
      {
        columns: [
          { width: sceneW, stack: [tag("BEZ PLÁNU", MOT_DANGER), { svg: KID_SCENES.noPlan, width: sceneW }] },
          { width: sceneW, stack: [tag("S PLÁNOM", P), { svg: KID_SCENES.plan, width: sceneW }] },
        ],
        columnGap: 18,
      },
      { text: [`O ${m.years} ${rokov(m.years)} môže mať ${who} na účte `, { text: eur(m.value), color: P }], alignment: "center", bold: true, fontSize: 16, color: INK, margin: [0, 12, 0, 2] },
      { text: `Stačí ${eur(m.monthly)} mesačne${m.principal > 0 ? ` a jednorazovo ${eur(m.principal)}` : ""} — to je ${eur(m.weekly)} týždenne.`, alignment: "center", fontSize: 9.5, color: ctx.brand.muted },
      {
        columns: [
          { width: "*", stack: [card("Ponožka", "Odkladám bez zhodnotenia", m.sockValue, `v ${m.targetAge} rokoch`, m.invested, MOT_DANGER, MOT_DANGER_SOFT)] },
          { width: 50, text: "ALEBO", bold: true, fontSize: 8.5, characterSpacing: 1, color: ctx.brand.muted, alignment: "center", margin: [0, 50, 0, 0] },
          { width: "*", stack: [card("Investícia", `${m.strategyLabel} stratégia, ${pct(m.pct)} ročne`, m.value, `v ${m.targetAge} rokoch`, m.invested, P, SOFT)] },
        ],
        columnGap: 6,
        margin: [30, 10, 30, 6],
      },
      m.diff > 0.5 ? { text: ["Rovnaké vklady, o ", { text: eur(m.diff), color: P }, " viac.\nRozdiel dopracoval čas, nie vy."], alignment: "center", bold: true, fontSize: 11.5, color: INK, lineHeight: 1.25 } : null,
    ]);

    const max = Math.max(1, ...m.delays.map((d) => d.value));
    const barW = 240;
    const delayRows = m.delays.map((d, i) => [
      { text: d.d === 0 ? "Začneme dnes" : `O ${d.d} ${rokov(d.d)} neskôr`, fontSize: 8.5, bold: true, color: ctx.brand.inkSecondary, margin: [0, 1, 0, 0] },
      { canvas: [{ type: "rect", x: 0, y: 2, w: Math.max(6, (d.value / max) * barW), h: 8, r: 4, color: i === 0 ? P : MOT_DANGER }] },
      { text: eur(d.value), fontSize: 9.5, bold: true, color: INK, alignment: "right" },
    ]);
    const stratCard = (s) => ({
      fillColor: SOFT, margin: [6, 9, 6, 10], stack: [
        { text: s.label, bold: true, fontSize: 13, color: P, alignment: "center" },
        { text: `${pct(s.pct)} ročne`, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 6] },
        centered({ table: { body: [[{ text: eur(s.value), bold: true, fontSize: 12, color: "#ffffff", fillColor: P, margin: [10, 3, 10, 4] }]] }, layout: "noBorders" }, "auto"),
      ],
    });

    const page2 = nn([
      motTop(ctx, "Čas je najväčší vklad", { text: ["Každý rok, ktorý necháte ujsť, musíte neskôr ", { text: "dobehnúť vyššími vkladmi", color: MOT_DANGER, bold: true }, ". Kto začne ", { text: "hneď", color: P, bold: true }, ", nechá pracovať čas."] }),
      centered({
        table: { widths: [100, barW, "*"], body: delayRows },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 4, paddingRight: () => 4 },
        margin: [0, 4, 0, 4],
      }, 400),
      m.perYearDelay > 0.5 ? { text: ["Každý rok čakania stojí ", { text: eur(m.perYearDelay), color: MOT_DANGER }], alignment: "center", bold: true, fontSize: 16, color: INK, margin: [0, 4, 0, 0] } : null,
      { text: `Pri rovnakom vklade ${eur(m.monthly)} mesačne a výnose ${pct(m.pct)} ročne.`, alignment: "center", fontSize: 8.5, color: ctx.brand.muted, margin: [0, 2, 0, 0] },
      m.target > 0 ? { stack: [pill(`Cieľ: ${m.purpose}`, P)], margin: [0, 10, 0, 4] } : null,
      m.target > 0 ? { text: [
        `Na ${eur(m.target)} v dnešných peniazoch do ${m.targetAge} rokov stačí odkladať `,
        { text: ` ${eur(m.need)} `, bold: true, fontSize: 13, color: P, background: SOFT },
        " mesačne",
        m.sockNeed != null && m.sockNeed > (m.need || 0) + 0.5 ? ` — do ponožky by to bolo ${eur(m.sockNeed)}.` : ".",
      ], alignment: "center", bold: true, fontSize: 10, color: INK, lineHeight: 1.3, margin: [24, 0, 24, 0] } : null,
      {
        table: { widths: m.strategies.map(() => "*"), body: [m.strategies.map(stratCard)] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === m.strategies.length ? 0 : 10), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
        margin: [0, 12, 0, 0],
      },
      motDivider(ctx),
      { text: [
        "Dieťa si nezapamätá ", { text: "každú hračku", color: MOT_DANGER, bold: true }, ".\n",
        "Zapamätá si, že ste mysleli na jeho ", { text: "budúcnosť", color: P, bold: true }, ".",
      ], alignment: "center", italics: true, fontSize: 14, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      { text: "Najlepší čas začať bol pri narodení. Druhý najlepší je dnes.", alignment: "center", bold: true, italics: true, fontSize: 13, color: INK, margin: [0, 4, 0, 8] },
      { text: `Výnos je očakávané ročné zhodnotenie po nákladoch, vklad na začiatku mesiaca, mesačné zloženie. Cieľová suma je v dnešných cenách (inflácia ${pct(m.inflation)} ročne). ` +
          "Hodnota investície môže kolísať a minulé výnosy nie sú zárukou budúcich. Ilustratívny prepočet, nie je investičné odporúčanie.",
        alignment: "center", fontSize: 7.5, color: ctx.brand.muted, lineHeight: 1.25 },
    ]);

    return [
      { stack: page1 },
      { stack: page2, pageBreak: "before" },
      { text: "", pageBreak: "after" },
    ];
  }

  function renderChildren(ctx, s) {
    const out = [];
    if (s.motivation) out.push(...childrenIntro(ctx, s.motivation));
    const kids = (s.kids || []).filter((k) => k.monthly > 0 || k.principal > 0);
    if (kids.length > 1) {
      const rows = kids.map((k) => [
        td(k.name || "Dieťa", { bold: true }), tdNum(`${k.age} → ${k.targetAge}`), tdNum(eur(k.monthly)),
        tdNum(eur(k.invested)), tdNum(eur(k.finalValue), { bold: true }),
      ]);
      rows.push([td("Spolu", { bold: true }), tdNum(""), tdNum(eur(sum(kids, (k) => k.monthly)), { bold: true }), tdNum(eur(sum(kids, (k) => k.invested)), { bold: true }), tdNum(eur(sum(kids, (k) => k.finalValue)), { bold: true })]);
      out.push(block("Prehľad sporenia pre deti", [dataTable(ctx, ["*", 60, 70, 80, 90],
        [th("Dieťa"), th("Vek", true), th("Vklad / mes.", true), th("Vložené", true), th("Hodnota", true)], rows, { hasTotal: true })]));
    }
    kids.forEach((k) => {
      const series = [
        { label: "Hodnota účtu", color: SERIES[2], points: (k.yearly || []).map((p) => ({ x: p.age, y: p.value })) },
        { label: "Vložené prostriedky", color: SERIES[0], points: (k.yearly || []).map((p) => ({ x: p.age, y: p.invested })) },
      ];
      const short = k.requiredMonthly != null && k.requiredMonthly > k.monthly + 0.5;
      out.push(block(`${k.name || "Dieťa"} — ${String(k.purpose || "sporenie").toLowerCase()}`, nn([
        tiles(nn([
          tile(ctx, `Hodnota v ${k.targetAge} rokoch`, eur(k.finalValue), `v dnešných cenách ${eur(k.realValue)}`),
          tile(ctx, "Vklady", `${eur(k.monthly)} / mes.`, k.principal > 0 ? `+ jednorazovo ${eur(k.principal)}` : `${k.years} ${rokov(k.years)} sporenia`),
          tile(ctx, "Bez zhodnotenia", eur(k.sockValue), `výnos navyše ${eur(k.finalValue - k.sockValue)}`),
          k.target > 0 ? tile(ctx, short ? "Na cieľ treba" : "Cieľ je splnený", short ? `${eur(k.requiredMonthly)} / mes.` : eur(k.target), `cieľ ${eur(k.target)} v dnešných cenách`) : null,
        ])),
        series[0].points.length >= 2 ? legendRow(series) : null,
        series[0].points.length >= 2 ? lineChartSvg(ctx, series, 150) : null,
        { text: `${s.strategyLabel} stratégia, výnos ${pct(k.returnPct)} ročne po nákladoch; na osi vek dieťaťa, nominálne hodnoty.`, style: "muted", margin: [0, 4, 0, 0] },
      ])));
    });
    return out;
  }

  // Ilustrácie úvodu k hypotéke (rovnaké ako v hypotekárnej kalkulačke, popisy s vekom klienta).
  const houseSceneSvgs = (font, baseAge, planAge) => ({
    bank: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#dde3e1"/>
    <path d="M168 58 L240 30 L312 58 Z" fill="#8a9893"/>
    <rect x="172" y="58" width="136" height="10" fill="#9fb0ab"/>
    ${[182, 208, 234, 260, 286].map((cx) => `<rect x="${cx}" y="72" width="12" height="80" fill="#b9c4c0"/>`).join("")}
    <rect x="168" y="152" width="144" height="12" fill="#8a9893"/>
    <circle cx="240" cy="46" r="8" fill="#dde3e1"/><text x="240" y="50" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#465753">€</text>
    <circle cx="96" cy="70" r="13" fill="#e6b48c"/>
    <path d="M83 66 Q96 54 109 66 Z" fill="#dfe4e1"/>
    <path d="M84 84 Q96 80 110 86 L114 132 L80 132 Z" fill="#6b7b77"/>
    <rect x="84" y="130" width="10" height="38" rx="3" fill="#465753"/><rect x="100" y="130" width="10" height="38" rx="3" fill="#465753"/>
    <path d="M110 96 L130 110" stroke="#6b7b77" stroke-width="7" stroke-linecap="round"/>
    <rect x="128" y="102" width="30" height="20" rx="2" fill="#ffffff"/>
    <path d="M128 102 L143 114 L158 102" fill="none" stroke="#b9c4c0" stroke-width="2"/>
    <line x1="74" y1="100" x2="64" y2="168" stroke="#465753" stroke-width="4" stroke-linecap="round"/>
    <path d="M84 96 L72 102" stroke="#6b7b77" stroke-width="7" stroke-linecap="round"/>
    <rect x="0" y="170" width="320" height="30" fill="#465753"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">posledná splátka v ${baseAge} rokoch</text>
  </svg>`,
    home: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs><linearGradient id="homesky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d5eeea"/><stop offset="1" stop-color="#fbf4e4"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#homesky)"/>
    <circle cx="270" cy="40" r="18" fill="#e3a33b"/>
    ${[[34, 30, "#c23b32"], [70, 56, "#e3a33b"], [112, 22, "#2a78d6"], [200, 26, "#1baf7a"], [176, 44, "#c23b32"], [150, 60, "#1baf7a"]].map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="7" height="4" rx="1" fill="${c}" transform="rotate(${i * 40} ${x} ${y})"/>`).join("")}
    <rect x="28" y="96" width="112" height="74" fill="#ffffff"/><path d="M16 98 L84 50 L152 98 Z" fill="#0f6b5c"/>
    <rect x="42" y="110" width="22" height="20" fill="#d5eeea"/><rect x="104" y="110" width="22" height="20" fill="#d5eeea"/><rect x="72" y="136" width="24" height="34" fill="#c96f3b"/>
    <path d="M60 60 L64 52 L72 60" fill="none" stroke="#e3a33b" stroke-width="0"/>
    <circle cx="206" cy="74" r="13" fill="#e6b48c"/>
    <path d="M193 70 Q206 58 219 70 Z" fill="#6b4f36"/>
    <rect x="192" y="88" width="28" height="48" rx="11" fill="#1baf7a"/>
    <rect x="194" y="134" width="10" height="36" rx="3" fill="#10231f"/><rect x="208" y="134" width="10" height="36" rx="3" fill="#10231f"/>
    <path d="M218 96 L240 78" stroke="#1baf7a" stroke-width="7" stroke-linecap="round"/>
    <rect x="232" y="54" width="62" height="28" rx="4" fill="#ffffff" stroke="#0f6b5c" stroke-width="3" transform="rotate(-8 263 68)"/>
    <text x="263" y="73" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#0f6b5c" transform="rotate(-8 263 68)">SPLATENÉ</text>
    <path d="M194 98 L178 112" stroke="#1baf7a" stroke-width="7" stroke-linecap="round"/>
    <rect x="0" y="170" width="320" height="30" fill="#efe1c2"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#10231f">domov je váš v ${planAge} rokoch</text>
  </svg>`,
  });

  // Úvod pre klienta v kapitole Bývanie a reality (rovnaký obsah ako v hypotekárnej kalkulačke).
  function housingIntro(ctx, m) {
    const P = ctx.brand.primary, SOFT = ctx.brand.primarySoft, INK = ctx.brand.ink, BLUE = SERIES[0], BLUE_SOFT = "#e6f0fb";
    const scenes = houseSceneSvgs("Roboto", m.baseEndAge, m.bestEndAge);
    const dur = (months) => { const y = Math.round((months / 12) * 10) / 10; return Number.isInteger(y) ? `${y} ${rokov(y)}` : `${num1(y)} roka`; };
    const rate = `${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 }).format(m.rate)} %`;
    const extraText = `${eur(m.extra)} mesačne navyše${m.lump > 0 ? ` a ${eur(m.lump)} jednorazovo` : ""}`;
    const tag = (text, fill) => ({ table: { body: [[{ text, bold: true, fontSize: 8, characterSpacing: 0.6, color: "#ffffff", fillColor: fill, margin: [6, 2, 6, 2] }]] }, layout: "noBorders", margin: [0, 0, 0, 4] });
    const sceneW = (CONTENT_W - 18) / 2;
    const chip = (label, value) => ({
      stack: [{ text: label.toUpperCase(), fontSize: 7, bold: true, color: ctx.brand.muted, characterSpacing: 0.4 }, { text: value, fontSize: 13, bold: true, color: INK, margin: [0, 1, 0, 0] }],
      fillColor: MOT_TINT, margin: [10, 4, 10, 5],
    });
    const row3 = (cells, gap) => ({
      table: { widths: cells.map(() => "*"), body: [cells] },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === cells.length ? 0 : gap), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    });
    const max = Math.max(m.totalPaid, 1), barW = 240;
    const barRow = (label, value, color) => [
      { text: label, fontSize: 8.5, bold: true, color: ctx.brand.inkSecondary, margin: [0, 1, 0, 0] },
      { canvas: [{ type: "rect", x: 0, y: 2, w: Math.max(6, (value / max) * barW), h: 8, r: 4, color }] },
      { text: eur(value), fontSize: 9.5, bold: true, color: INK, alignment: "right" },
    ];
    const card = (title, sub, big, small, totalLabel, total, hint, accent, soft) => ({
      table: {
        widths: ["*"],
        body: [
          [{ fillColor: soft, margin: [6, 5, 6, 5], stack: [
            { text: title, bold: true, fontSize: 14, color: accent, alignment: "center" },
            { text: sub, italics: true, fontSize: 8, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 0] },
          ] }],
          [{ margin: [6, 5, 6, 6], stack: [
            { text: big, bold: true, fontSize: 16, color: INK, alignment: "center" },
            { text: small, bold: true, fontSize: 8, color: ctx.brand.muted, alignment: "center" },
            { text: totalLabel, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 3, 0, 0] },
            { text: total, bold: true, fontSize: 11.5, color: INK, alignment: "center" },
            { text: hint, fontSize: 7.5, color: ctx.brand.muted, alignment: "center", margin: [0, 3, 0, 0] },
          ] }],
        ],
      },
      layout: { hLineWidth: (i) => (i === 1 ? 0 : 1.2), vLineWidth: () => 1.2, hLineColor: () => accent, vLineColor: () => accent },
    });
    const endCard = (title, sub, age, color, soft) => ({
      fillColor: soft, margin: [6, 9, 6, 10], stack: [
        { text: title, bold: true, fontSize: 12, color, alignment: "center" },
        { text: sub, fontSize: 8.5, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 6] },
        centered({ table: { body: [[{ text: `${age} r.`, bold: true, fontSize: 12, color: "#ffffff", fillColor: color, margin: [10, 3, 10, 4] }]] }, layout: "noBorders" }, "auto"),
      ],
    });

    const page1 = nn([
      motTop(ctx, `Hypotéka nemusí trvať ${m.years} ${rokov(m.years)}`, { text: "Banka vám požičia na desaťročia.\nNikto vám však nekáže byť jej dlžníkom tak dlho." }, true),
      Object.assign(row3([chip(m.isNew ? "Nový úver" : "Zostatok úveru", eur(m.loan)), chip("Úrok", rate), chip("Splátka", eur(m.payment))], 8), { margin: [0, 0, 0, 8] }),
      { text: `Splátka ${eur(m.payment)} mesačne vyzerá zvládnuteľne. Za ${m.years} ${rokov(m.years)} však banke pošlete ${eur(m.totalPaid)} — z toho ${eur(m.interest)} len za to, že ste si požičali.`,
        alignment: "center", fontSize: 10.5, color: ctx.brand.inkSecondary, lineHeight: 1.35, margin: [20, 0, 20, 6] },
      centered({
        table: { widths: [110, barW, "*"], body: [barRow(m.isNew ? "Požičiate si" : "Dlhujete dnes", m.loan, INK), barRow("Vrátite banke spolu", m.totalPaid, MOT_DANGER), barRow("z toho úroky", m.interest, MOT_DANGER)] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 4, paddingRight: () => 4 },
        margin: [0, 2, 0, 2],
      }, 410),
      { text: ["Svoj domov zaplatíte ", { text: `${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 }).format(m.ratio)}-krát`, color: MOT_DANGER }], alignment: "center", bold: true, fontSize: 16, color: INK, margin: [0, 4, 0, 0] },
      { text: `Z každých 100 € splátky ide v priemere ${eur(m.interestShare * 100)} na úrok, nie na váš domov.`, alignment: "center", fontSize: 9, color: ctx.brand.muted, margin: [0, 2, 0, 10] },
      {
        columns: [
          { width: sceneW, stack: [tag("BEZ PLÁNU", MOT_DANGER), { svg: scenes.bank, width: sceneW }] },
          { width: sceneW, stack: [tag("S PLÁNOM", P), { svg: scenes.home, width: sceneW }] },
        ],
        columnGap: 18,
      },
      m.bestSavedMonths > 0 ? { stack: [pill(`Stačí ${extraText}`, P)], margin: [0, 10, 0, 4] } : null,
      m.bestSavedMonths > 0 ? { text: [
        "a hypotéka bude splatená o ", { text: ` ${dur(m.bestSavedMonths)} `, bold: true, fontSize: 13, color: P, background: SOFT },
        ` skôr — v ${m.bestEndAge} rokoch namiesto ${m.baseEndAge}. Ušetríte `,
        { text: ` ${eur(m.bestSaved)} `, bold: true, fontSize: 13, color: P, background: SOFT }, ".",
      ], alignment: "center", bold: true, fontSize: 10, color: INK, lineHeight: 1.3, margin: [24, 0, 24, 0] } : null,
    ]);

    const page2 = nn([
      motTop(ctx, "Dve cesty k skoršiemu splateniu", { text: ["Mimoriadne splátky sú ", { text: "istota", color: P, bold: true }, ". Investovanie popri hypotéke je ", { text: "šanca s rizikom", color: MOT_DANGER, bold: true }, ". Obe skracujú čas, keď pracujete pre banku."] }),
      {
        columns: [
          { width: "*", stack: [card("Mimoriadne splátky", `${extraText}, raz ročne do banky`, `v ${m.prepay.endAge} rokoch`, `o ${dur(m.prepay.savedMonths)} skôr`, "Ušetríte spolu", eur(m.prepay.saved), `istý výnos = úrok hypotéky ${rate}`, P, SOFT)] },
          { width: 44, text: "ALEBO", bold: true, fontSize: 8.5, characterSpacing: 1, color: ctx.brand.muted, alignment: "center", margin: [0, 56, 0, 0] },
          { width: "*", stack: [card("Investovanie", `${extraText} do fondov, splatenie naraz`, `v ${m.invest.endAge} rokoch`, `o ${dur(m.invest.savedMonths)} skôr`, "Ušetríte spolu", eur(m.invest.saved), `očakávaný výnos ${pct(m.invPct)} ročne, nie je garantovaný`, BLUE, BLUE_SOFT)] },
        ],
        columnGap: 6,
        margin: [20, 4, 20, 12],
      },
      { text: "Kedy budete bez hypotéky?", alignment: "center", bold: true, fontSize: 11, color: INK, margin: [0, 0, 0, 8] },
      row3([
        endCard("Bez zmeny", "posledná splátka", m.baseEndAge, MOT_DANGER, MOT_DANGER_SOFT),
        endCard("Mimoriadne splátky", "úver splatený", m.prepay.endAge, P, SOFT),
        endCard("Investovanie", "úver splatený naraz", m.invest.endAge, BLUE, BLUE_SOFT),
      ], 10),
      motDivider(ctx),
      { text: ["Každé euro, ktoré pošlete banke navyše,\nvám zarobí ", { text: `${rate} ročne`, color: P, bold: true }, " — bez rizika a bez dane."], alignment: "center", italics: true, fontSize: 14, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      { text: "Hypotéka je nástroj, nie doživotný záväzok.", alignment: "center", bold: true, italics: true, fontSize: 13, color: INK, margin: [0, 4, 0, 8] },
      { text: `Mimoriadnu splátku do 20 % istiny raz za 12 mesiacov a pri skončení fixácie (${m.fixYears ? `každých ${m.fixYears} ${rokov(m.fixYears)}` : "podľa zmluvy"}) môžete splatiť bez poplatku, inak najviac 1 % zo splatenej sumy. ` +
          "Po mimoriadnej splátke zostáva splátka rovnaká a skracuje sa doba splácania. Pri investovaní sa hypotéka splatí naraz, keď hodnota investície dosiahne zostatok istiny; výnos nie je zaručený. " +
          "Úroková sadzba je počas celej doby rovnaká. Ilustratívny prepočet, nie je ponukou úveru ani investičným odporúčaním.",
        alignment: "center", fontSize: 7.5, color: ctx.brand.muted, lineHeight: 1.25 },
    ]);

    return [
      { stack: page1 },
      { stack: page2, pageBreak: "before" },
      { text: "", pageBreak: "after" },
    ];
  }

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
      ...(r.motivation ? retirementIntro(ctx, r.motivation) : []),
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
      r.motivation && r.motivation.pension ? block("Ako sme počítali", [{ ul: nn([
        pensionExplain(r.motivation.pension) + " Osobný mzdový bod je obmedzený na 3; roky poistenia = odpracované + zostávajúce do dôchodku.",
        r.sources.pillar2 ? "2. pilier: zostatok a príspevky z hrubej mzdy sa zhodnocujú do dôchodku a potom sa vyplácajú ako mesačná renta; za roky v 2. pilieri sa štátny dôchodok primerane kráti." : null,
        r.sources.pillar3 ? "3. pilier: zostatok a príspevky klienta aj zamestnávateľa sa zhodnocujú do dôchodku a potom sa vyplácajú ako renta." : null,
        r.sources.investments ? "Vlastné investície: súčasné úspory a pravidelný vklad (každý rok navýšený) sa zhodnocujú pri očakávanom výnose po nákladoch; nasporený kapitál sa vypláca ako renta" +
          (r.payoutEndAge ? ` do ${r.payoutEndAge} rokov.` : ".") : null,
        "Všetky sumy sú očistené o infláciu (v dnešných cenách); renta sa každý rok zvyšuje o infláciu.",
      ]), style: "small" }]) : null,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Income scaling
  // ---------------------------------------------------------------------------
  // Ilustrácie úvodu k tipérskemu programu (rovnaké ako v kalkulačke navýšenia príjmu).
  const tipSceneSvgs = (font) => ({
    free: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#dde3e1"/>
    <rect x="22" y="34" width="150" height="40" rx="10" fill="#ffffff"/><path d="M66 74 L74 84 L80 74 Z" fill="#ffffff"/>
    <text x="97" y="51" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#465753">Nepoznáš niekoho</text>
    <text x="97" y="66" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#465753">na hypotéku?</text>
    <rect x="176" y="44" width="130" height="40" rx="10" fill="#ffffff"/><path d="M252 84 L246 92 L240 84 Z" fill="#ffffff"/>
    <text x="241" y="61" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#465753">Jasné, zavolaj</text>
    <text x="241" y="76" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="#465753">môjmu poradcovi.</text>
    <circle cx="84" cy="96" r="13" fill="#e6b48c"/><path d="M71 92 Q84 80 97 92 Z" fill="#6b4f36"/>
    <rect x="70" y="110" width="28" height="42" rx="11" fill="#9fb0ab"/>
    <rect x="72" y="150" width="10" height="20" rx="3" fill="#465753"/><rect x="86" y="150" width="10" height="20" rx="3" fill="#465753"/>
    <circle cx="236" cy="104" r="13" fill="#e6b48c"/><path d="M223 100 Q236 88 249 100 Z" fill="#10231f"/>
    <rect x="222" y="118" width="28" height="36" rx="11" fill="#6b7b77"/>
    <rect x="224" y="152" width="10" height="18" rx="3" fill="#465753"/><rect x="238" y="152" width="10" height="18" rx="3" fill="#465753"/>
    <rect x="0" y="170" width="320" height="30" fill="#465753"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#ffffff">odporúčanie zadarmo</text>
  </svg>`,
    paid: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <defs><linearGradient id="tipsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d5eeea"/><stop offset="1" stop-color="#fbf4e4"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#tipsky)"/>
    <circle cx="120" cy="74" r="13" fill="#e6b48c"/><path d="M107 70 Q120 58 133 70 Z" fill="#6b4f36"/>
    <rect x="106" y="88" width="28" height="48" rx="11" fill="#0f6b5c"/>
    <rect x="108" y="134" width="10" height="36" rx="3" fill="#10231f"/><rect x="122" y="134" width="10" height="36" rx="3" fill="#10231f"/>
    <path d="M132 98 L148 86" stroke="#0f6b5c" stroke-width="7" stroke-linecap="round"/>
    <rect x="144" y="66" width="20" height="32" rx="4" fill="#10231f"/><rect x="147" y="70" width="14" height="22" rx="2" fill="#bfe3d6"/>
    <rect x="172" y="28" width="120" height="30" rx="10" fill="#ffffff" stroke="#0f6b5c" stroke-width="2"/>
    <text x="232" y="48" text-anchor="middle" font-family="${font}" font-size="12" font-weight="700" fill="#0f6b5c">Tip odoslaný ✓</text>
    ${[0, 1, 2, 3].map((i) => `<ellipse cx="236" cy="${156 - i * 9}" rx="22" ry="7" fill="#e3a33b" stroke="#c98a22" stroke-width="2"/>`).join("")}
    <ellipse cx="236" cy="${156 - 4 * 9}" rx="22" ry="7" fill="#f0c064" stroke="#c98a22" stroke-width="2"/>
    <text x="236" y="${156 - 4 * 9 + 4}" text-anchor="middle" font-family="${font}" font-size="10" font-weight="700" fill="#8a5a12">€</text>
    <rect x="264" y="126" width="34" height="30" rx="3" fill="#c23b32"/><rect x="278" y="126" width="6" height="30" fill="#f0c064"/>
    <rect x="260" y="118" width="42" height="10" rx="2" fill="#d85a50"/><rect x="278" y="118" width="6" height="10" fill="#f0c064"/>
    <rect x="0" y="170" width="320" height="30" fill="#efe1c2"/>
    <text x="160" y="190" text-anchor="middle" font-family="${font}" font-size="14" font-weight="700" fill="#10231f">odporúčam a dostávam odmenu</text>
  </svg>`,
  });
  const TIP_SCENES = tipSceneSvgs("Roboto");

  function renderIncomeScaling(ctx, s) {
    const out = [];
    const ref = s.referral;
    if (ref && ref.motivation) out.push(...incomeIntro(ctx, ref.motivation));
    if (ref) out.push(...referralBlocks(ctx, ref));
    if (!hasItems(s.steps)) return out;
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
    return out.concat(nn([
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
    ]));
  }

  // Tipérsky program: tabuľka odmien a reinvestovanie (z kalkulačky navýšenia príjmu).
  function referralBlocks(ctx, r) {
    const rows = (r.rows || []).map((x) => [
      td(x.label, { bold: true }), tdNum(eur(x.basis)), tdNum(`${new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 }).format(x.rate)} %`),
      tdNum(eur(x.reward)), tdNum(String(x.count)), tdNum(eur(x.total), { bold: true }),
    ]);
    if (r.tier && r.tier.bonus > 0) rows.push([td(`Bonus za úroveň ${r.tier.label} (+${r.tier.bonus} %)`), tdNum(""), tdNum(""), tdNum(""), tdNum(""), tdNum(eur(r.yearly - r.base), { bold: true })]);
    rows.push([td("Spolu ročne", { bold: true }), tdNum(""), tdNum(""), tdNum(""), tdNum(String(r.tips), { bold: true }), tdNum(eur(r.yearly), { bold: true })]);
    const series = [
      { label: "Hodnota investície", color: SERIES[2], points: (r.series || []).map((p) => ({ x: p.year, y: p.value })) },
      { label: "Vložené odmeny", color: SERIES[0], points: (r.series || []).map((p) => ({ x: p.year, y: p.invested })) },
    ];
    return [
      block("Tipérsky program", [
        tiles([
          tile(ctx, "Odmena ročne", eur(r.yearly), `${r.tips} ${r.tips === 1 ? "tip" : r.tips < 5 ? "tipy" : "tipov"} · úroveň ${r.tier.label}`),
          tile(ctx, "Mesačne", eur(r.monthly), isNum(r.raisePct) ? `+${pct(r.raisePct)} k čistému príjmu` : " "),
          tile(ctx, `Reinvestované o ${r.years} r.`, eur(r.fv), `vložené ${eur(r.invested)}, výnos ${pct(r.invPct)} ročne`),
        ]),
        { text: "Odmena za úspešný tip = základ × sadzba, vypláca sa po uzavretí zmluvy. Sadzby sú orientačné, podmienky určuje dohoda o spolupráci.", style: "muted", margin: [0, 8, 0, 4] },
        dataTable(ctx, ["*", 64, 44, 64, 34, 64],
          [th("Produkt"), th("Základ", true), th("Sadzba", true), th("Odmena / tip", true), th("Tipov", true), th("Spolu", true)], rows, { hasTotal: true }),
      ]),
      series[0].points.length >= 2 ? block("Čo z odmien vyrastie", [
        legendRow(series),
        lineChartSvg(ctx, series, 140),
        { text: "Ročná odmena investovaná mesačne (÷ 12) s mesačným zložením výnosu; výnos nie je zaručený. Na osi roky.", style: "muted", margin: [0, 4, 0, 0] },
      ]) : null,
    ].filter(Boolean);
  }

  // Úvod pre klienta v kapitole Navýšenie príjmu (rovnaký obsah ako v kalkulačke).
  function incomeIntro(ctx, m) {
    const P = ctx.brand.primary, SOFT = ctx.brand.primarySoft, INK = ctx.brand.ink;
    const tipov = (n) => (n === 1 ? "tip" : n >= 2 && n <= 4 ? "tipy" : "tipov");
    const n2 = (x) => new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 2 }).format(x);
    const tag = (text, fill) => ({ table: { body: [[{ text, bold: true, fontSize: 8, characterSpacing: 0.6, color: "#ffffff", fillColor: fill, margin: [6, 2, 6, 2] }]] }, layout: "noBorders", margin: [0, 0, 0, 4] });
    const sceneW = (CONTENT_W - 18) / 2;
    const row = (cells, gap) => ({
      table: { widths: cells.map(() => "*"), body: [cells] },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 || i === cells.length ? 0 : gap), vLineColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    });
    const chip = (label, value) => ({
      stack: [{ text: label.toUpperCase(), fontSize: 7, bold: true, color: ctx.brand.muted, characterSpacing: 0.4 }, { text: value, fontSize: 13, bold: true, color: INK, margin: [0, 1, 0, 0] }],
      fillColor: MOT_TINT, margin: [10, 4, 10, 5],
    });
    const card = (title, sub, val, fill, color, strong) => ({
      fillColor: fill, margin: [6, 9, 6, 10], stack: [
        { text: title, bold: true, fontSize: 12, color, alignment: "center" },
        { text: sub, fontSize: 8, color: ctx.brand.inkSecondary, alignment: "center", margin: [0, 2, 0, 6] },
        centered({ table: { body: [[{ text: val, bold: true, fontSize: 12, color: "#ffffff", fillColor: strong, margin: [10, 3, 10, 4] }]] }, layout: "noBorders" }, "auto"),
      ],
    });
    const range = (t) => (t.to == null ? `${t.from}+ ${tipov(t.from)} ročne` : t.from === t.to ? `${t.from} ${tipov(t.from)} ročne` : `${t.from}–${t.to} ${tipov(t.to)} ročne`);

    const page1 = nn([
      motTop(ctx, "Vaše kontakty majú hodnotu", { text: "Nemusíte nič predávať.\nStačí povedať: „Poznám niekoho, kto vám pomôže.“" }, true),
      Object.assign(row([chip("Tipov ročne", String(m.tips)), chip("Odmena ročne", eur(m.yearly)), chip("Mesačne", eur(m.monthly))], 8), { margin: [0, 0, 0, 8] }),
      { text: "Každý rok sa niekto vo vašom okolí sťahuje, berie hypotéku, predáva byt, čaká dieťa alebo zistí, že nemá poistenie. Tieto rozhovory sa dejú aj bez vás. Rozdiel je len v tom, či z nich budete mať odmenu.",
        alignment: "center", fontSize: 10.5, color: ctx.brand.inkSecondary, lineHeight: 1.35, margin: [20, 0, 20, 10] },
      {
        columns: [
          { width: sceneW, stack: [tag("DNES", MOT_DANGER), { svg: TIP_SCENES.free, width: sceneW }] },
          { width: sceneW, stack: [tag("AKO TIPÉR", P), { svg: TIP_SCENES.paid, width: sceneW }] },
        ],
        columnGap: 18,
      },
      { text: ["Ročne môžete získať navyše ", { text: eur(m.yearly), color: P }], alignment: "center", bold: true, fontSize: 16, color: INK, margin: [0, 12, 0, 2] },
      isNum(m.raisePct) && m.raisePct > 0.5 ? { text: `To je ako mať o ${eur(m.monthly)} vyšší plat — o ${Math.round(m.raisePct)} % viac, než dnes zarábate.`, alignment: "center", fontSize: 9.5, color: ctx.brand.muted } : null,
      { stack: [pill("Koľko dostanete za jeden tip", P)], margin: [0, 10, 0, 6] },
      row((m.top || []).map((t) => card(t.label, `${n2(t.rate)} % · ${t.basisLabel.toLowerCase()} ${eur(t.basis)}`, eur(t.reward), SOFT, P, P)), 10),
    ]);

    const page2 = nn([
      motTop(ctx, "Pravidelnosť sa vypláca", { text: ["Čím ", { text: "častejšie", color: P, bold: true }, " tipujete, tým vyššiu odmenu dostanete za ", { text: "každý", color: P, bold: true }, " tip."] }),
      row((m.tiers || []).map((t) => card(`${t.label}${t.current ? " ✓" : ""}`, range(t), t.bonus > 0 ? `+${Math.round(t.bonus)} %` : "základ", t.current ? SOFT : MOT_TINT, P, t.current ? P : "#9fb0ab")), 10),
      m.nextTier && m.nextGain > 0.5 ? box({ text: [`Ste na úrovni `, { text: m.tier.label, bold: true }, `. Pri ${m.nextTier.from} ${tipov(m.nextTier.from)} ročne sa dostanete na úroveň `, { text: m.nextTier.label, bold: true }, ` a za rovnaké tipy získate o `, { text: eur(m.nextGain), bold: true }, " viac."], fontSize: 9, color: INK, lineHeight: 1.25 }, SOFT, ctx.brand.hairline, [0, 10, 0, 0]) : null,
      { stack: [pill("Čo z odmien vyrastie", P)], margin: [0, 12, 0, 4] },
      { text: [`Keď odmeny ${eur(m.yearly)} ročne pošlete do investície, o ${m.years} ${rokov(m.years)} budete mať `, { text: ` ${eur(m.fv)} `, bold: true, fontSize: 13, color: P, background: SOFT }, "."],
        alignment: "center", bold: true, fontSize: 10, color: INK, lineHeight: 1.3, margin: [24, 0, 24, 0] },
      { text: `Z vložených ${eur(m.invested)} pri výnose ${pct(m.invPct)} ročne. Tipy tak môžu zaplatiť sporenie pre deti, mimoriadne splátky hypotéky alebo dôchodok.`, alignment: "center", fontSize: 9, color: ctx.brand.muted, margin: [20, 3, 20, 0] },
      motDivider(ctx),
      { text: ["Ľudia neodporúčajú ", { text: "produkty", color: MOT_DANGER, bold: true }, ".\nOdporúčajú ", { text: "ľudí, ktorým veria", color: P, bold: true }, "."], alignment: "center", italics: true, fontSize: 14, color: INK, lineHeight: 1.3 },
      motDivider(ctx),
      { text: `${m.tips} ${tipov(m.tips)} ročne = ${eur(m.monthly)} navyše každý mesiac.`, alignment: "center", bold: true, italics: true, fontSize: 13, color: INK, margin: [0, 4, 0, 8] },
      { text: "Tipér len odovzdá kontakt na človeka, ktorý s tým súhlasí; nič neradí ani nepredáva. Odmena sa vypláca po uzavretí zmluvy (pri poistení po zaplatení poistného). " +
          "Sadzby a základy sú orientačné a konkrétne podmienky určuje dohoda o spolupráci. Odmena je zdaniteľný príjem — príležitostné príjmy do 500 € ročne sú od dane oslobodené, nad túto sumu sa zdaňujú. Výnos investície nie je zaručený.",
        alignment: "center", fontSize: 7.5, color: ctx.brand.muted, lineHeight: 1.25 },
    ]);

    return [
      { stack: page1 },
      { stack: page2, pageBreak: "before" },
      { text: "", pageBreak: "after" },
    ];
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
      // Renta a Zabezpečenie s úvodom pre klienta začínajú vždy na novej strane (úvod zaberá celú stranu).
      const hasIntro = s.key === "housing" ? !!(data.housing && data.housing.mortgage && data.housing.mortgage.motivation)
        : s.key === "incomeScaling" ? !!(data.incomeScaling && data.incomeScaling.referral && data.incomeScaling.referral.motivation)
        : ["retirement", "security", "children"].includes(s.key) && data[s.key] && data[s.key].motivation;
      const mode = hasIntro && breaks !== "never" ? "always" : breaks;
      content.push(...h1(ctx, num++, L.modules[s.key], null, mode));
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
