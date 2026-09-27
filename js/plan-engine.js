// @ts-check
// Výpočtové jadro finančného plánu: z profilu klienta a uložených výsledkov
// kalkulačiek poskladá jeden objekt pre súhrn a PDF (types/financial-plan.d.ts)
// a prepočíta vzájomné závislosti medzi oblasťami:
//   • cashflow dnes vs. po realizácii plánu (nová investícia, dorovnanie dôchodku, nové poistné),
//   • finančná rezerva podľa nevyhnutných výdavkov a splátok úverov,
//   • poistné sumy zohľadňujúce úvery z profilu (smrť, invalidita s klesajúcou sumou),
//   • dôchodková medzera, ktorú môže pokryť nová investícia,
//   • akčný plán zoradený podľa priority.
/** @typedef {import('../types/financial-plan').FinancialPlanReport} FinancialPlanReport */

(function (global) {
  "use strict";

  const PS = () => global.PlanStore;
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const round = (v) => Math.round(num(v));
  const eur = (v) => new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/ /g, " ") + " €";
  const CURRENT_YEAR = new Date().getFullYear();

  const UNIT = { "€": "lump_sum", "€ / mes.": "monthly", "€ / deň": "daily" };
  const GOAL_ORDER = ["housing", "retirement", "investments", "children", "security", "incomeScaling"];
  const GOAL_TITLES = { housing: "Bývanie a reality", retirement: "Renta", investments: "Sporenie a investície", children: "Sporenie pre deti", security: "Zabezpečenie", incomeScaling: "Navýšenie príjmu" };
  const HAS_CALCULATOR = { housing: true, retirement: true, investments: true, security: true, children: true };
  const LOAN_KIND = { mortgage: "Hypotéka", consumer: "Spotrebný úver", car: "Úver na auto / leasing", other: "Úver" };

  // Počet dní do najbližšieho výročia zmluvy (podľa dátumu začiatku) od dátumu plánu.
  function daysToAnniversary(startIso, atIso) {
    const st = /^(\d{4})-(\d{2})-(\d{2})/.exec(startIso || ""), at = /^(\d{4})-(\d{2})-(\d{2})/.exec(atIso || "");
    if (!st || !at) return null;
    const now = Date.UTC(+at[1], +at[2] - 1, +at[3]);
    let next = Date.UTC(+at[1], +st[2] - 1, +st[3]);
    if (next < now) next = Date.UTC(+at[1] + 1, +st[2] - 1, +st[3]);
    return Math.round((next - now) / 86400000);
  }
  const fmtDayMonth = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${+m[2]}. ${+m[1]}.` : ""; };

  function cashflow(netIncome, living, debt, premiums, investing) {
    return {
      netIncome: round(netIncome), livingExpenses: round(living), debtPayments: round(debt),
      insurancePremiums: round(premiums), investmentContributions: round(investing),
      free: round(netIncome - living - debt - premiums - investing),
    };
  }

  /**
   * @param {any} s  stav z PlanStore.load()
   * @returns {{ report: FinancialPlanReport, status: Record<string, boolean>, warnings: string[] }}
   */
  function buildReport(s) {
    const store = PS();
    const f = s.finances;
    const warnings = [];
    // Do plánu idú len ciele, ktoré klient chce riešiť (pridané v časti Ciele).
    const selected = (k) => store.isGoalSelected(s, k);
    const raw = (k) => (s.modules[k] && s.modules[k].summary) || null;
    const pick = (k) => (selected(k) ? raw(k) : null);
    const inv = pick("investments");
    const ret = pick("retirement");
    const sec = pick("security");
    const kids = pick("children"); // len pri deťoch v domácnosti (isGoalSelected)
    const house = pick("housing");
    const retAll = raw("retirement"); // dôchodkové účty patria do majetku aj bez cieľa Renta

    // ---------------------------------------------------------------- Cashflow
    const netIncome = store.householdNet(s);
    const loans = store.activeLoans(s);
    const debtPayments = store.loanPayments(s);
    const loansTotal = store.loansTotal(s);
    // Poistné: životné (zo zmlúv alebo z profilu) + ostatné zmluvy (majetok, vozidlá…).
    const lifePrem = store.lifePremiums(s);
    const otherPrem = store.otherPremiums(s);
    const today = cashflow(netIncome, num(f.livingExpenses), debtPayments, lifePrem + otherPrem, num(f.currentInvesting));

    const newInvestment = inv ? num(inv.monthly) : 0;
    // Chýbajúci mesačný vklad na dôchodok nad rámec súčasného investovania.
    // Medzera z rovnakých zaokrúhlených súm, aké ukazuje PDF.
    const retGap = ret ? round(ret.target) - (round(ret.statePension) + round(ret.p2Renta) + round(ret.p3Renta) + round(ret.renta)) : 0;
    const retirementExtraFull = ret && retGap > 0 && ret.requiredMonthly != null
      ? Math.max(0, ret.requiredMonthly - num(ret.monthly)) : 0;
    const coveredByNewInvestment = s.links.investmentForRetirement ? Math.min(retirementExtraFull, newInvestment) : 0;
    const retirementExtra = retirementExtraFull - coveredByNewInvestment;
    const proposedPremium = sec && num(sec.premium) > 0 ? num(sec.premium) : null;
    const kidsMonthly = kids ? (kids.kids || []).reduce((t, k) => t + num(k.monthly), 0) : 0;
    // Hypotéka: splátka novej hypotéky a suma navyše (mimoriadne splátky = splátky úverov, investovanie = investície).
    const houseNewPayment = house && house.mode === "new" ? num(house.payment) : 0;
    const houseExtra = house ? num(house.extra) : 0;
    const housePrepay = house && house.planChoice !== "invest" ? houseExtra : 0;
    const houseInvest = house && house.planChoice === "invest" ? houseExtra : 0;

    const changed = newInvestment > 0 || retirementExtra > 0 || proposedPremium != null || kidsMonthly > 0 || houseNewPayment > 0 || houseExtra > 0;
    const after = changed
      ? cashflow(netIncome, num(f.livingExpenses), debtPayments + houseNewPayment + housePrepay,
          // Návrh z kalkulačky nahrádza súčasné životné poistenie; ostatné zmluvy ostávajú.
          (proposedPremium != null ? proposedPremium : lifePrem) + otherPrem,
          num(f.currentInvesting) + newInvestment + retirementExtra + kidsMonthly + houseInvest)
      : undefined;

    // ---------------------------------------------------------------- Majetok
    const retAssets = retAll
      ? (retAll.investEnabled ? num(retAll.savings) : 0) + (retAll.p2Enabled ? num(retAll.p2Balance) : 0) + (retAll.p3Enabled ? num(retAll.p3Balance) : 0)
      : 0;
    const assets = num(f.liquidSavings) + num(f.otherAssets) + retAssets;

    // ---------------------------------------------------------------- Rezerva
    const essential = (num(f.essentialExpenses) || num(f.livingExpenses)) + debtPayments;
    const reserveMonths = num(f.reserveMonths) || 6;
    const emergencyFund = essential > 0 && selected("security")
      ? { current: round(f.liquidSavings), target: round(essential * reserveMonths), targetMonths: reserveMonths, monthlyEssentialExpenses: round(essential) }
      : undefined;

    // ---------------------------------------------------------------- Poistenie
    // Súčasné krytie berieme z existujúcich zmlúv (ak sú zadané), inak z kalkulačky.
    const cover = store.contractCover(s);
    const withCover = (list, who) => (list ? list.map((r) => ({ ...r, current: cover[who + "Count"] ? num(cover[who][r.key]) : num(r.current) })) : null);
    const adultRiders = sec ? withCover(sec.adult, "adult") : null;
    const childRiders = sec ? withCover(sec.child, "child") : null;

    const people = [];
    if (adultRiders) {
      people.push({
        name: s.client.firstName || "Klient",
        role: f.breadwinner ? "živiteľ rodiny" : undefined,
        coverages: adultRiders.map((r) => ({
          riderKey: r.key, label: r.label, unit: UNIT[r.unit] || "lump_sum",
          current: round(r.current), recommended: round(r.value),
          reason: loansTotal > 0 && (r.key === "death" || r.key === "invDecr") ? `zohľadňuje úvery ${eur(loansTotal)}` : undefined,
        })),
      });
    }
    if (childRiders) {
      const child = (s.household.children || [])[0];
      people.push({
        name: (child && child.firstName) || "Dieťa", role: "dieťa",
        coverages: childRiders.map((r) => ({ riderKey: r.key, label: r.label, unit: UNIT[r.unit] || "lump_sum", current: round(r.current), recommended: round(r.value) })),
      });
    }

    // ---------------------------------------------------------------- Investície
    const accounts = [];
    if (inv) {
      accounts.push({
        name: inv.offerName || "Navrhovaná investícia", productType: "new_offer",
        value: round(inv.principal), monthlyContribution: round(inv.monthly),
        expectedReturnPct: inv.returnPct, annualFeePct: inv.costPct,
      });
    }
    if (ret && ret.investEnabled && (ret.savings > 0 || ret.monthly > 0)) {
      accounts.push({ name: "Investície na dôchodok", productType: "retirement_savings", value: round(ret.savings), monthlyContribution: round(ret.monthly), expectedReturnPct: ret.returnAcc, annualFeePct: ret.costs });
    }
    if (ret && ret.p2Enabled) {
      accounts.push({ name: "Starobné dôchodkové sporenie", productType: "dss_pillar2", value: round(ret.p2Balance), monthlyContribution: round(ret.p2Monthly), expectedReturnPct: ret.p2Return });
    }
    if (ret && ret.p3Enabled) {
      accounts.push({ name: "Doplnkové dôchodkové sporenie", productType: "dds_pillar3", value: round(ret.p3Balance), monthlyContribution: round(ret.p3Client), employerContribution: round(ret.p3Employer), expectedReturnPct: ret.p3Return });
    }
    const projection = inv && Array.isArray(inv.yearly)
      ? inv.yearly.map((p) => ({ year: CURRENT_YEAR + p.year, contributed: round(p.invested), value: round(p.value) }))
      : undefined;

    // ---------------------------------------------------------------- Akčný plán
    const actions = [];
    if (after && after.free < 0) {
      actions.push({ priority: "high", module: "general", title: "Upraviť plán podľa rozpočtu",
        detail: `Po realizácii všetkých krokov by výdavky prevýšili príjem o ${eur(-after.free)} mesačne. Treba znížiť vklady alebo výdavky.` });
    }
    if (emergencyFund && emergencyFund.current < emergencyFund.target) {
      const missing = emergencyFund.target - emergencyFund.current;
      actions.push({ priority: emergencyFund.current < emergencyFund.target / 2 ? "high" : "medium", module: "security",
        title: `Doplniť finančnú rezervu na ${eur(emergencyFund.target)}`,
        detail: `Chýba ${eur(missing)} (${reserveMonths} mesiacov nevyhnutných výdavkov a splátok). Pri odkladaní ${eur(Math.ceil(missing / 12))} mesačne bude rezerva doplnená do roka.` });
    }
    if (adultRiders) {
      const gaps = adultRiders.filter((r) => UNIT[r.unit] === "lump_sum" && r.value > r.current).sort((a, b) => (b.value - b.current) - (a.value - a.current));
      if (gaps.length) {
        const top = gaps.slice(0, 3).map((r) => `${r.label.toLowerCase()} ${eur(r.value)}`).join(", ");
        actions.push({ priority: gaps.some((r) => r.key === "death" || r.key === "invDecr") && loansTotal > 0 ? "high" : "medium", module: "security",
          title: "Nastaviť životné poistenie na odporúčané sumy",
          detail: `Hlavné krytia: ${top}.` + (loansTotal > 0 ? ` Sumy zohľadňujú úvery ${eur(loansTotal)}.` : ""),
          monthlyImpact: proposedPremium != null ? -round(proposedPremium - lifePrem) : undefined });
      }
      if (proposedPremium != null && sec.budgetHi > 0 && proposedPremium > sec.budgetHi) {
        actions.push({ priority: "medium", module: "security", title: "Poistné je nad odporúčaným rozpočtom",
          detail: `Navrhované poistné ${eur(proposedPremium)} presahuje 10 % čistého príjmu (${eur(sec.budgetHi)}). Zvážte menej dôležité pripoistenia.` });
      }
    }
    if (ret && retirementExtraFull > 0) {
      actions.push({ priority: "medium", module: "retirement",
        title: retirementExtra > 0 ? `Navýšiť investovanie na dôchodok o ${eur(retirementExtra)} mesačne` : "Nová investícia pokryje chýbajúci dôchodok",
        detail: `K cieľovému dôchodku ${eur(ret.target)} chýba ${eur(retGap)} mesačne (v dnešných cenách). ` +
          `Na dorovnanie treba investovať navyše ${eur(retirementExtraFull)} mesačne` +
          (coveredByNewInvestment > 0 && retirementExtra <= 0.5 ? ` — pokryje to nová investícia (${eur(newInvestment)} mesačne).`
            : coveredByNewInvestment > 0 ? `; nová investícia pokryje ${eur(coveredByNewInvestment)}, zvyšok ${eur(retirementExtra)} treba doplniť.`
            : "."),
        monthlyImpact: retirementExtra > 0 ? -round(retirementExtra) : undefined });
    }
    if (inv && (inv.principal > 0 || inv.monthly > 0)) {
      actions.push({ priority: "medium", module: "investments",
        title: `Založiť investíciu${inv.offerName ? ` „${inv.offerName}“` : ""}`,
        detail: `${inv.principal > 0 ? `${eur(inv.principal)} jednorazovo, ` : ""}${eur(inv.monthly)} mesačne na ${inv.years} rokov; odhadovaná hodnota ${eur(inv.finalValue)}.`,
        monthlyImpact: inv.monthly > 0 ? -round(inv.monthly) : undefined });
      if (inv.costPct >= 1.5) {
        actions.push({ priority: "low", module: "investments", title: "Preveriť náklady investície",
          detail: `Priebežné náklady ${String(inv.costPct).replace(".", ",")} % ročne znížia výnos o ${eur(inv.costs)} za celú dobu.` });
      }
    }
    if (house) {
      const dur = (months) => { const y = Math.round((months / 12) * 10) / 10; return Number.isInteger(y) ? `${y} ${y === 1 ? "rok" : y < 5 ? "roky" : "rokov"}` : `${String(y).replace(".", ",")} roka`; };
      if (house.mode === "new") {
        actions.push({ priority: house.nbs && !house.nbs.ok ? "high" : "medium", module: "housing",
          title: house.nbs && !house.nbs.ok ? "Hypotéka je nad odhadovaným limitom NBS" : `Financovať kúpu hypotékou ${eur(house.loan)}`,
          detail: `Splátka ${eur(house.payment)} mesačne na ${house.years} rokov pri ${String(house.rate).replace(".", ",")} %` +
            (house.ltv != null ? `, LTV ${Math.round(house.ltv)} %` : "") +
            (house.nbs ? `; odhadovaný maximálny úver ${eur(house.nbs.maxLoan)}.` : "."),
          monthlyImpact: -round(house.payment) });
      }
      const sc = house.planChoice === "invest" ? house.invest : house.prepay;
      if ((houseExtra > 0 || num(house.lump) > 0) && sc && sc.savedMonths > 0) {
        const how = `${houseExtra > 0 ? `${eur(houseExtra)} mesačne` : ""}${houseExtra > 0 && num(house.lump) > 0 ? " a " : ""}${num(house.lump) > 0 ? `${eur(house.lump)} jednorazovo` : ""}`;
        actions.push({ priority: "medium", module: "housing",
          title: house.planChoice === "invest" ? `Investovať ${how} na splatenie hypotéky` : `Mimoriadne splátky hypotéky: ${how}`,
          detail: (house.planChoice === "invest"
            ? `Keď investícia dosiahne zostatok úveru, hypotéka sa splatí naraz — v ${sc.endAge} rokoch, o ${dur(sc.savedMonths)} skôr. Výnos ${String(house.invPct).replace(".", ",")} % ročne nie je zaručený.`
            : `Odkladať a raz ročne poslať do banky; hypotéka bude splatená v ${sc.endAge} rokoch, o ${dur(sc.savedMonths)} skôr. Bez poplatku do 20 % istiny ročne a pri konci fixácie.`) +
            ` Ušetrí spolu ${eur(sc.saved)} oproti splácaniu bez zmeny.`,
          monthlyImpact: houseExtra > 0 ? -round(houseExtra) : undefined });
      }
    }
    if (kids) {
      (kids.kids || []).filter((k) => num(k.monthly) > 0 || num(k.principal) > 0).forEach((k) => {
        const short = k.requiredMonthly != null && k.requiredMonthly > num(k.monthly) + 0.5;
        actions.push({ priority: short ? "medium" : "low", module: "children",
          title: k.name ? `Založiť sporenie pre deti — ${k.name}` : "Založiť sporenie pre dieťa",
          detail: `${num(k.principal) > 0 ? `${eur(k.principal)} jednorazovo, ` : ""}${eur(k.monthly)} mesačne do ${k.targetAge} rokov (${kids.strategyLabel.toLowerCase()} stratégia); odhadovaná hodnota ${eur(k.finalValue)}.` +
            (short ? ` Na cieľ ${eur(k.target)} (${String(k.purpose).toLowerCase()}) treba ${eur(k.requiredMonthly)} mesačne.` : ""),
          monthlyImpact: num(k.monthly) > 0 ? -round(k.monthly) : undefined });
      });
    }
    // Existujúce zmluvy: chýbajúce poistenie k hypotéke a blížiace sa výročia.
    const contracts = store.activeContracts(s);
    if (selected("security")) {
      const hasMortgage = loans.some((l) => l.kind === "mortgage");
      const hasPropertyCover = contracts.some((c) => ["property_building", "property_combined"].includes(c.type));
      if (hasMortgage && !hasPropertyCover) {
        actions.push({ priority: "high", module: "security", title: "Doplniť poistenie nehnuteľnosti k hypotéke",
          detail: "Pri hypotéke banka vyžaduje poistenie nehnuteľnosti s vinkuláciou. V existujúcich zmluvách ho nemáme — overte a prípadne doplňte." });
      }
      contracts.filter((c) => ["vehicle", "property"].includes(store.contractType(c.type).kind)).forEach((c) => {
        const days = daysToAnniversary(c.startDate, s.meta.date);
        if (days != null && days <= 90) {
          actions.push({ priority: "low", module: "security",
            title: `Pred výročím porovnať ponuky: ${store.contractType(c.type).label}`,
            detail: `Výročie ${fmtDayMonth(c.startDate)} (o ${days} dní)${c.provider ? `, ${c.provider}` : ""}${c.subject ? `, ${c.subject}` : ""}. Zmenu poisťovne treba spravidla oznámiť 6 týždňov pred výročím.` });
        }
      });
    }

    loans.filter((l) => num(l.ratePct) >= 8 && num(l.balance) > 0).forEach((l) => {
      actions.push({ priority: "medium", module: "general", title: `Zvážiť refinancovanie: ${l.name || LOAN_KIND[l.kind] || "úver"}`,
        detail: `Úrok ${String(l.ratePct).replace(".", ",")} % pri zostatku ${eur(l.balance)}; predčasné splatenie alebo konsolidácia môže ušetriť na úrokoch.` });
    });

    // ---------------------------------------------------------------- Stav modulov
    const status = { investments: !!inv, retirement: !!ret, security: !!sec, children: !!kids, housing: !!house, incomeScaling: false };
    const clientGoals = GOAL_ORDER.filter(selected).map((k) => ({
      key: k,
      title: GOAL_TITLES[k],
      note: ((s.goals[k] && s.goals[k].note) || "").trim() || undefined,
      status: !HAS_CALCULATOR[k] ? "soon" : raw(k) ? "done" : "pending",
    }));
    if (!store.hasProfile(s)) warnings.push("V profile chýba meno klienta alebo príjem.");
    if (!clientGoals.length) warnings.push("Klient zatiaľ nemá pridaný žiadny cieľ — pridajte ho v časti Ciele.");
    clientGoals.filter((g) => g.status === "pending").forEach((g) =>
      warnings.push(`Cieľ „${g.title}“ je pridaný, ale jeho kalkulačka ešte nie je vyplnená.`));

    const age = store.clientAge(s);
    /** @type {FinancialPlanReport} */
    const report = {
      meta: { date: s.meta.date, version: 1 },
      advisor: { ...s.advisor },
      client: {
        firstName: s.client.firstName || "Klient", lastName: s.client.lastName || "",
        birthDate: s.client.birthDate || undefined, email: s.client.email || undefined, phone: s.client.phone || undefined,
        household: [
          ...(s.household.partner.enabled ? [{ relation: "partner", firstName: s.household.partner.firstName || "partner/ka", birthDate: s.household.partner.birthDate || undefined }] : []),
          ...(s.household.children || []).map((c) => ({ relation: "child", firstName: c.firstName || "dieťa", birthDate: c.birthDate || undefined, isDependent: true })),
        ],
      },
      summary: {
        cashflow: today,
        cashflowAfterPlan: after,
        netWorth: { assets: round(assets), liabilities: round(loansTotal), net: round(assets - loansTotal), liquid: round(f.liquidSavings) },
      },
      clientGoals,
      actions,
      housing: {
        loans: loans.filter((l) => l.kind === "mortgage" && selected("housing")).map((l) => ({
          name: l.name || LOAN_KIND.mortgage, balance: num(l.balance), ratePct: num(l.ratePct), monthlyPayment: num(l.monthlyPayment),
        })),
        // Nová hypotéka z kalkulačky = plánovaná kúpa (financovanie a dopad na cashflow).
        plannedPurchases: house && house.mode === "new" ? [{
          label: "Plánovaná kúpa", price: round(house.price), ownFunds: round(house.ownFunds), loanAmount: round(house.loan),
          ratePct: house.rate, fixationYears: house.fixYears, termYears: house.years, monthlyPayment: round(house.payment),
          freeCashflowBefore: today.free, freeCashflowAfter: round(today.free - num(house.payment)),
        }] : undefined,
        mortgage: house || undefined, // prepočet a predčasné splatenie z hypotekárnej kalkulačky (+ úvod pre klienta)
      },
      // Sekcia len pri pridanom cieli „Sporenie a investície“ (dôchodkové účty ju samy nezapnú).
      investments: selected("investments")
        ? { accounts, goals: [], projection, projectionTitle: inv ? `Projekcia: ${inv.offerName || "navrhovaná investícia"}` : undefined }
        : undefined,
      security: {
        emergencyFund,
        motivation: (sec && sec.motivation) || undefined, // úvod pre klienta zo životnej kalkulačky
        premiumBudget: sec ? { min: round(sec.budgetLo), max: round(sec.budgetHi), current: round(lifePrem), proposed: proposedPremium != null ? round(proposedPremium) : undefined } : undefined,
        people,
        contracts: selected("security") ? contracts.map((c) => {
          const t = store.contractType(c.type);
          const who = ["life", "person"].includes(t.kind) ? store.insuredLabel(s, c.insured) : "";
          return {
            type: t.label, group: t.group, provider: c.provider || undefined, number: c.number || undefined,
            subject: [who, c.subject].filter(Boolean).join(" · ") || undefined,
            sumInsured: num(c.sumInsured) || undefined,
            monthlyPremium: Math.round(store.contractMonthly(c) * 100) / 100,
            // Skutočná platba, ak sa neplatí mesačne (napr. „168 € ročne“).
            paymentNote: (num(c.frequency) || 12) !== 12 && num(c.premium) > 0
              ? `${eur(num(c.premium))} ${{ 4: "štvrťročne", 2: "polročne", 1: "ročne" }[num(c.frequency)] || ""}`.trim() : undefined,
            startDate: c.startDate || undefined, endDate: c.endDate || undefined,
          };
        }) : [],
      },
      children: kids ? {
        strategyLabel: kids.strategyLabel, inflationPct: kids.inflation,
        kids: (kids.kids || []).map((k) => ({ ...k })),
        motivation: kids.motivation || undefined, // úvod pre klienta z detskej kalkulačky
      } : undefined,
      retirement: ret ? {
        currentAge: ret.age, retirementAge: ret.retAge, payoutEndAge: ret.endAge,
        targetMonthlyToday: round(ret.target),
        sources: { statePension: round(ret.statePension), pillar2: round(ret.p2Renta), pillar3: round(ret.p3Renta), investments: round(ret.renta) },
        requiredExtraMonthlyInvestment: retirementExtraFull > 0 ? round(retirementExtraFull) : undefined,
        motivation: ret.motivation || undefined, // úvod pre klienta z dôchodkovej kalkulačky
        note: coveredByNewInvestment > 0
          ? (retirementExtra > 0.5
            ? `Navrhovaná investícia${inv.offerName ? ` „${inv.offerName}“` : ""} z toho pokryje ${eur(coveredByNewInvestment)}, zvyšok ${eur(retirementExtra)} mesačne treba doplniť.`
            : `Túto sumu pokryje navrhovaná investícia${inv.offerName ? ` „${inv.offerName}“` : ""} (${eur(newInvestment)} mesačne).`)
          : undefined,
      } : undefined,
      assumptions: {
        inflationPct: num(s.assumptions.inflationPct),
        notes: [
          "Hodnoty v súhrne vychádzajú z profilu klienta a z uložených výsledkov kalkulačiek.",
          "Súčasné pravidelné investovanie a poistné sú podľa profilu; po realizácii plánu sa pripočíta nová investícia, dorovnanie dôchodku a nahradí sa poistné novým návrhom.",
          ...(emergencyFund ? [`Finančná rezerva = ${reserveMonths} × (nevyhnutné výdavky + splátky úverov).`] : []),
          ...(age != null && ret ? [`Vek klienta ${age} rokov, odchod do dôchodku v ${ret.retAge} rokoch.`] : []),
        ],
      },
    };
    return { report, status, warnings };
  }

  global.PlanEngine = { buildReport };
})(typeof window !== "undefined" ? window : globalThis);
