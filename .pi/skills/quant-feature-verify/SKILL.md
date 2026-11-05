---
name: quant-feature-verify
description: >-
  Confirm whether a quant-related feature or logic already exists,
  then verify its correctness. Always start with graph search,
  then read the implementation, then apply the quant checklist.
  Triggers: "does this exist", "is this implemented", "check feature",
  lookahead, point-in-time, cost model, slippage, risk check.
---

# Quant Feature Verify

When the user asks whether a feature/logic already exists or wants
correctness verification on quant code, follow this process exactly.
Do not skip steps.

## Process

### 1. Graph-first location (required)
Use pi-cbm tools:
- `search_graph` / `resolve_symbol` to locate the symbol
- `trace_path` to inspect call relationships when relevant
- If the symbol is ambiguous, fail closed and return candidates.
  Do not guess.

### 2. Read the implementation (required)
- Use `read_symbol` or a precise `read` on the located code
- Also check related config, parameters, and utility functions
  (quant logic often hides there)

### 3. Quant checklist (required)
For each relevant item, state pass / fail / not-applicable with evidence:

- Lookahead / future function
- Point-in-time protection (as_of or equivalent)
- Cost model completeness (commission + slippage + impact)
- Risk check on critical path
- Data alignment / timezone / calendar
- Hardcoded parameters vs configurable

### 4. Output format
Always end with:

**Conclusion**: Implemented and correct | Implemented with issues | Not found

**Evidence**:
- file:line — quote or short description

**Issues** (if any):
- list with file:line