// Contract for the centralized client data object that the PDF module consumes.
// It is the output of the calculation engine (Task 2): inputs from the unified
// profile plus the computed results. Amounts are EUR per month unless the name
// says otherwise; percentages are stored as percent (3.9 = 3,9 %).

export type ModuleKey = "housing" | "investments" | "security" | "retirement" | "incomeScaling";

export interface FinancialPlanReport {
  meta: {
    planId?: string;
    version?: number;
    date: string;                 // ISO date of the meeting / plan
    engineVersion?: string;
  };
  advisor: {
    name: string;
    company?: string;
    nbsRegNumber?: string;
    email?: string;
    phone?: string;
  };
  client: {
    firstName: string;
    lastName: string;
    birthDate?: string;
    email?: string;
    phone?: string;
    household?: HouseholdMember[];
  };
  summary: {
    cashflow: Cashflow;
    cashflowAfterPlan?: Cashflow;  // after all planned changes (purchase, new premiums, ...)
    netWorth: { assets: number; liabilities: number; net: number; liquid?: number };
  };
  clientGoals?: ClientGoal[];      // goals the client wants to work on (listed on the summary page)
  actions: ActionItem[];

  // Every module is optional. A module that is missing or has no active data
  // is left out of the PDF entirely.
  housing?: HousingSection;
  investments?: InvestmentSection;
  security?: SecuritySection;
  retirement?: RetirementSection;
  incomeScaling?: IncomeScalingSection;

  assumptions?: { inflationPct?: number; notes?: string[] };
}

export interface HouseholdMember {
  relation: "partner" | "child" | "parent" | "other";
  firstName: string;
  birthDate?: string;
  isDependent?: boolean;
}

export interface ClientGoal {
  key: ModuleKey;
  title: string;
  note?: string;                   // what the client wants to achieve
  status: "done" | "pending" | "soon";   // calculated / calculator not filled yet / calculator not available yet
}

export interface Cashflow {
  netIncome: number;
  livingExpenses: number;
  debtPayments: number;
  insurancePremiums: number;
  investmentContributions: number;
  free: number;                    // can be negative
}

export interface ActionItem {
  priority: "high" | "medium" | "low";
  module: ModuleKey | "general";
  title: string;
  detail?: string;
  monthlyImpact?: number;          // + frees cashflow, − costs cashflow
  deadline?: string;               // ISO date
}

// ---------------------------------------------------------------- Housing
export interface HousingSection {
  properties?: Property[];
  loans?: Loan[];
  plannedPurchases?: PlannedPurchase[];
}

export type PropertyType = "apartment" | "house" | "land" | "commercial" | "garage" | "other";
export type PropertyUsage = "own_housing" | "rental" | "holiday" | "mixed";

export interface Property {
  name: string;
  type: PropertyType;
  usage: PropertyUsage;
  value: number;
  loanBalance?: number;
  monthlyRent?: number;
  monthlyCosts?: number;
}

export interface Loan {
  name: string;                    // lender / label
  balance: number;
  ratePct: number;
  monthlyPayment: number;
  fixationEndDate?: string;
  maturityDate?: string;
}

export interface PlannedPurchase {
  label: string;
  type: PropertyType;
  usage: PropertyUsage;
  targetDate: string;
  price: number;
  extraCosts?: number;             // transaction + renovation
  ownFunds: number;
  loanAmount: number;
  ratePct: number;
  termYears: number;
  fixationYears?: number;
  monthlyPayment: number;
  monthlyRunningCosts?: number;
  expectedMonthlyRent?: number;
  replacedHousingCost?: number;    // e.g. rent that stops after the purchase
  freeCashflowBefore: number;
  freeCashflowAfter: number;
  notes?: string[];                // cross-module effects, e.g. insurance increase
}

// ---------------------------------------------------------------- Investments
export interface InvestmentSection {
  accounts?: InvestmentAccount[];
  goals?: Goal[];
  projection?: { year: number; contributed: number; value: number }[];
  projectionTitle?: string;
}

export interface InvestmentAccount {
  name: string;
  provider?: string;
  productType: string;
  value: number;
  monthlyContribution: number;
  employerContribution?: number;
  expectedReturnPct?: number;
  annualFeePct?: number;
}

export interface Goal {
  label: string;
  kind: "emergency_fund" | "property_down_payment" | "education" | "car" | "retirement" |
        "financial_independence" | "wealth" | "other";
  targetAmount: number;            // nominal at target date
  targetDate: string;
  projectedAmount: number;
  currentMonthly: number;
  requiredMonthly: number;
  status: "on_track" | "at_risk" | "off_track";
}

// ---------------------------------------------------------------- Security
export interface SecuritySection {
  emergencyFund?: { current: number; target: number; targetMonths: number; monthlyEssentialExpenses: number };
  premiumBudget?: { min: number; max: number; current: number; proposed?: number };
  people?: InsuredPerson[];
  contracts?: ExistingContract[];  // insurance contracts the client already has
}

export interface ExistingContract {
  type: string;                    // human label, e.g. "PZP (povinné zmluvné poistenie)"
  group?: string;                  // Osoby / Majetok / Vozidlá / Ostatné
  provider?: string;
  number?: string;
  subject?: string;                // insured person and/or insured object
  sumInsured?: number;
  monthlyPremium: number;
  paymentNote?: string;            // actual payment when not monthly, e.g. "168 € ročne"
  startDate?: string;
  endDate?: string;
}

export interface InsuredPerson {
  name: string;
  role?: string;                   // "Živiteľ rodiny", "Dieťa", ...
  coverages: Coverage[];
}

export interface Coverage {
  riderKey: string;                // matches RIDERS_ADULT / RIDERS_CHILD keys
  label: string;
  unit: "lump_sum" | "monthly" | "daily";
  current: number;
  recommended: number;
  reason?: string;
}

// ---------------------------------------------------------------- Retirement
export interface RetirementSection {
  currentAge: number;
  retirementAge: number;
  payoutEndAge?: number;
  targetMonthlyToday: number;      // today's money
  sources: {                       // expected monthly income in today's money
    statePension?: number;
    pillar2?: number;
    pillar3?: number;
    investments?: number;
    rental?: number;
    other?: number;
  };
  requiredExtraMonthlyInvestment?: number;
  note?: string;                   // e.g. which planned investment covers the gap
}

// ---------------------------------------------------------------- Income scaling
export interface IncomeScalingSection {
  currentNetMonthly: number;
  steps?: {
    label: string;
    person?: string;
    startDate: string;
    extraNetMonthly: number;
    probabilityPct?: number;
  }[];
  allocation?: { label: string; pct: number }[];   // how to split each raise
}

export interface BrandOptions {
  primary?: string;                // main brand color (hex)
  primarySoft?: string;            // light tint for tiles / table stripes
  ink?: string;
  inkSecondary?: string;
  muted?: string;
  hairline?: string;
  companyName?: string;
  logo?: string | null;            // PNG/JPEG data URL, or an inline <svg> string
  footerNote?: string;
}

export interface PdfOptions {
  brand?: BrandOptions;
  // "auto" (default): a section starts a new page only if less than ~55 % of
  // the current page is left; "always": every section on a new page; "never".
  sectionPageBreaks?: "auto" | "always" | "never";
  fileName?: string;
}
