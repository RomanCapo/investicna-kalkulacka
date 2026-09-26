// Ukážkový klient pre plan.html („Načítať ukážkového klienta“).
// Profil + uložené vstupy kalkulačiek; výsledky (summary) vznikli spustením
// kalkulačiek s týmito vstupmi.

(function (global) {
  "use strict";

  global.SAMPLE_STATE = {
    version: 1,
    meta: { date: "2026-09-26" },
    advisor: { name: "Roman Čapák", company: "Finančné a realitné poradenstvo", nbsRegNumber: "000000", email: "roman.capak95@gmail.com", phone: "" },
    client: { firstName: "Martin", lastName: "Kováč", birthDate: "1990-04-12", age: null, email: "martin.kovac@example.com", phone: "+421 900 000 000", yearsWorked: 13, retirementAge: 64 },
    household: {
      partner: { enabled: true, firstName: "Jana", birthDate: "1992-01-20", netIncome: 1400 },
      children: [{ firstName: "Tomáš", birthDate: "2021-06-02" }],
    },
    finances: {
      grossIncome: 2800, netIncome: 0, netManual: false, otherIncome: 0, breadwinner: true,
      livingExpenses: 1600, essentialExpenses: 1250, currentInvesting: 250, insurancePremiums: 45,
      liquidSavings: 9500, otherAssets: 214000, reserveMonths: 6,
    },
    loans: [
      { name: "Hypotéka – byt Petržalka", kind: "mortgage", balance: 142000, monthlyPayment: 690, ratePct: 3.9 },
      { name: "Úver na auto", kind: "car", balance: 7900, monthlyPayment: 210, ratePct: 8.9 },
    ],
    assumptions: { inflationPct: 3 },
    links: { investmentForRetirement: true },
    goals: {
      housing: { selected: true, note: "Výmena bytu za väčší, keď Tomáš začne chodiť do školy." },
      retirement: { selected: true, note: "Dôchodok 2 200 € mesačne v dnešných cenách od 64 rokov." },
      investments: { selected: true, note: "Pravidelne investovať 150 € mesačne na 20 rokov." },
      security: { selected: true, note: "Zabezpečiť rodinu a splatenie hypotéky pri smrti alebo invalidite." },
      incomeScaling: { selected: false, note: "" },
    },
    contracts: [
      { id: "c1", type: "life_risk", provider: "Allianz", number: "7012345678", insured: "client", subject: "", sumInsured: 0,
        premium: 45, frequency: 12, startDate: "2019-05-01", endDate: "2049-05-01",
        riders: { death: 40000, inv41: 15000, ci: 10000, injury: 20000, pn: 10 } },
      { id: "c2", type: "accident", provider: "Generali", number: "UR-558120", insured: "child:0", subject: "", sumInsured: 0,
        premium: 12, frequency: 12, startDate: "2022-02-01", endDate: "",
        riders: { injury: 20000, hosp: 15, daily: 10 } },
      { id: "c3", type: "property_combined", provider: "Kooperativa", number: "4400123987", insured: "client", subject: "Byt Petržalka, Romanova 12", sumInsured: 185000,
        premium: 168, frequency: 1, startDate: "2021-03-15", endDate: "", riders: {} },
      { id: "c4", type: "liability_civil", provider: "Kooperativa", number: "4400123988", insured: "client", subject: "Domácnosť, 50 000 €", sumInsured: 50000,
        premium: 24, frequency: 1, startDate: "2021-03-15", endDate: "", riders: {} },
      { id: "c5", type: "mtpl", provider: "Allianz", number: "PZP-2231907", insured: "client", subject: "Škoda Octavia, BA123XY", sumInsured: 0,
        premium: 186, frequency: 1, startDate: "2023-11-10", endDate: "", riders: {} },
      { id: "c6", type: "casco", provider: "Allianz", number: "HAV-2231908", insured: "client", subject: "Škoda Octavia, BA123XY", sumInsured: 18000,
        premium: 420, frequency: 1, startDate: "2023-11-10", endDate: "", riders: {} },
      { id: "c7", type: "travel", provider: "Union", number: "CP-90155", insured: "client", subject: "celoročné, celá rodina, Európa", sumInsured: 0,
        premium: 79, frequency: 1, startDate: "2025-06-01", endDate: "", riders: {} },
    ],
    branding: { primary: "#0f6b5c", companyName: "Finančné a realitné poradenstvo", footerNote: "", logo: null },
    modules: {
      "investments": {
        "inputs": {
          "x": 5000,
          "m": 150,
          "y": 0.4,
          "p": 0,
          "k": 1,
          "z": 7,
          "n": 20,
          "offerName": "Globálne akciové ETF"
        },
        "summary": {
          "offerName": "Globálne akciové ETF",
          "principal": 5000,
          "monthly": 150,
          "returnPct": 7,
          "costPct": 0.4,
          "entryFeePct": 0,
          "years": 20,
          "finalValue": 93511.02,
          "totalInvested": 41000,
          "netProfit": 52511.02,
          "costs": 5277.48,
          "yearly": [
            {
              "year": 0,
              "invested": 5000,
              "value": 5000
            },
            {
              "year": 1,
              "invested": 6800,
              "value": 7205.83
            },
            {
              "year": 2,
              "invested": 8600,
              "value": 9561.74
            },
            {
              "year": 3,
              "invested": 10400,
              "value": 12077.92
            },
            {
              "year": 4,
              "invested": 12200,
              "value": 14765.29
            },
            {
              "year": 5,
              "invested": 14000,
              "value": 17635.49
            },
            {
              "year": 6,
              "invested": 15800,
              "value": 20700.96
            },
            {
              "year": 7,
              "invested": 17600,
              "value": 23974.99
            },
            {
              "year": 8,
              "invested": 19400,
              "value": 27471.76
            },
            {
              "year": 9,
              "invested": 21200,
              "value": 31206.43
            },
            {
              "year": 10,
              "invested": 23000,
              "value": 35195.18
            },
            {
              "year": 11,
              "invested": 24800,
              "value": 39455.3
            },
            {
              "year": 12,
              "invested": 26600,
              "value": 44005.25
            },
            {
              "year": 13,
              "invested": 28400,
              "value": 48864.75
            },
            {
              "year": 14,
              "invested": 30200,
              "value": 54054.85
            },
            {
              "year": 15,
              "invested": 32000,
              "value": 59598.06
            },
            {
              "year": 16,
              "invested": 33800,
              "value": 65518.4
            },
            {
              "year": 17,
              "invested": 35600,
              "value": 71841.51
            },
            {
              "year": 18,
              "invested": 37400,
              "value": 78594.81
            },
            {
              "year": 19,
              "invested": 39200,
              "value": 85807.56
            },
            {
              "year": 20,
              "invested": 41000,
              "value": 93511.02
            }
          ]
        },
        "extra": null,
        "savedAt": "2026-09-26T09:00:00.000Z"
      },
      "retirement": {
        "inputs": {
          "age": 36,
          "retAge": 64,
          "endAge": 85,
          "pensionMode": "estimate",
          "wage": 2800,
          "yearsWorked": 13,
          "avgWage": 1600,
          "adh": 19.76,
          "manualPension": 900,
          "p2Enabled": true,
          "p2Balance": 11800,
          "p2Rate": 4,
          "p2Return": 5,
          "p2Years": 10,
          "p2PastRate": 5,
          "p3Enabled": true,
          "p3Balance": 6200,
          "p3Client": 50,
          "p3Employer": 40,
          "p3Dyn": 0,
          "p3Return": 4.5,
          "target": 2200,
          "investEnabled": true,
          "savings": 3000,
          "monthly": 150,
          "dynamization": 3,
          "returnAcc": 7,
          "costs": 1,
          "payoutMode": "annuity",
          "returnPay": 4,
          "inflation": 3
        },
        "summary": {
          "age": 36,
          "retAge": 64,
          "endAge": 85,
          "target": 2200,
          "statePension": 1106.74,
          "p2Renta": 313.35,
          "p3Renta": 159.2,
          "renta": 377.29,
          "basePension": 1579.3,
          "totalIncome": 1956.59,
          "gap": 243.41,
          "requiredMonthly": 255.42,
          "investEnabled": true,
          "savings": 3000,
          "monthly": 150,
          "returnAcc": 7,
          "costs": 1,
          "capitalNom": 195380.03,
          "p2Enabled": true,
          "p2Balance": 11800,
          "p2Monthly": 112,
          "p2Return": 5,
          "p3Enabled": true,
          "p3Balance": 6200,
          "p3Client": 50,
          "p3Employer": 40,
          "p3Return": 4.5,
          "inflation": 3
        },
        "extra": null,
        "savedAt": "2026-09-26T09:00:00.000Z"
      },
      "security": {
        "inputs": {
          "mode": "adult",
          "gross": 2800,
          "net": 0,
          "netManual": false,
          "loans": 149900,
          "age": 36,
          "retAge": 64,
          "yearsWorked": 13,
          "invPct": 40,
          "breadwinner": true,
          "partner": true,
          "children": 1,
          "supportYears": 15,
          "childAge": 5,
          "premium": 95,
          "adh": 19.76,
          "vvz": 1524
        },
        "summary": {
          "net": 2026,
          "gross": 2800,
          "loans": 149900,
          "premium": 95,
          "budgetLo": 101.3,
          "budgetHi": 202.6,
          "familyNeed": 251608.33,
          "deathSum": 203524,
          "adult": [
            {
              "key": "death",
              "label": "Smrť",
              "unit": "€",
              "value": 203524,
              "current": 40000,
              "rec": 203524
            },
            {
              "key": "invDecr",
              "label": "Invalidita s klesajúcou poistnou sumou",
              "unit": "€",
              "value": 149900,
              "current": 0,
              "rec": 149900
            },
            {
              "key": "inv41",
              "label": "Invalidita jednorazová (41 %)",
              "unit": "€",
              "value": 48624,
              "current": 15000,
              "rec": 48624
            },
            {
              "key": "inv40r",
              "label": "Invalidita renta (40 %)",
              "unit": "€ / mes.",
              "value": 1430,
              "current": 0,
              "rec": 1430
            },
            {
              "key": "ci",
              "label": "Závažné ochorenia",
              "unit": "€",
              "value": 24300,
              "current": 10000,
              "rec": 24300
            },
            {
              "key": "injury",
              "label": "Trvalé následky úrazu",
              "unit": "€",
              "value": 40000,
              "current": 20000,
              "rec": 40000
            },
            {
              "key": "pn",
              "label": "Práceneschopnosť",
              "unit": "€ / deň",
              "value": 25,
              "current": 10,
              "rec": 25
            }
          ],
          "child": [
            {
              "key": "injury",
              "label": "Trvalé následky úrazu",
              "unit": "€",
              "value": 60000,
              "current": 20000,
              "rec": 60000
            },
            {
              "key": "ci",
              "label": "Závažné ochorenia",
              "unit": "€",
              "value": 20000,
              "current": 10000,
              "rec": 20000
            },
            {
              "key": "childInv",
              "label": "Invalidita dieťaťa",
              "unit": "€",
              "value": 30000,
              "current": 0,
              "rec": 30000
            },
            {
              "key": "hosp",
              "label": "Hospitalizácia",
              "unit": "€ / deň",
              "value": 20,
              "current": 15,
              "rec": 20
            }
          ],
          "childAge": 5
        },
        "extra": {
          "riderState": {
            "adult": {
              "death": {
                "on": true,
                "value": null,
                "current": 40000
              },
              "invDecr": {
                "on": true,
                "value": null,
                "current": 0
              },
              "inv41": {
                "on": true,
                "value": null,
                "current": 15000
              },
              "inv40r": {
                "on": true,
                "value": null,
                "current": 0
              },
              "inv71": {
                "on": false,
                "value": null,
                "current": 0
              },
              "inv70r": {
                "on": false,
                "value": null,
                "current": 0
              },
              "ci": {
                "on": true,
                "value": null,
                "current": 10000
              },
              "injury": {
                "on": true,
                "value": null,
                "current": 20000
              },
              "pn": {
                "on": true,
                "value": null,
                "current": 10
              },
              "surgery": {
                "on": false,
                "value": null,
                "current": 0
              },
              "hosp": {
                "on": false,
                "value": null,
                "current": 0
              },
              "daily": {
                "on": false,
                "value": null,
                "current": 0
              }
            },
            "child": {
              "injury": {
                "on": true,
                "value": null,
                "current": 20000
              },
              "ci": {
                "on": true,
                "value": null,
                "current": 10000
              },
              "childInv": {
                "on": true,
                "value": null,
                "current": 0
              },
              "hosp": {
                "on": true,
                "value": null,
                "current": 15
              },
              "surgery": {
                "on": false,
                "value": null,
                "current": 0
              },
              "daily": {
                "on": false,
                "value": null,
                "current": 0
              },
              "death": {
                "on": false,
                "value": null,
                "current": 0
              }
            }
          },
          "compare": true,
          "childUsed": true
        },
        "savedAt": "2026-09-26T09:00:00.000Z"
      }
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
