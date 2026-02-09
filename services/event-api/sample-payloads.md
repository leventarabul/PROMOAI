# Event API Sample Payloads

## Valid Payload

```json
{
  "user_id": "u_001",
  "type": "purchase",
  "transaction_id": "tx_987",
  "amount": 250,
  "category": "grocery",
  "timestamp": "2026-02-09T10:30:00Z",
  "context": {"channel": "mobile"}
}
```

## Invalid Payload (missing transaction_id)

```json
{
  "user_id": "u_001",
  "type": "purchase",
  "amount": 250,
  "category": "grocery",
  "timestamp": "2026-02-09T10:30:00Z",
  "context": {"channel": "mobile"}
}
```
