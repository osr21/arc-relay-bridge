---
name: Express BigInt JSON serialization
description: drizzle mode:"bigint" returns native JS BigInt which Express JSON.stringify can't serialize
---

## Rule
When drizzle columns use `mode: "bigint"`, rows returned from DB queries contain native JS `BigInt` values. `res.json()` (which calls `JSON.stringify`) throws `TypeError: Do not know how to serialize a BigInt`.

**Why:** JavaScript's `JSON.stringify` has no built-in BigInt handler. Express delegates serialization to it.

**How to apply:**
Add this once in `app.ts`, before any routes:
```typescript
app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value
);
```
This globally converts all BigInt values to strings in every `res.json()` call across all routes. No per-route changes needed. Strings are the correct wire format for large integer fields (block numbers, amounts) that would lose precision as JSON numbers.
