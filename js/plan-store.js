// Spoločný profil klienta pre všetky kalkulačky (localStorage, bez servera).
//
// Stav = parametre klienta zadané na plan.html + uložené vstupy a výsledky
// jednotlivých kalkulačiek. Kalkulačka otvorená s ?plan=1 si z profilu
// prevezme spoločné údaje (vek, príjem, úvery, rodina…), priebežne sa ukladá
// do plánu a spoločné údaje, ktoré v nej zmeníte, zapíše späť do profilu.
// Bez ?plan=1 sa kalkulačky správajú presne ako doteraz.

(function (global) {
  "use strict";

  const KEY = "financny-plan:v1";
  const PLAN_PAGE = "plan.html";

  const today = () => new Date().toISOString().slice(0, 10);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  function emptyState() {
    return {
      version: 1,
      updatedAt: null,
      meta: { date: today() },
      advisor: { name: "", company: "", nbsRegNumber: "", email: "", phone: "" },
      client: { firstName: "", lastName: "", birthDate: "", age: null, email: "", phone: "", yearsWorked: null, retirementAge: 64 },
      household: { partner: { enabled: false, firstName: "", birthDate: "", netIncome: 0 }, children: [] },
      finances: {
        grossIncome: 0, netIncome: 0, netManual: false, otherIncome: 0, breadwinner: true,
        livingExpenses: 0, essentialExpenses: 0, currentInvesting: 0, insurancePremiums: 0,
        liquidSavings: 0, otherAssets: 0, reserveMonths: 6,
      },
      loans: [],            // { name, kind: "mortgage" | "consumer" | "car" | "other", balance, monthlyPayment, ratePct }
      assumptions: { inflationPct: 3 },
      links: { investmentForRetirement: false },
      // Ciele klienta: key -> { selected, note }. Chýbajúci kľúč = zatiaľ nerozhodnuté.
      goals: {},
      // Existujúce zmluvy: { id, type, provider, number, insured, subject, sumInsured,
      //   premium, frequency (platby za rok), startDate, endDate, riders: { key: suma }, note }
      contracts: [],
      branding: { primary: "#0f6b5c", companyName: "", footerNote: "", logo: null },
      modules: {},          // key -> { inputs, extra, summary, savedAt }
    };
  }

  // Doplní chýbajúce polia z emptyState (pri novších verziách štruktúry).
  function mergeDefaults(base, stored) {
    if (Array.isArray(base) || base === null || typeof base !== "object") return stored === undefined ? base : stored;
    const out = { ...base };
    if (stored && typeof stored === "object") {
      for (const k of Object.keys(stored)) out[k] = k in base ? mergeDefaults(base[k], stored[k]) : stored[k];
    }
    return out;
  }

  let memory = null; // záloha, ak localStorage nie je dostupný
  function load() {
    try {
      const raw = global.localStorage.getItem(KEY);
      if (raw) return mergeDefaults(emptyState(), JSON.parse(raw));
    } catch (e) { /* súkromný režim, zablokované úložisko */ }
    return memory ? mergeDefaults(emptyState(), memory) : emptyState();
  }

  function save(state) {
    state.updatedAt = new Date().toISOString();
    memory = state;
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ostane v pamäti */ }
    return state;
  }

  function update(fn) {
    const s = load();
    fn(s);
    return save(s);
  }

  function reset() {
    memory = null;
    try { global.localStorage.removeItem(KEY); } catch (e) { /* nič */ }
  }

  function replace(state) {
    return save(mergeDefaults(emptyState(), state));
  }

  // ---------------------------------------------------------------------------
  // Odvodené hodnoty profilu
  // ---------------------------------------------------------------------------
  // Rovnaký výpočet čistej mzdy ako v zivotna-kalkulacka.html (netFromGross).
  const LIVING_MIN = 284.13;
  const EMPLOYEE_LEVY = 0.144;
  function netFromGross(gross) {
    const g = Math.max(0, num(gross));
    const levy = g * EMPLOYEE_LEVY;
    const annualBase = (g - levy) * 12;
    const nczd = annualBase <= 92.8 * LIVING_MIN ? 21 * LIVING_MIN : Math.max(0, 44.2 * LIVING_MIN - annualBase / 4);
    const taxable = Math.max(0, annualBase - nczd);
    const bracket = 176.8 * LIVING_MIN;
    const tax = taxable <= bracket ? taxable * 0.19 : bracket * 0.19 + (taxable - bracket) * 0.25;
    return Math.round(g - levy - tax / 12);
  }

  function ageFrom(birthIso, atIso) {
    const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthIso || "");
    const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(atIso || today());
    if (!b || !a) return null;
    const [by, bm, bd] = b.slice(1).map(Number), [ay, am, ad] = a.slice(1).map(Number);
    return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
  }

  const clientAge = (s) => (s.client.birthDate ? ageFrom(s.client.birthDate, s.meta.date) : s.client.age);
  const clientNet = (s) => (s.finances.netManual ? num(s.finances.netIncome) : netFromGross(s.finances.grossIncome));
  const clientName = (s) => [s.client.firstName, s.client.lastName].filter(Boolean).join(" ");
  const activeLoans = (s) => (s.loans || []).filter((l) => num(l.balance) > 0 || num(l.monthlyPayment) > 0);
  const loansTotal = (s) => activeLoans(s).reduce((t, l) => t + num(l.balance), 0);
  const loanPayments = (s) => activeLoans(s).reduce((t, l) => t + num(l.monthlyPayment), 0);
  const householdNet = (s) => clientNet(s) + (s.household.partner.enabled ? num(s.household.partner.netIncome) : 0) + num(s.finances.otherIncome);
  const hasProfile = (s) => !!(s.client.firstName || s.client.lastName) && num(s.finances.grossIncome) + num(s.finances.netIncome) > 0;

  // ---------------------------------------------------------------------------
  // Existujúce zmluvy
  // ---------------------------------------------------------------------------
  // kind: life = osobné poistenie s pripoisteniami (prepojené so životnou kalkulačkou),
  // person = iné osobné, property = majetok a zodpovednosť, vehicle = vozidlá, other.
  const CONTRACT_TYPES = [
    { group: "Osoby", key: "life_risk", label: "Životné poistenie – rizikové", kind: "life" },
    { group: "Osoby", key: "life_invest", label: "Investičné životné poistenie (IŽP)", kind: "life" },
    { group: "Osoby", key: "life_capital", label: "Kapitálové životné poistenie", kind: "life" },
    { group: "Osoby", key: "accident", label: "Úrazové poistenie", kind: "life", riders: ["injury", "daily", "hosp", "surgery"] },
    { group: "Osoby", key: "critical_illness", label: "Poistenie závažných ochorení", kind: "life", riders: ["ci"] },
    { group: "Osoby", key: "health", label: "Zdravotné / nadštandardné poistenie", kind: "person" },
    { group: "Osoby", key: "travel", label: "Cestovné poistenie (celoročné)", kind: "person" },
    { group: "Osoby", key: "loan_protection", label: "Poistenie schopnosti splácať úver", kind: "person" },
    { group: "Majetok", key: "property_building", label: "Poistenie nehnuteľnosti (stavby)", kind: "property" },
    { group: "Majetok", key: "property_household", label: "Poistenie domácnosti", kind: "property" },
    { group: "Majetok", key: "property_combined", label: "Nehnuteľnosť + domácnosť (balík)", kind: "property" },
    { group: "Majetok", key: "property_holiday", label: "Poistenie chaty / rekreačného objektu", kind: "property" },
    { group: "Majetok", key: "liability_civil", label: "Zodpovednosť za škodu (občan, domácnosť)", kind: "property" },
    { group: "Majetok", key: "liability_employee", label: "Zodpovednosť zamestnanca", kind: "person" },
    { group: "Majetok", key: "pets", label: "Poistenie domácich zvierat", kind: "other" },
    { group: "Majetok", key: "electronics", label: "Poistenie elektroniky / mobilu", kind: "other" },
    { group: "Vozidlá", key: "mtpl", label: "PZP (povinné zmluvné poistenie)", kind: "vehicle" },
    { group: "Vozidlá", key: "casco", label: "Havarijné poistenie", kind: "vehicle" },
    { group: "Vozidlá", key: "gap", label: "GAP poistenie", kind: "vehicle" },
    { group: "Vozidlá", key: "windshield", label: "Poistenie skiel vozidla", kind: "vehicle" },
    { group: "Vozidlá", key: "assistance", label: "Asistenčné služby k vozidlu", kind: "vehicle" },
    { group: "Ostatné", key: "business", label: "Poistenie podnikateľa / živnostníka", kind: "other" },
    { group: "Ostatné", key: "legal", label: "Poistenie právnej ochrany", kind: "other" },
    { group: "Ostatné", key: "other", label: "Iné poistenie", kind: "other" },
  ];
  const contractType = (key) => CONTRACT_TYPES.find((t) => t.key === key) || CONTRACT_TYPES[CONTRACT_TYPES.length - 1];

  // Pripoistenia — rovnaké kľúče a jednotky ako v zivotna-kalkulacka.html.
  const RIDERS_ADULT = [
    ["death", "Smrť", "€"], ["invDecr", "Invalidita s klesajúcou sumou", "€"],
    ["inv41", "Invalidita jednorazová (41 %)", "€"], ["inv40r", "Invalidita renta (40 %)", "€ / mes."],
    ["inv71", "Invalidita jednorazová (71 %)", "€"], ["inv70r", "Invalidita renta (70 %)", "€ / mes."],
    ["ci", "Závažné ochorenia", "€"], ["injury", "Trvalé následky úrazu", "€"],
    ["pn", "Práceneschopnosť", "€ / deň"], ["surgery", "Chirurgický zákrok", "€"],
    ["hosp", "Hospitalizácia", "€ / deň"], ["daily", "Denné odškodné", "€ / deň"],
  ];
  const RIDERS_CHILD = [
    ["injury", "Trvalé následky úrazu", "€"], ["ci", "Závažné ochorenia", "€"], ["childInv", "Invalidita dieťaťa", "€"],
    ["hosp", "Hospitalizácia", "€ / deň"], ["surgery", "Chirurgický zákrok", "€"], ["daily", "Denné odškodné", "€ / deň"],
    ["death", "Smrť", "€"],
  ];
  // Pripoistenia, ktoré sa dajú zadať pri zmluve podľa typu a poisteného.
  function contractRiders(c) {
    const t = contractType(c.type);
    if (t.kind !== "life") return [];
    const base = String(c.insured || "").startsWith("child") ? RIDERS_CHILD : RIDERS_ADULT;
    return t.riders ? base.filter(([k]) => t.riders.includes(k)) : base;
  }

  const contractMonthly = (c) => num(c.premium) * (num(c.frequency) || 12) / 12;
  const isLifeContract = (c) => contractType(c.type).kind === "life";
  const activeContracts = (s) => (s.contracts || []).filter((c) => c.type);
  // Poistné životného poistenia: zo zmlúv, alebo z ručne zadanej sumy v profile, ak zmluvy nie sú.
  function lifePremiums(s) {
    const life = activeContracts(s).filter(isLifeContract);
    return life.length ? life.reduce((t, c) => t + contractMonthly(c), 0) : num(s.finances.insurancePremiums);
  }
  const otherPremiums = (s) => activeContracts(s).filter((c) => !isLifeContract(c)).reduce((t, c) => t + contractMonthly(c), 0);

  // Súčasné krytie zo zmlúv pre životnú kalkulačku: klient (adult) a prvé dieťa (child).
  function contractCover(s) {
    const out = { adult: {}, child: {}, adultCount: 0, childCount: 0 };
    for (const c of activeContracts(s).filter(isLifeContract)) {
      const who = c.insured === "client" ? "adult" : c.insured === "child:0" ? "child" : null;
      if (!who) continue;
      out[who + "Count"]++;
      for (const [k] of contractRiders(c)) {
        const v = num(c.riders && c.riders[k]);
        if (v > 0) out[who][k] = (out[who][k] || 0) + v;
      }
    }
    return out;
  }

  function insuredLabel(s, insured) {
    if (insured === "client") return s.client.firstName || "Klient";
    if (insured === "partner") return s.household.partner.firstName || "Partner";
    const m = /^child:(\d+)$/.exec(insured || "");
    if (m) { const ch = (s.household.children || [])[+m[1]]; return (ch && ch.firstName) || `Dieťa ${+m[1] + 1}`; }
    return "Iná osoba";
  }

  // ---------------------------------------------------------------------------
  // Spoločné údaje medzi profilom a kalkulačkami
  // ---------------------------------------------------------------------------
  // Hodnoty null/undefined/NaN a nevyplnené nuly (vek, mzda) sa neprenášajú,
  // aby prázdny profil neprepísal predvolené hodnoty kalkulačky.
  function pick(obj, zeroIsEmpty) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || (typeof v === "number" && !isFinite(v))) continue;
      if (zeroIsEmpty.includes(k) && !v) continue;
      out[k] = v;
    }
    return out;
  }

  const SHARED = {
    investments: {
      toCalc: () => ({}),
      fromCalc: () => {},
    },
    retirement: {
      toCalc: (s) => pick({
        age: clientAge(s),
        retAge: s.client.retirementAge,
        wage: s.finances.grossIncome,
        yearsWorked: s.client.yearsWorked,
        inflation: s.assumptions.inflationPct,
      }, ["age", "wage", "retAge"]),
      fromCalc: (s, v) => {
        if (!s.client.birthDate) s.client.age = v.age;
        s.client.retirementAge = v.retAge;
        s.finances.grossIncome = v.wage;
        s.client.yearsWorked = v.yearsWorked;
        s.assumptions.inflationPct = v.inflation;
      },
    },
    security: {
      toCalc: (s) => pick({
        age: clientAge(s),
        retAge: s.client.retirementAge,
        gross: s.finances.grossIncome,
        netManual: s.finances.netManual,
        net: s.finances.netManual ? s.finances.netIncome : null,
        yearsWorked: s.client.yearsWorked,
        loans: loansTotal(s),
        breadwinner: s.finances.breadwinner,
        partner: s.household.partner.enabled,
        children: (s.household.children || []).length,
      }, ["age", "gross", "retAge"]),
      fromCalc: (s, v) => {
        if (!s.client.birthDate) s.client.age = v.age;
        s.client.retirementAge = v.retAge;
        s.finances.grossIncome = v.gross;
        s.finances.netManual = !!v.netManual;
        if (v.netManual) s.finances.netIncome = v.net;
        s.client.yearsWorked = v.yearsWorked;
        s.finances.breadwinner = !!v.breadwinner;
        // Úvery, partner a deti sa spravujú v profile (sú to zoznamy), späť sa nezapisujú.
      },
    },
  };

  const SHARED_LABELS = {
    retirement: "vek, dôchodkový vek, hrubá mzda, odpracované roky, inflácia",
    security: "vek, príjem, úvery, rodina, živiteľ a krytie z existujúcich zmlúv",
    investments: "",
  };

  function getModule(key) {
    return load().modules[key] || null;
  }

  function initialInputs(key, defaults) {
    const s = load();
    const saved = (s.modules[key] && s.modules[key].inputs) || {};
    return { ...defaults, ...saved, ...(SHARED[key] ? SHARED[key].toCalc(s) : {}) };
  }

  // Cieľ je pridaný, ak ho poradca pridal; ak o ňom ešte nerozhodol,
  // berie sa za pridaný, keď je vyplnená jeho kalkulačka.
  const GOAL_KEYS = ["housing", "retirement", "investments", "security", "incomeScaling"];
  function isGoalSelected(s, key) {
    const g = s.goals && s.goals[key];
    if (g && typeof g.selected === "boolean") return g.selected;
    // Existujúce poistné zmluvy patria pod cieľ Zabezpečenie.
    if (key === "security" && activeContracts(s).length) return true;
    return !!(s.modules[key] && s.modules[key].summary);
  }
  function setGoal(key, patch) {
    return update((s) => {
      const current = s.goals[key] || { selected: isGoalSelected(s, key), note: "" };
      s.goals[key] = { ...current, ...patch };
    });
  }

  function saveModule(key, inputs, summary, extra) {
    update((s) => {
      s.modules[key] = { inputs, summary, extra: extra || null, savedAt: new Date().toISOString() };
      // Vyplnená kalkulačka pridá svoj cieľ, ak ho poradca predtým neodobral.
      if (!s.goals[key]) s.goals[key] = { selected: true, note: "" };
      if (SHARED[key]) SHARED[key].fromCalc(s, inputs);
    });
    setBarStatus(`Uložené do plánu ${new Date().toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })}`);
  }

  function clearModule(key) {
    update((s) => { delete s.modules[key]; });
  }

  function isPlanMode() {
    try { return new URLSearchParams(global.location.search).has("plan"); } catch (e) { return false; }
  }

  // Zmeny z iných kariet (napr. kalkulačka otvorená vedľa plánu).
  function onChange(cb) {
    global.addEventListener("storage", (e) => { if (e.key === KEY) cb(load()); });
  }

  // ---------------------------------------------------------------------------
  // Lišta „Späť na plán“ v kalkulačkách
  // ---------------------------------------------------------------------------
  let statusEl = null;
  function setBarStatus(text) { if (statusEl) statusEl.textContent = text; }

  function mountBar(moduleLabel, moduleKey) {
    if (!isPlanMode() || global.document.getElementById("plan-bar")) return;
    const s = load();
    const name = clientName(s) || "nový klient";
    const shared = SHARED_LABELS[moduleKey];
    const bar = global.document.createElement("div");
    bar.id = "plan-bar";
    bar.setAttribute("role", "navigation");
    bar.style.cssText = [
      "position:sticky", "top:0", "z-index:50", "display:flex", "flex-wrap:wrap", "align-items:center", "gap:8px 16px",
      "padding:10px 16px", "background:var(--surface,#fff)", "border-bottom:1px solid var(--border,rgba(0,0,0,.1))",
      "font:600 14px/1.3 Manrope,system-ui,sans-serif", "color:var(--text-primary,#10231f)",
    ].join(";");
    bar.innerHTML =
      `<a href="${PLAN_PAGE}" style="color:var(--accent,#0f6b5c);text-decoration:none;font-weight:800">← Finančný plán</a>` +
      `<span style="color:var(--text-secondary,#4b5b57)">Klient: <strong style="color:var(--text-primary,#10231f)"></strong> · ${moduleLabel}</span>` +
      (shared ? `<span style="color:var(--text-muted,#7c8b86);font-weight:500;font-size:12px">Spoločné údaje z profilu: ${shared}</span>` : "") +
      `<span data-status style="margin-left:auto;color:var(--text-muted,#7c8b86);font-weight:500;font-size:12px">Zmeny sa ukladajú do plánu automaticky</span>`;
    bar.querySelector("strong").textContent = name;
    statusEl = bar.querySelector("[data-status]");
    global.document.body.insertBefore(bar, global.document.body.firstChild);
  }

  // ---------------------------------------------------------------------------
  // Záloha do súboru
  // ---------------------------------------------------------------------------
  function exportJson() {
    return JSON.stringify(load(), null, 2);
  }

  global.PlanStore = {
    KEY, load, save, update, reset, replace, emptyState,
    getModule, initialInputs, saveModule, clearModule, isPlanMode, onChange, mountBar, exportJson,
    GOAL_KEYS, isGoalSelected, setGoal,
    CONTRACT_TYPES, RIDERS_ADULT, RIDERS_CHILD, contractType, contractRiders, contractMonthly, isLifeContract,
    activeContracts, lifePremiums, otherPremiums, contractCover, insuredLabel,
    netFromGross, ageFrom, clientAge, clientNet, clientName, activeLoans, loansTotal, loanPayments, householdNet, hasProfile,
  };
})(typeof window !== "undefined" ? window : globalThis);
