#!/usr/bin/env python3
"""Generate interview-ready PDF report of zen-coding eval results."""

import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import matplotlib.patches as mpatches

OUT = "/Users/yanpan/zen-coding/evals/zen-coding-eval-report.pdf"

DARK = "#1a1a2e"
ACCENT = "#0f9d58"
WARN = "#d93025"
GREY = "#5f6368"
BLUE = "#1a73e8"

plt.rcParams.update({
    "font.family": "Helvetica",
    "font.size": 10,
    "text.color": DARK,
})


def new_page(pdf, title, subtitle=None):
    fig = plt.figure(figsize=(8.5, 11))
    fig.patch.set_facecolor("white")
    fig.text(0.08, 0.95, title, fontsize=17, fontweight="bold", color=DARK)
    if subtitle:
        fig.text(0.08, 0.922, subtitle, fontsize=10, color=GREY)
    fig.lines.append(plt.Line2D([0.08, 0.92], [0.905, 0.905],
                                transform=fig.transFigure, color=ACCENT, lw=2))
    return fig


def para(fig, y, text, size=10, color=DARK, bold=False, indent=0.0, leading=0.0165):
    """Draw wrapped text, return new y."""
    import textwrap
    width = int(95 - indent * 100)
    for line in textwrap.wrap(text, width=width) or [""]:
        fig.text(0.08 + indent, y, line, fontsize=size, color=color,
                 fontweight="bold" if bold else "normal")
        y -= leading * (size / 10)
    return y


def table(fig, y, headers, rows, col_x, row_h=0.022, header_color="#e8f0fe"):
    n = len(rows) + 1
    top = y + row_h * 0.6
    rect = mpatches.FancyBboxPatch(
        (0.065, top - row_h * n), 0.87, row_h * n,
        boxstyle="round,pad=0.004", transform=fig.transFigure,
        facecolor="white", edgecolor="#dadce0", lw=1)
    fig.patches.append(rect)
    hdr = mpatches.Rectangle((0.065, top - row_h), 0.87, row_h,
                             transform=fig.transFigure,
                             facecolor=header_color, edgecolor="none")
    fig.patches.append(hdr)
    for x, h in zip(col_x, headers):
        fig.text(x, top - row_h * 0.72, h, fontsize=9.5, fontweight="bold", color=DARK)
    yy = top - row_h
    for row in rows:
        yy -= row_h
        for x, cell in zip(col_x, row):
            color = DARK
            bold = False
            if isinstance(cell, tuple):
                cell, color, bold = cell
            fig.text(x, yy + row_h * 0.28, str(cell), fontsize=9.5,
                     color=color, fontweight="bold" if bold else "normal")
    return top - row_h * n - 0.02


pdf = PdfPages(OUT)

# ---------------------------------------------------------------- Page 1: Summary
fig = new_page(pdf, "zen-coding — Eval Results & Interview Brief",
               "Domain-specific coding agent for quant research · eval harness & benchmark summary")

y = 0.875
y = para(fig, y, "Project in one sentence", bold=True, size=11)
y -= 0.004
y = para(fig, y, "zen-coding is a quant coding agent built as a thin, opinionated layer on the open-source "
                 "agent harness pi (MIT). The harness is a pinned npm dependency; everything domain-specific "
                 "lives in TypeScript extensions (guardrails, observability, modes, model registry, tools), "
                 "a Python eval harness (scripts/run_eval.py + aggregate.py), and a Slack backend on the pi SDK.")
y -= 0.012

y = para(fig, y, "Headline results", bold=True, size=11)
y -= 0.004
y = table(fig, y,
          ["Benchmark", "Baseline", "With domain layer", "Delta"],
          [
              ["paper-search skill (iter-1)", "22.5% pass", "100% pass",
               ("+77.5 pp", ACCENT, True)],
              ["paper-extract skill (iter-1)", "28.6% pass", "100% pass",
               ("+71.4 pp", ACCENT, True)],
              ["paper-replicate skill (iter-1)", "64.3% pass", "100% pass",
               ("+35.7 pp", ACCENT, True)],
              ["zen-coding own suite (iter-3)", "—", "3/3 cases pass",
               ("all assertions green", ACCENT, True)],
          ],
          [0.09, 0.42, 0.60, 0.80])
y -= 0.01

y = para(fig, y, "Why this matters (FDE framing)", bold=True, size=11)
y -= 0.004
y = para(fig, y, "• Domain grounding is measurable: same tasks, same deterministic assertions — the skill "
                 "layer lifts pass rate by 35–77 points while reducing token cost (paper-search: −26s, −2.2k tokens).")
y = para(fig, y, "• Evals as product spec: pass criteria fixed before the run; assertions are deterministic bash "
                 "on fresh checkouts at pinned commits — reproducible, no judge-model noise.")
y = para(fig, y, "• The eval caught its own blind spot: iter-3 benchmark flagged that a new feature (OpenAlex "
                 "expansion) was never exercised by any eval, and prescribed the fix — new prompts that don't "
                 "name the source. Suite grew 2 -> 4 cases.")
y = para(fig, y, "• Harness validation first: early iterations failed a trivial smoke test (agent exit 1 in ~3s) — "
                 "a harness bug, not a model bug, caught because a smoke case existed.")
y -= 0.012

y = para(fig, y, "Stated caveats", bold=True, size=11)
y -= 0.004
y = para(fig, y, "Skill A/B benchmarks used n=2 per config — directional, not precise. The zen-coding harness "
                 "now supports --runs N (fresh checkout per attempt; per-case pass rate with binomial stddev, "
                 "duration mean/stddev) and records the effective model/provider, pi version, and timestamp in "
                 "run_meta.json. Skill A/B benchmarks live in the quant_research_lab repo's eval suite; "
                 "zen-coding's own suite is evals/evals.json (3 enabled cases + 1 disabled placeholder).", color=GREY)

pdf.savefig(fig)
plt.close(fig)

# ---------------------------------------------------------------- Page 2: zen-coding suite
fig = new_page(pdf, "zen-coding Eval Suite — Results by Iteration",
               "scripts/run_eval.py · fresh checkout per case · deterministic bash assertions (exit 0 = pass)")

y = 0.875
y = table(fig, y,
          ["Iteration", "Cases run", "Passed", "Notes"],
          [
              ["iteration-1", "smoke-hello", ("0/1", WARN, True),
               "agent exit 1 after 3.8s — harness failure, no work done"],
              ["iteration-2", "3 cases", ("2/3", WARN, True),
               "real cases pass; smoke-hello fails again (exit 1, 3.1s)"],
              ["iteration-3", "3 cases", ("3/3", ACCENT, True),
               "harness fixed — full pass"],
              ["iteration-4", "smoke-hello (2 runs)", ("2/2 runs", ACCENT, True),
               "multi-run verified; model provenance recorded (kimi-k3 / openrouter)"],
          ],
          [0.09, 0.28, 0.46, 0.58])
y -= 0.012

y = para(fig, y, "iteration-3 case detail (latest, all passing)", bold=True, size=11)
y -= 0.004
y = table(fig, y,
          ["Case", "Track", "Duration", "Assertions"],
          [
              ["smoke-hello", "infra", "8.3s", ("1/1", ACCENT, False)],
              ["deploy-add-dry-run", "deploy-strategy", "32.8s", ("4/4", ACCENT, False)],
              ["research-note-momentum-2022", "quant-research", "43.2s", ("4/4", ACCENT, False)],
          ],
          [0.09, 0.42, 0.62, 0.74])
y -= 0.012

y = para(fig, y, "What each case proves", bold=True, size=11)
y -= 0.004
y = para(fig, y, "• smoke-hello — proves the loop works end-to-end (checkout -> headless run -> assertion). "
                 "Exists precisely because iterations 1–2 showed you can't trust a benchmark until the "
                 "harness itself is validated.")
y = para(fig, y, "• deploy-add-dry-run — agent adds a --dry-run flag to a real deploy script. Assertions: still "
                 "valid bash (bash -n), announces DRY RUN, never invokes git pull / docker compose up, "
                 "existing behavior unchanged.")
y = para(fig, y, "• research-note-momentum-2022 — agent writes a 200–400 word quant research note. Assertions: "
                 "file exists, word count in range, contains a real citation, mentions a mitigation technique.")
y -= 0.012

y = para(fig, y, "Harness design", bold=True, size=11)
y -= 0.004
y = para(fig, y, "Case = (repo, base_commit, prompt, assertions[]). Each attempt: clone repo at pinned commit "
                 "-> run pi headless (npx pi -p) -> run assertions in the checkout -> result.json + full "
                 "agent.jsonl transcript. --runs N repeats attempts on fresh checkouts (attempts/attempt-k/) and "
                 "aggregates pass_rate +/- binomial stddev; a case passes only if ALL attempts pass. "
                 "run_meta.json records effective model/provider (CLI flags, else pi settings.json defaults), "
                 "pi version, runs_per_case, timestamp. Tracks group cases by workload "
                 "(infra | deploy-strategy | quant-research) for per-track pass rates. aggregate.py folds an "
                 "iteration into benchmark.json with per-case stats and regression diffing vs the previous "
                 "iteration. Disabled placeholder case (newsletter-smoke) shows the enabled:false convention.")

pdf.savefig(fig)
plt.close(fig)

# ---------------------------------------------------------------- Page 3: A/B chart
fig = new_page(pdf, "Skill A/B Benchmarks — Domain Layer vs. Baseline",
               "quant_research_lab eval suite · with_skill vs. without_skill · deterministic assertions")

ax = fig.add_axes([0.12, 0.52, 0.78, 0.32])
skills = ["paper-search", "paper-extract", "paper-replicate"]
without = [22.5, 28.6, 64.3]
with_ = [100, 100, 100]
x = range(len(skills))
b1 = ax.bar([i - 0.19 for i in x], without, width=0.36, color="#dadce0",
            label="without skill (baseline)")
b2 = ax.bar([i + 0.19 for i in x], with_, width=0.36, color=ACCENT,
            label="with domain skill")
for b, v in zip(b1, without):
    ax.text(b.get_x() + b.get_width() / 2, v + 2, f"{v}%", ha="center", fontsize=10, color=GREY)
for b, v in zip(b2, with_):
    ax.text(b.get_x() + b.get_width() / 2, v + 2, "100%", ha="center", fontsize=10,
            color=ACCENT, fontweight="bold")
ax.set_xticks(list(x))
ax.set_xticklabels(skills, fontsize=11)
ax.set_ylabel("pass rate (%)")
ax.set_ylim(0, 118)
ax.spines[["top", "right"]].set_visible(False)
ax.legend(loc="lower right", frameon=False)
ax.set_title("Pass rate by skill (iteration-1 A/B, n=2 per config)", fontsize=11, color=DARK)

y = 0.44
y = para(fig, y, "Cost & latency detail (with_skill vs. baseline)", bold=True, size=11)
y -= 0.004
y = table(fig, y,
          ["Skill", "Δ pass rate", "Δ time", "Δ tokens"],
          [
              ["paper-search", ("+77.5 pp", ACCENT, True), ("−26.3s (faster)", ACCENT, False),
               ("−2.2k (cheaper)", ACCENT, False)],
              ["paper-extract", ("+71.4 pp", ACCENT, True), "+8.6s", ("−1.3k (cheaper)", ACCENT, False)],
              ["paper-replicate", ("+35.7 pp", ACCENT, True), "+34.3s", "+0.8k"],
          ],
          [0.09, 0.35, 0.55, 0.75])
y -= 0.012
y = para(fig, y, "Reading: the domain skill is not a tax — on paper-search it is simultaneously much more "
                 "reliable, faster, and cheaper. Where it costs more time (paper-replicate), the task is "
                 "inherently longer (plan + backtest) and the baseline's speed came from failing early.")
y -= 0.008
y = para(fig, y, "Interview line", bold=True, size=11)
y -= 0.004
y = para(fig, y, "“The base agent without domain context failed most of the time on these tasks; adding the "
                 "skill layer took it to 100% while reducing token cost. That delta is the quantified value "
                 "of forward-deployed domain work.”", color=BLUE)

pdf.savefig(fig)
plt.close(fig)

# ---------------------------------------------------------------- Page 4: iteration story + caveats
fig = new_page(pdf, "Eval-Driven Iteration — the paper-search Skill over 5 Iterations",
               "The benchmark as a feedback loop, including catching its own blind spot")

y = 0.875
y = para(fig, y, "iter-1 — Baseline A/B", bold=True)
y = para(fig, y, "with_skill 100% vs. without_skill 22.5%. Established that the skill matters at all.", indent=0.02)
y -= 0.006
y = para(fig, y, "iter-2 — Patch validation", bold=True)
y = para(fig, y, "SKILL.md patch validated: bare-id path ~26% faster, 5 fewer tool calls (root cause: http-to-https "
                 "redirect bug). A 419s outlier on keyword-search was correctly attributed to arxiv 503/429 "
                 "rate-limiting — environmental noise, not a skill regression. Verdict: safe to promote to team_skills.",
         indent=0.02)
y -= 0.006
y = para(fig, y, "iter-3 — The eval catches its own blind spot", bold=True)
y = para(fig, y, "New OpenAlex-primary skill: non-regressive on arxiv-coded prompts (both configs 100%). But the "
                 "benchmark itself flagged: “the OpenAlex feature was not actually exercised in either eval — "
                 "every prompt says 'arxiv' explicitly, so the scope expansion is invisible in this benchmark.” "
                 "Prescribed fix: prompts that don't name a source.", indent=0.02)
y -= 0.006
y = para(fig, y, "iter-4 / iter-5 — Closing the gap", bold=True)
y = para(fig, y, "Suite grew 2 -> 4 cases (date-range filter, SSRN-heavy-topic honesty, topic-no-source-bias). "
                 "Stable at 95.8% mean pass rate. Old-skill parity confirmed (no regression from the expansion).",
         indent=0.02)
y -= 0.014

y = para(fig, y, "Gap analysis (state before being asked)", bold=True, size=11)
y -= 0.004
y = para(fig, y, "Closed in the latest iteration:", bold=True)
y = para(fig, y, "• Model provenance — run_meta.json now records effective model/provider (CLI or settings.json "
                 "defaults), pi version, runs_per_case, timestamp. Unblocks cross-model cost/latency benchmarking.",
         indent=0.02)
y = para(fig, y, "• Variance — --runs N executes each case N times on fresh checkouts; reports per-case "
                 "pass_rate +/- binomial stddev and duration mean/stddev. Verified on iteration-4 "
                 "(smoke-hello 2/2 runs, 8.2s +/- 0.4s).", indent=0.02)
y = para(fig, y, "Still open:", bold=True)
y = para(fig, y, "• No eval exercises the quant guardrail layer itself — the differentiating feature is "
                 "still unmeasured (want: guardrail trigger rate, blocked-violation attempts, false positives).",
         indent=0.02)
y = para(fig, y, "• Tokens recorded but not $ cost per passed task; failure taxonomy (harness vs model vs "
                 "assertion) not encoded; small suite, no public-benchmark anchor; deterministic bash only — "
                 "open-ended tasks need a rubric judge validated against human labels.", indent=0.02)
y -= 0.014

y = para(fig, y, "One-paragraph summary (memorize)", bold=True, size=11)
y -= 0.004
y = para(fig, y, "“I built deterministic, reproducible evals — fresh checkout, pinned commit, bash assertions, "
                 "fixed before the run. Two results I'd highlight: A/B benchmarking showed the domain skill "
                 "layer lifts pass rate from ~29% to 100% on paper-extraction tasks while cutting token cost — "
                 "the quantified value of domain grounding. And the suite caught its own blind spot: it proved "
                 "the skill didn't regress on arxiv prompts but couldn't validate the new OpenAlex expansion, "
                 "so I added evals targeting exactly that gap. To me that's what good eval infrastructure "
                 "looks like — it tells you what it can't measure.”", color=BLUE)

pdf.savefig(fig)
plt.close(fig)

pdf.close()
print("wrote", OUT)
