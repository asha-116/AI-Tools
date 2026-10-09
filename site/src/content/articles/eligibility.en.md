---
title: 'Home loan eligibility calculator'
description: 'Calculate the maximum home loan a buyer can get based on income, FOIR and interest rate.'
slug: 'eligibility'
lang: en
tool_path: '/tools/eligibility/'
last_verified: '2026-10-09'
generated: '2026-10-09'
generated_by: 'agent:seo-listing'
producer_family: 'gpt'
status: 'draft'
---

# Home loan eligibility calculator

Agents often need to tell buyers how much loan they can realistically get. This calculator shows the maximum home loan based on the buyer’s monthly take‑home ₹1,00,000, the bank’s FOIR limit 50%, any existing EMIs, the loan interest rate 8.5% and the desired tenure 20 years. It returns the highest EMI the borrower can afford (₹50,000) and the loan amount that matches that EMI (₹57,61,542). Use it during initial discussions to set clear expectations before property shortlisting.

## How to use the calculator

1. Enter the buyer’s monthly take‑home ₹1,00,000 in the first field.
2. Select the bank’s FOIR limit 50% or type the value given by the bank.
3. Add the total of all existing EMIs.
4. Choose the loan interest rate 8.5% and the tenure 20 years.
5. Click Calculate. The screen will show the maximum affordable EMI (₹50,000) and the corresponding loan amount (₹57,61,542).

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

The loan amount is computed from the EMI that fits the borrower’s budget. First, the allowable EMI is ( ₹1,00,000 × 50% ) minus existing EMIs. This amount is the EMI the borrower can still take. The loan formula converts that EMI into a principal: Loan = EMI × (1 − (1 + r)^‑n) ÷ r, where r is the monthly rate (yearly rate 8.5% divided by 12 and 100) and n is the total months ( 20 years × 12 ).

### Assumptions

- FOIR limits differ by bank and by income (often 40% to 60% of take-home pay). Ask the bank for its limit.
- Banks also cap the loan at a share of the property value, and check credit score, age and job. The bank’s offer can be lower.
- Own money needed = property price − largest loan. Stamp duty, registration and fees are extra.
- The interest rate stays the same for the whole loan.

## When it helps

Use the tool when a buyer asks for loan eligibility during property visits, when you prepare a loan summary for a client, or when comparing affordability across different interest rates. It does not replace the bank’s formal sanction, which also checks credit score, age, job stability and property‑value caps. The calculator does not include stamp duty, registration fees or other closing costs.

## Frequently asked questions

### How is the eligible loan amount calculated?

The tool uses the borrower’s monthly take‑home ₹1,00,000, the bank’s FOIR limit 50%, existing EMIs and the loan interest 8.5% over the chosen 20 years to compute the maximum EMI (₹50,000) and the corresponding loan amount (₹57,61,542).

### What does FOIR mean?

FOIR is the fraction of take‑home income that banks allow for EMI repayment; it varies by bank and borrower profile.

### Can I include other debts in the calculation?

Enter the total of all existing EMIs; the tool subtracts them from the allowable EMI before computing the loan.

### Does the calculator consider property price?

It shows the loan you can afford; the buyer must still provide the difference between property price and the loan as down payment.

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
