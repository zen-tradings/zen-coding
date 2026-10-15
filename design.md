# Design principles (2026-10)

1. One package, every repository. General engineering is the default; research
   workflows are invoked (`/alpha`, `/beta-audit`, ...), not a separate product and not a
   directory you must `cd` into.
2. Pi stays the harness. zen-coding adds behavior on top of the agent loop, the TUI,
   sessions, and model providers. Do not fork that loop.
3. If it is not in the `pi` manifest, it does not travel. Extensions, prompts, and skills
   are declared on the package (`package.json` -> `pi`). Project files inside the checkout
   are not a distribution mechanism; no git submodules.
4. Enforce at the tool boundary anything a prompt cannot be trusted to remember. A
   checklist in `/alpha` is not a guardrail.
5. Quant rules are path-scoped. `shift(-n)`, early `fit`, and `inplace=True` apply to
   research code only and never fire on frontend or deploy files. Generic safety
   (destructive shell, secrets, writes outside the project) applies everywhere.
6. Prompts, skills, and extensions are different layers: a prompt is an explicit
   checklist; a skill is a reusable procedure the agent can load; an extension is code
   that can block or record a tool call.
7. Do not override the user's model. Default-model settings stay local to the checkout.
8. Connectors are user-level (`~/.pi/agent/mcp.json`, merged with `npm run connectors`).
   `.pi/mcp.json` is the source list; pi packages cannot ship MCP entries.
9. An edit-time warning beats a failed eval later, but only on the files where the
   warning is meaningful.
10. Evals cover both jobs: a dashboard change, a deploy dry-run, and research verifiers
    (beta audit first, then portfolio construction) that fail on lookahead. A prose note
    is not a verifier.

# Choose of Framework
criteria of choosing agent harness framework

# User Interaction
## 1.Direct Message in Slack and coding agent run in the backend completely
1.1 When user @ this coding agent in slack channel with a specific github link or a request, it can instantly access to the code based and update the code.
1.2 When the query is not clear, it could firstly ask follow-up question to clarify and then start to plan
1.3 Support /command to choose different mode to develop

## 2.TUI Based
2.1 The interaction mode like Claude Code

# Use Cases:
- Maintenance of large code based
- Context Window/Retrieval Infra
- Quant Research Domain specific guardrail
- Sandbox and security for some certain test


# MCP/Tool Used:
- Github Code Connector
- Exa Search, particularly code search
- Exa Web Search
- Proprietary Data Search/Connector

# Observability
- Multi-round Reasoning traces during planning and developing
- Tool calling record
- Logging Record and output logging
- Metadata like cost/latency

# 🌟 Priority of building verifier/eval dataset
1. Beta-audit
2. Portfolio construction

# Benchmarking 
Finalizing which benchmarkings are suitable to test, like Marketbench

Dimension: cost/latency under same task define (public open source agent & zen coding agent)

# System Design Issue to Consider
- Is this solving the right user problem?
- Which parts should be tested first?
- How does the design behave under load?
- What would make the system easier for the next engineer?


# Quant Related Guardrail 🆕
 - shift(-, t-1 indexing into future rows, .fit( before a train/test split → lookahead bias                                                                       
 - inplace=True on shared DataFrames → cross-contamination between experiments                                                                                    
 - Writes to production data dirs / model artifacts / live-trading configs → protected paths                                                                      
 - Backtests without transaction costs or with  survivorship-prone universes → warn                                                                               
                                                                                                                                                                  
 This is your most differentiating piece vs. a generic coding agent — a warning at edit time beats a failed eval later.         


# Quant skills (.pi/skills/) matching your eval priorities    
- beta-audit
- alpha-research
- backtest
- paper-replication

# Real eval cases


# Reproducibility in traces  

# Proprietary data connector
