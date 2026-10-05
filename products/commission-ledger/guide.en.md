# Commission ledger — how to use it

This sheet shows the commission on every deal, what you have received, what is still pending and
how much goes to a co-broker. It works in Google Sheets and in Excel.

## 1. Open the file

**Google Sheets (recommended, works on your phone too)**

1. Go to [sheets.google.com](https://sheets.google.com) and open a blank sheet.
2. Click **File → Import → Upload** and choose `changelens-commission-ledger.xlsx`.
3. Pick **Replace spreadsheet** and click **Import data**.

Or upload the `.xlsx` to Google Drive, open it, and click **File → Save as Google Sheets**.

**Excel:** just double-click the file.

## 2. First steps

1. Open the **Deals** sheet. Delete the sample rows if there are any.
2. Add one row per deal. Give each deal a short **Deal ID** such as `D-001` — you will use it on
   the Payments sheet.
3. Enter the **Deal value** and either a **Commission %** _or_ a **fixed commission** amount.
   If you fill both, the fixed amount is used.
4. **GST %:** if you charge GST on your commission, type the rate yourself for that deal. The
   sheet has no tax rate built in. Leave it empty if you do not charge GST.
5. If you share the deal with another broker, fill **Co-broker** and **Co-broker share %**.

TDS is not included in this sheet. The sheet only does the arithmetic; it is not tax advice. Ask
your CA which taxes apply to you.

## 3. The grey columns fill themselves

Columns with a grey background hold formulas. Do not type in them.

- **Commission** = deal value × commission %, or your fixed amount.
- **GST** = commission × the GST % you entered.
- **Total to bill** = commission + GST.
- **Received** adds up every payment on the **Payments** sheet with the same Deal ID.
- **Pending** = total to bill − received (never below zero).
- **Payment status** shows _Due_, _Part paid_ or _Paid_.
- **Co-broker amount** and **My share** split the commission by the co-broker share %.
- **Summary** shows the totals for all deals.

If a grey cell stays empty, check that the deal value and commission (or the fixed amount) are
filled in.

## 4. Routine

1. **When a deal is closed:** add it to **Deals** the same day.
2. **When money comes in:** add a row in **Payments** — date, Deal ID, amount, mode and the
   UTR/reference number. Received, Pending and Payment status update on their own.
3. **Once a week:** sort or filter **Deals** by Payment status to see who still owes you, and
   follow up.
4. **Month end:** check **Summary** for what you billed, received and what is still pending.

## Tips

- The Deal ID on Payments must match the Deals sheet exactly (`D-001`, not `D 001`).
- One payment = one row, even if a client pays in many parts.
- Keep this file private; it holds your clients' names and your income.
