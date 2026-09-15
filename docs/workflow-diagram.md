# Borrowing Approval Workflow

```mermaid
stateDiagram-v2
    [*] --> Pending: Requester submits\n(BR-A4-01, BR-A4-09)
    Pending --> Approved: Administrator approves\n(BR-A4-02, BR-A4-03)
    Pending --> Rejected: Administrator rejects\n(BR-A4-03)
    Approved --> Released: Staff/Admin releases\n(BR-A4-04, BR-A4-05)
    Released --> Overdue: Past due date
    Released --> Returned: Staff/Admin processes return\n(BR-A4-06, BR-A4-08)
    Overdue --> Returned: Staff/Admin processes return\n(BR-A4-06, BR-A4-08)
    Returned --> Closed: Administrator closes
    Rejected --> [*]
    Closed --> [*]
```

Every transition writes an `audit_logs` entry (BR-A4-10). Rejected requests have no path to Released (BR-A4-07) — the state machine makes that transition structurally impossible.
