# Knowledge base

One Markdown file per support topic, each with EN + HI reply templates. The Support agent
(`agents/support`) answers **only** with these templates — never with free LLM text. Never
include real customer data.

## Template format

```markdown
# Title (for humans)

<!-- support-template
id: download-link-help        # file name without .md
category: download_issue      # download_issue | refund_request | how_to | bug
product: lead-tracker         # optional, how_to only (products/catalog.json id)
status: draft                 # draft | approved
-->

Notes for humans (ignored by the agent).

## en

English reply…

## hi

Hindi reply…
```

- **Placeholders** such as `{payment_id}` are filled by the agent _locally_, after the LLM call,
  from the redaction map (`agents/lib` `restore`). Template text is never sent to an LLM. Both
  languages must use the same placeholders (tested). When the buyer did not give a value, the
  text in [`placeholders.md`](placeholders.md) is used instead.
- **`status: draft`** templates are never sent to a buyer: in a live run the agent holds the
  reply and opens one `needs-owner` Issue. The owner changes a template to `approved` in a PR
  after the Hindi text has been reviewed by a human (AGENTS.md "Bilingual").
- Every refund is escalated to the owner (agent threshold ₹0 in
  `company/policies/refund-policy.md`); `refund-request-received` only acknowledges it.

## Templates

| File                                                       | Category         | Used when                            |
| ---------------------------------------------------------- | ---------------- | ------------------------------------ |
| [download-link-help.md](download-link-help.md)             | `download_issue` | links expired / page did not work    |
| [how-to-lead-tracker.md](how-to-lead-tracker.md)           | `how_to`         | question about the lead tracker      |
| [how-to-commission-ledger.md](how-to-commission-ledger.md) | `how_to`         | question about the commission ledger |
| [how-to-general.md](how-to-general.md)                     | `how_to`         | template not named, or both / bundle |
| [refund-request-received.md](refund-request-received.md)   | `refund_request` | acknowledgement; owner decides       |
| [bug-report-received.md](bug-report-received.md)           | `bug`            | acknowledgement + redacted bug Issue |

`other`, low-confidence messages and legal threats get no automatic reply: they go to the owner.
