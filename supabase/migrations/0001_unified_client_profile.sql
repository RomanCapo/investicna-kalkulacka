-- =============================================================================
-- Unified client profile — PostgreSQL / Supabase
--
-- Conventions
--   * Money:       numeric(14,2), EUR.
--   * Percentages: numeric(7,3) stored as percent (5.000 = 5 %), matching the
--                  existing calculators (returnAcc: 7, costs: 1.2, ...).
--   * Monthly amounts unless the column name says otherwise.
--   * Derived values (net worth, cashflow, insurance need) are NOT stored as
--     inputs. They are computed in views / by the engine and frozen in
--     plan_results when a plan is generated.
--
-- Core idea: every piece of financial data hangs off a FINANCIAL_PLAN
-- (a dated snapshot of one client's situation), and the plan hangs off CLIENT.
-- A new meeting = clone the last plan and edit it. Signed plans stay immutable.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 0. Reference data: Slovak statutory parameters per year
--    (today hard-coded as DEFAULT_ADH / DEFAULT_VVZ in the calculators)
-- -----------------------------------------------------------------------------
create table statutory_parameters (
  year                  int primary key,
  adh                   numeric(10,5) not null,   -- aktuálna dôchodková hodnota
  vvz                   numeric(14,2) not null,   -- všeobecný vymeriavací základ
  avg_wage              numeric(14,2) not null,   -- priemerná mzda
  p2_contribution_pct   numeric(7,3)  not null,   -- odvod do 2. piliera
  subsistence_minimum   numeric(14,2)             -- životné minimum
);

-- -----------------------------------------------------------------------------
-- 1. Advisors & clients
-- -----------------------------------------------------------------------------
create table advisors (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  company         text,
  nbs_reg_number  text,                           -- registration no. at NBS (financial agent)
  email           text not null,
  created_at      timestamptz not null default now()
);

create table clients (
  id                 uuid primary key default gen_random_uuid(),
  advisor_id         uuid not null references advisors(id),
  first_name         text not null,
  last_name          text not null,
  birth_date         date,
  email              text,
  phone              text,
  employment_type    text check (employment_type in
                       ('employee','self_employed','company_owner','unemployed','retired','student','other')),
  marital_status     text check (marital_status in ('single','married','partnership','divorced','widowed')),
  gdpr_consent_at    timestamptz,                 -- consent needed before storing any financial data
  crm_external_id    text,                        -- e.g. FinPortal / other CRM id
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on clients(advisor_id);

-- Partner, children, other dependents. Needed for insurance (survivor need,
-- child mode) and for household-level cashflow.
create table household_members (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  relation        text not null check (relation in ('partner','child','parent','other')),
  first_name      text,
  birth_date      date,
  is_dependent    boolean not null default false,
  support_until_age int,                          -- supportYears in the life calculator
  created_at      timestamptz not null default now()
);
create index on household_members(client_id);

-- -----------------------------------------------------------------------------
-- 2. Financial plan (the snapshot everything else belongs to)
-- -----------------------------------------------------------------------------
create table financial_plans (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  version            int  not null,
  parent_plan_id     uuid references financial_plans(id),   -- plan it was cloned from
  meeting_date       date not null default current_date,
  status             text not null default 'draft' check (status in
                       ('draft','submitted','calculated','pdf_generated','sent_for_signature','signed','archived')),
  -- global assumptions for this plan
  inflation_pct      numeric(7,3) not null default 3,
  statutory_year     int references statutory_parameters(year),
  locked_at          timestamptz,                -- set when sent for signature → rows become read-only
  created_by         uuid references advisors(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, version)
);

-- -----------------------------------------------------------------------------
-- 3. Core metrics: income, expenses, assets, liabilities
--    Net worth  = Σ assets.current_value − Σ liabilities.outstanding_balance
--    Cashflow   = Σ net income − Σ expenses − Σ debt payments − Σ premiums − Σ contributions
-- -----------------------------------------------------------------------------
create table income_sources (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references financial_plans(id) on delete cascade,
  member_id          uuid references household_members(id),  -- null = the client
  kind               text not null check (kind in
                       ('salary','business','rental','pension','dividends','social_benefit','alimony','other')),
  label              text,
  gross_monthly      numeric(14,2),
  net_monthly        numeric(14,2) not null,
  net_is_manual      boolean not null default false,  -- netManual in the life calculator
  annual_growth_pct  numeric(7,3) not null default 0,
  months_per_year    numeric(4,1) not null default 12, -- 13th/14th salary
  linked_asset_id    uuid,                            -- rental income → property (FK added below)
  starts_on          date,
  ends_on            date
);
create index on income_sources(plan_id);

-- Living expenses only. Loan payments, insurance premiums and investment
-- contributions live in their own tables so they are never double-counted.
create table expenses (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references financial_plans(id) on delete cascade,
  category           text not null check (category in
                       ('housing','utilities','food','transport','children','health',
                        'leisure','subscriptions','other')),
  label              text,
  monthly_amount     numeric(14,2) not null,
  is_essential       boolean not null default true,  -- drives emergency-fund target
  linked_asset_id    uuid                             -- e.g. property running costs (FK below)
);
create index on expenses(plan_id);

-- Supertype for everything the client owns → net worth is one SUM.
create table assets (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references financial_plans(id) on delete cascade,
  kind               text not null check (kind in
                       ('cash','current_account','savings_account','term_deposit',
                        'investment','pension_pillar2','pension_pillar3',
                        'real_estate','vehicle','business_equity','other')),
  name               text not null,
  owner_member_id    uuid references household_members(id),  -- null = the client
  ownership_share_pct numeric(7,3) not null default 100,
  current_value      numeric(14,2) not null default 0,
  valuation_date     date,
  is_liquid          boolean not null default false,
  is_emergency_reserve boolean not null default false,
  created_at         timestamptz not null default now()
);
create index on assets(plan_id);

alter table income_sources add foreign key (linked_asset_id) references assets(id) on delete set null;
alter table expenses       add foreign key (linked_asset_id) references assets(id) on delete set null;

create table liabilities (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references financial_plans(id) on delete cascade,
  kind                text not null check (kind in
                        ('mortgage','american_mortgage','consumer_loan','car_loan','leasing',
                         'credit_card','overdraft','building_savings_loan','other')),
  lender              text,
  borrower_member_id  uuid references household_members(id),  -- null = the client
  original_amount     numeric(14,2),
  outstanding_balance numeric(14,2) not null,
  interest_rate_pct   numeric(7,3)  not null,
  monthly_payment     numeric(14,2) not null,
  start_date          date,
  maturity_date       date,
  fixation_end_date   date,                  -- refinancing trigger
  secured_by_asset_id uuid references assets(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index on liabilities(plan_id);

-- -----------------------------------------------------------------------------
-- 4. Housing & real estate
-- -----------------------------------------------------------------------------
-- Detail for assets.kind = 'real_estate'
create table properties (
  asset_id              uuid primary key references assets(id) on delete cascade,
  property_type         text not null check (property_type in
                          ('apartment','house','land','commercial','garage','other')),
  usage                 text not null check (usage in ('own_housing','rental','holiday','mixed')),
  address               text,
  purchase_price        numeric(14,2),
  purchase_date         date,
  expected_appreciation_pct numeric(7,3) not null default 2,
  monthly_running_costs numeric(14,2) not null default 0,   -- fond opráv, energie if vacant, ...
  monthly_rent_income   numeric(14,2) not null default 0,
  vacancy_pct           numeric(7,3) not null default 0
);

-- A purchase the client is PLANNING. The engine turns this into a projected
-- mortgage + property and recomputes cashflow / insurance needs.
create table planned_property_purchases (
  id                     uuid primary key default gen_random_uuid(),
  plan_id                uuid not null references financial_plans(id) on delete cascade,
  label                  text,
  property_type          text not null check (property_type in
                           ('apartment','house','land','commercial','garage','other')),
  usage                  text not null check (usage in ('own_housing','rental','holiday','mixed')),
  target_date            date not null,
  purchase_price         numeric(14,2) not null,
  transaction_costs      numeric(14,2) not null default 0,   -- notary, cadastre, broker, valuation
  renovation_costs       numeric(14,2) not null default 0,
  own_funds              numeric(14,2) not null default 0,
  own_funds_source_asset_id uuid references assets(id) on delete set null,
  loan_amount            numeric(14,2),                      -- null → engine derives
  loan_rate_pct          numeric(7,3),
  loan_term_years        int,
  loan_fixation_years    int,
  expected_monthly_rent  numeric(14,2) not null default 0,
  expected_running_costs numeric(14,2) not null default 0,
  sells_asset_id         uuid references assets(id) on delete set null, -- selling current home to buy
  replaces_housing_expense boolean not null default false,  -- e.g. rent stops after purchase
  status                 text not null default 'idea' check (status in
                           ('idea','planned','in_progress','completed','cancelled')),
  priority               int not null default 1
);
create index on planned_property_purchases(plan_id);

-- -----------------------------------------------------------------------------
-- 5. Investments & savings
-- -----------------------------------------------------------------------------
-- Detail for assets.kind in ('investment','savings_account','term_deposit',
-- 'pension_pillar2','pension_pillar3'). Mirrors index.html inputs (x,m,y,p,k,z)
-- and the 2nd/3rd pillar inputs of dochodkova-kalkulacka.html.
create table investment_accounts (
  asset_id                 uuid primary key references assets(id) on delete cascade,
  product_type             text not null check (product_type in
                             ('mutual_fund','etf','stocks','bonds','savings_account','term_deposit',
                              'building_savings','dss_pillar2','dds_pillar3','investment_life_insurance',
                              'crypto','other')),
  provider                 text,
  contract_number          text,
  monthly_contribution     numeric(14,2) not null default 0,   -- client (m / p3Client)
  employer_contribution    numeric(14,2) not null default 0,   -- p3Employer
  contribution_growth_pct  numeric(7,3)  not null default 0,   -- dynamization / p3Dyn
  expected_return_pct      numeric(7,3)  not null,             -- z / returnAcc / p2Return
  annual_fee_pct           numeric(7,3)  not null default 0,   -- y / costs
  entry_fee_pct            numeric(7,3)  not null default 0,   -- p
  entry_fee_spread_months  int           not null default 0,   -- k
  risk_profile             text check (risk_profile in ('conservative','balanced','growth','dynamic')),
  -- 2nd pillar specifics
  p2_contribution_pct      numeric(7,3),                        -- p2Rate
  p2_years_saved           int,                                 -- p2Years
  p2_past_contribution_pct numeric(7,3)                         -- p2PastRate
);

create table financial_goals (
  id                     uuid primary key default gen_random_uuid(),
  plan_id                uuid not null references financial_plans(id) on delete cascade,
  kind                   text not null check (kind in
                           ('emergency_fund','property_down_payment','education','car',
                            'retirement','financial_independence','wealth','other')),
  label                  text not null,
  target_amount_today    numeric(14,2),              -- in today's money; engine inflates
  target_date            date,
  horizon_years          int,                        -- used if target_date is null
  priority               int not null default 1,     -- 1 = highest; drives cashflow allocation
  risk_profile           text check (risk_profile in ('conservative','balanced','growth','dynamic')),
  funded_by_asset_id     uuid references assets(id) on delete set null,
  planned_purchase_id    uuid references planned_property_purchases(id) on delete cascade,
  check (target_date is not null or horizon_years is not null or kind = 'emergency_fund')
);
create index on financial_goals(plan_id);

-- -----------------------------------------------------------------------------
-- 6. Insurance & security
-- -----------------------------------------------------------------------------
create table security_profiles (
  plan_id                    uuid primary key references financial_plans(id) on delete cascade,
  emergency_fund_months      numeric(4,1) not null default 6,   -- target × essential expenses
  premium_budget_min_pct     numeric(7,3) not null default 5,   -- 5–10 % of net income
  premium_budget_max_pct     numeric(7,3) not null default 10,
  is_breadwinner             boolean not null default false,
  has_employer_sick_pay      boolean not null default false
);

create table insurance_policies (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references financial_plans(id) on delete cascade,
  insured_member_id   uuid references household_members(id),  -- null = the client
  kind                text not null check (kind in
                        ('risk_life','investment_life','accident','property','household',
                         'liability','travel','health','payment_protection','other')),
  status              text not null default 'existing' check (status in ('existing','proposed','cancelled')),
  insurer             text,
  policy_number       text,
  monthly_premium     numeric(14,2) not null default 0,
  start_date          date,
  end_date            date,
  assigned_to_liability_id uuid references liabilities(id) on delete set null,  -- vinkulácia for a mortgage
  insured_asset_id    uuid references assets(id) on delete set null           -- property insurance
);
create index on insurance_policies(plan_id);

-- Rider keys match RIDERS_ADULT / RIDERS_CHILD in zivotna-kalkulacka.html.
create table insurance_coverages (
  id                  uuid primary key default gen_random_uuid(),
  policy_id           uuid not null references insurance_policies(id) on delete cascade,
  rider_key           text not null check (rider_key in
                        ('death','invDecr','inv41','inv40r','inv71','inv70r','ci','injury',
                         'pn','surgery','hosp','daily','childInv')),
  sum_insured         numeric(14,2) not null,
  unit                text not null check (unit in ('lump_sum','monthly','daily')),
  is_decreasing       boolean not null default false,
  unique (policy_id, rider_key)
);

-- Engine output per person × rider, with an advisor override (the calculator
-- already lets the advisor adjust and reset recommended sums).
create table insurance_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references financial_plans(id) on delete cascade,
  insured_member_id   uuid references household_members(id),
  rider_key           text not null,
  recommended_amount  numeric(14,2) not null,   -- computed by the engine
  advisor_amount      numeric(14,2),            -- override; null = accept recommendation
  current_amount      numeric(14,2) not null default 0,  -- Σ existing coverages
  reason_codes        text[] not null default '{}',      -- e.g. {'NEW_MORTGAGE','DEPENDENT_CHILDREN'}
  engine_version      text not null,
  unique (plan_id, insured_member_id, rider_key)
);

-- -----------------------------------------------------------------------------
-- 7. Retirement  (mirrors dochodkova-kalkulacka.html DEFAULTS)
-- -----------------------------------------------------------------------------
create table retirement_profiles (
  plan_id                  uuid primary key references financial_plans(id) on delete cascade,
  retirement_age           int not null default 64,
  payout_end_age           int not null default 85,
  target_monthly_income_today numeric(14,2) not null,   -- target in today's money
  state_pension_mode       text not null default 'estimate' check (state_pension_mode in ('estimate','manual')),
  state_pension_manual     numeric(14,2),
  years_worked             int,
  avg_lifetime_wage        numeric(14,2),
  payout_mode              text not null default 'annuity' check (payout_mode in ('annuity','interest_only')),
  payout_return_pct        numeric(7,3) not null default 4,
  include_rental_income    boolean not null default true    -- count rental properties as passive income
);

-- -----------------------------------------------------------------------------
-- 8. Income scaling (5th module)
-- -----------------------------------------------------------------------------
create table income_growth_plans (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references financial_plans(id) on delete cascade,
  member_id            uuid references household_members(id),
  strategy             text not null check (strategy in
                         ('promotion','job_change','side_business','self_employment',
                          'rental_income','education','other')),
  label                text,
  extra_net_monthly    numeric(14,2) not null,
  start_date           date not null,
  ramp_up_months       int not null default 0,
  probability_pct      numeric(7,3) not null default 100,   -- engine can weight scenarios
  required_investment  numeric(14,2) not null default 0,     -- course, equipment, ...
  allocation_rule      jsonb                                  -- e.g. {"invest":50,"lifestyle":30,"debt":20}
);
create index on income_growth_plans(plan_id);

-- -----------------------------------------------------------------------------
-- 9. Engine output, documents, webhooks
-- -----------------------------------------------------------------------------
-- Frozen result of the "brain". The webhook payload is built from this.
create table plan_results (
  plan_id          uuid primary key references financial_plans(id) on delete cascade,
  engine_version   text not null,
  computed_at      timestamptz not null default now(),
  summary          jsonb not null,   -- net worth, cashflow before/after, KPIs
  projections      jsonb not null,   -- year-by-year series per module
  recommendations  jsonb not null,   -- ordered action list with reason codes
  warnings         jsonb not null default '[]',
  input_hash       text not null     -- detects stale results after edits
);

create table plan_documents (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references financial_plans(id) on delete cascade,
  kind                text not null default 'financial_plan' check (kind in ('financial_plan','addendum','other')),
  storage_path        text,          -- Supabase Storage key of the generated PDF
  signature_provider  text,          -- e.g. 'docusign','signi','dokobit'
  envelope_id         text,
  status              text not null default 'pending' check (status in
                        ('pending','generated','sent','viewed','signed','declined','expired','failed')),
  sent_at             timestamptz,
  signed_at           timestamptz,
  created_at          timestamptz not null default now()
);
create index on plan_documents(plan_id);

-- Transactional outbox: the API writes a row in the same transaction as the
-- plan submission; a worker delivers it to Make.com with retries.
create table webhook_outbox (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references financial_plans(id) on delete cascade,
  event_type       text not null,                 -- 'plan.submitted', 'plan.recalculated', ...
  target           text not null default 'make',
  payload          jsonb not null,
  idempotency_key  text not null unique,
  status           text not null default 'pending' check (status in ('pending','delivering','delivered','failed','dead')),
  attempts         int  not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status_code int,
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);
create index on webhook_outbox(status, next_attempt_at);

-- Inbound callbacks from Make / e-signature provider (PDF ready, signed, ...).
create table webhook_inbox (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,
  external_event_id text not null,
  payload          jsonb not null,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (source, external_event_id)
);

-- -----------------------------------------------------------------------------
-- 10. Derived views (current state, before any planned changes)
-- -----------------------------------------------------------------------------
create view v_plan_net_worth as
select p.id as plan_id,
       coalesce(a.total, 0)                        as total_assets,
       coalesce(a.liquid, 0)                       as liquid_assets,
       coalesce(l.total, 0)                        as total_liabilities,
       coalesce(a.total, 0) - coalesce(l.total, 0) as net_worth
from financial_plans p
left join (select plan_id,
                  sum(current_value * ownership_share_pct / 100) as total,
                  sum(current_value * ownership_share_pct / 100) filter (where is_liquid) as liquid
           from assets group by plan_id) a on a.plan_id = p.id
left join (select plan_id, sum(outstanding_balance) as total
           from liabilities group by plan_id) l on l.plan_id = p.id;

create view v_plan_cashflow as
select p.id as plan_id,
       coalesce(i.net, 0)       as net_income,
       coalesce(e.total, 0)     as living_expenses,
       coalesce(e.essential, 0) as essential_expenses,
       coalesce(d.total, 0)     as debt_payments,
       coalesce(ins.total, 0)   as insurance_premiums,
       coalesce(inv.total, 0)   as investment_contributions,
       coalesce(i.net, 0) - coalesce(e.total, 0) - coalesce(d.total, 0)
         - coalesce(ins.total, 0) - coalesce(inv.total, 0) as free_cashflow
from financial_plans p
left join (select plan_id, sum(net_monthly * months_per_year / 12) as net
           from income_sources
           where (starts_on is null or starts_on <= current_date)
             and (ends_on   is null or ends_on   >  current_date)
           group by plan_id) i on i.plan_id = p.id
left join (select plan_id, sum(monthly_amount) as total,
                  sum(monthly_amount) filter (where is_essential) as essential
           from expenses group by plan_id) e on e.plan_id = p.id
left join (select plan_id, sum(monthly_payment) as total
           from liabilities group by plan_id) d on d.plan_id = p.id
left join (select plan_id, sum(monthly_premium) as total
           from insurance_policies where status = 'existing' group by plan_id) ins on ins.plan_id = p.id
left join (select a.plan_id, sum(ia.monthly_contribution) as total
           from investment_accounts ia join assets a on a.id = ia.asset_id
           group by a.plan_id) inv on inv.plan_id = p.id;

-- -----------------------------------------------------------------------------
-- 11. Row-level security: an advisor sees only their own clients
-- -----------------------------------------------------------------------------
create or replace function owns_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients where id = cid and advisor_id = auth.uid());
$$;

create or replace function owns_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from financial_plans fp join clients c on c.id = fp.client_id
                 where fp.id = pid and c.advisor_id = auth.uid());
$$;

-- Blocks edits to a plan once it is sent for signature.
create or replace function plan_is_editable(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from financial_plans where id = pid and locked_at is null);
$$;

alter table advisors enable row level security;
create policy advisor_self on advisors using (id = auth.uid()) with check (id = auth.uid());

alter table clients enable row level security;
create policy client_owner on clients using (advisor_id = auth.uid()) with check (advisor_id = auth.uid());

alter table household_members enable row level security;
create policy member_owner on household_members using (owns_client(client_id)) with check (owns_client(client_id));

alter table financial_plans enable row level security;
create policy plan_owner on financial_plans using (owns_client(client_id)) with check (owns_client(client_id));

-- Plan-scoped input tables: read if owned, write only while unlocked.
do $$
declare t text;
begin
  foreach t in array array['income_sources','expenses','assets','liabilities',
                           'planned_property_purchases','financial_goals','security_profiles',
                           'insurance_policies','insurance_recommendations','retirement_profiles',
                           'income_growth_plans']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (owns_plan(plan_id))', t || '_read', t);
    execute format('create policy %I on %I for all using (owns_plan(plan_id) and plan_is_editable(plan_id))
                    with check (owns_plan(plan_id) and plan_is_editable(plan_id))', t || '_write', t);
  end loop;
end $$;

-- Subtype tables are keyed by asset_id.
alter table properties enable row level security;
create policy properties_owner on properties
  using (owns_plan((select plan_id from assets where id = asset_id)));
alter table investment_accounts enable row level security;
create policy investment_accounts_owner on investment_accounts
  using (owns_plan((select plan_id from assets where id = asset_id)));

alter table insurance_coverages enable row level security;
create policy coverages_owner on insurance_coverages
  using (owns_plan((select plan_id from insurance_policies where id = policy_id)));

-- Output / integration tables: advisors read, only the service role writes.
alter table plan_results   enable row level security;
create policy plan_results_read on plan_results for select using (owns_plan(plan_id));
alter table plan_documents enable row level security;
create policy plan_documents_read on plan_documents for select using (owns_plan(plan_id));
alter table webhook_outbox enable row level security;   -- service role only
alter table webhook_inbox  enable row level security;   -- service role only
alter table statutory_parameters enable row level security;
create policy statutory_read on statutory_parameters for select using (true);
