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
## High Priority
1. Beta-audit
2. Portfolio construction
3. Fundamental analysis
4. wq-alpha-research
5. quant paper research

## Low Priority
1. Quant-pipeline
2. Quant-research

# Benchmarking 
Finalizing which benchmarkings are suitable to test, like Marketbench

Dimension: cost/latency under same task define (public open source agent & zen coding agent)

# System Design Issue to Consider
- Is this solving the right user problem?
- Which parts should be tested first?
- How does the design behave under load?
- What would make the system easier for the next engineer?


# Quant Related Guardrail


# Quant skills (.pi/skills/) matching your eval priorities    


# Real eval cases


# Reproducibility in traces  

# Proprietary data connector
