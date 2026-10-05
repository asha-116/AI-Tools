# Lead & site-visit tracker — how to use it

This sheet keeps every enquiry in one place and tells you each morning who to call. It works in
Google Sheets and in Excel.

## 1. Open the file

**Google Sheets (recommended, works on your phone too)**

1. Go to [sheets.google.com](https://sheets.google.com) and open a blank sheet.
2. Click **File → Import → Upload** and choose `changelens-lead-tracker.xlsx`.
3. Pick **Replace spreadsheet** and click **Import data**.

Or upload the `.xlsx` to Google Drive, open it, and click **File → Save as Google Sheets**.

**Excel:** just double-click the file. Excel 365 or Excel 2021 is best (older versions may not
show the "Call today" list).

## 2. First steps

1. Open the **Leads** sheet. Delete the sample rows if there are any.
2. Add your current enquiries, one row per person. Fill at least **Date added**, **Name** and
   **Status**.
3. For **Source**, **Looking to**, **Property type** and **Status**, pick from the drop-down
   list. Keeping to the list makes the Summary correct.
4. Put a **Next follow-up** date on every lead you are still working on.

## 3. The grey columns fill themselves

Columns with a grey background hold formulas. Do not type in them.

- **Follow-up** (Leads sheet) shows _Overdue_, _Today_, _Upcoming_ or _No date_, based on the
  Next follow-up date. It stays empty for leads marked _Deal done_ or _Lost_.
- **Call today** lists everyone whose follow-up is today or already late, oldest first.
- **Summary** counts leads by status and by source, and shows how many closed leads became deals.

If a grey cell shows an error, check that the dates in that row are real dates (not text).

## 4. Daily routine (5 minutes)

1. **Morning:** open **Call today** and work down the list.
2. **After each call:** in **Leads**, update **Status** and **Last contacted**, and set a new
   **Next follow-up** date. The person drops off today's list on its own.
3. **After a site visit:** add a row in **Site visits** (date, lead name, property shown,
   feedback, next step) and change the lead's Status to _Site visit done_.
4. **Once a week:** look at **Summary** to see which sources bring you the most deals.

## Tips

- Keep one row per person. If the same person comes back for a new need, add a new row.
- Use **Notes** for anything that does not fit elsewhere.
- Phone numbers and names are your clients' private data. Do not share the file publicly; share
  it only with people in your office who need it.
