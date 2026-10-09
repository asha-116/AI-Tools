---
title: 'Home Loan Eligibility Calculator'
description: 'Calculate the maximum home loan amount a buyer can get based on income, FOIR, rate and tenure.'
slug: 'eligibility'
lang: en
tool_path: '/tools/eligibility/'
last_verified: '2026-10-09'
generated: '2026-10-09'
generated_by: 'agent:seo-listing'
producer_family: 'gpt'
status: 'draft'
---

# Home Loan Eligibility Calculator

The Home Loan Eligibility Calculator helps agents quickly estimate the highest loan amount a buyer can obtain. It uses the buyer’s monthly take‑home income, the bank’s FOIR limit, the interest rate and the loan tenure. By entering these four inputs, the tool shows the EMI the buyer can afford and the corresponding loan size. This is useful during property tours, initial consultations or when preparing a loan summary for the buyer. The result is shown as an EMI of ₹50,000 and a loan amount of ₹57,61,542. No personal data is stored.

## How to use the calculator

1. Open the calculator on your phone. 2. Enter the buyer’s monthly take‑home income (e.g., ₹1,00,000). 3. Select the bank’s FOIR percentage (e.g., 50%). 4. Input the current annual interest rate (e.g., 8.5%). 5. Choose the loan tenure (e.g., 20 years). 6. Tap Calculate. The screen will display the maximum EMI and the loan amount.

[Open the calculator: Home loan eligibility calculator](/tools/eligibility/)

## Worked example

| Input                      |     Value |
| -------------------------- | --------: |
| Take-home income per month | ₹1,00,000 |
| Bank’s FOIR limit          |       50% |
| Interest rate (per year)   |      8.5% |
| Tenure                     |  20 years |

| Result        |      Value |
| ------------- | ---------: |
| EMI that fits |    ₹50,000 |
| Largest loan  | ₹57,61,542 |

_Example inputs from a published worked example; results computed by the same code the calculator uses._

## How it is calculated

- Loan = (income × FOIR% − existing EMIs) × (1 − (1 + r)^−n) ÷ r
- r = yearly rate ÷ 12 ÷ 100, n = months. The bracket is the EMI you can still take on; the loan is the amount whose EMI equals it.

The formula converts the affordable EMI into a loan amount. Loan = (income × FOIR − existing EMIs) × (1 − (1 + r)^−n) ÷ r. _income_ is the monthly take‑home. _FOIR_ is the bank’s allowed share of income for EMI. _existing EMIs_ are other loan repayments (enter 0 if none). _r_ is the monthly interest rate, derived from the annual rate 8.5% divided by 12 and 100. _n_ is the total number of months, tenure 20 years multiplied by 12. The term (1 − (1 + r)^−n) ÷ r converts the EMI into the present value of the loan.

### Assumptions

- FOIR limits differ by bank and by income (often 40% to 60% of take-home pay). Ask the bank for its limit.
- Banks also cap the loan at a share of the property value, and check credit score, age and job. The bank’s offer can be lower.
- Own money needed = property price − largest loan. Stamp duty, registration and fees are extra.
- The interest rate stays the same for the whole loan.

## When it helps

Use this calculator when a buyer asks how much loan they can get, when you need a quick eligibility check before showing properties, or when preparing a loan summary for a client meeting. It is also handy for comparing different interest rates or tenures. The tool does not consider credit score, property‑price caps, stamp duty, registration fees or other bank‑specific criteria. For those details, ask the bank or the buyer’s financial advisor.

## Frequently asked questions

### What does FOIR mean and why does it matter?

FOIR is the Fixed Obligation to Income Ratio. It tells the bank what share of the buyer’s take‑home income can go to loan EMIs. A higher FOIR allows a larger EMI.

### Should I enter existing EMIs in the calculator?

Yes. Include any other loan repayments the buyer is already paying. If there are none, enter zero. This reduces the EMI the buyer can still take.

### Can I change the interest rate to see its impact?

Absolutely. Adjust the rate field to the current market rate or the rate offered by a specific bank and recalculate. The loan amount will change accordingly.

### Why might the bank offer less than the calculator shows?

Banks also look at credit score, property price caps, age, job stability and other criteria. The calculator shows the theoretical maximum based on income and FOIR only.

## Related tools

- [EMI calculator](/tools/emi/)
- [Commission split calculator](/tools/commission/)
- [Stamp duty & registration calculator](/tools/stamp-duty/)
- [Land area converter](/tools/area/)
- [Home loan prepayment calculator](/tools/prepayment/)
- [Carpet area and real price per sq ft](/tools/carpet-area/)
- [Rental yield calculator](/tools/rental-yield/)
- [Rent vs buy calculator](/tools/rent-vs-buy/)
- [All tools](/)

## Sources

- <https://homefirstindia.com/blog/article/home-loan-eligibility-on-a-100000-salary/>
- <https://eligibilitytools.in/guides/home-loan-eligibility-india/>
- <https://www.utkarsh.bank.in/blogs/how-much-home-loan-can-i-get-salary-foir-rules>

> For estimation only — verify with a professional. Rates and rules vary by state and change over time; last verified on 2026-10-09. This is not legal, tax or financial advice.
