# Experimental compaction qualification

Run on 2026-07-17 against a frozen synthetic coding-session fixture. This is a development qualification, not a general model-quality ranking.

## Method

- 36 atomic checks: 12 early-history, 12 cut-boundary, and 12 exact retained-suffix facts.
- 24 checks actually depended on generated-summary recall; the 12 recent checks exercised rebuilt context with Pi's deterministic suffix.
- Eight absent-fact traps checked unsupported additions.
- Initial matrix: Luna and Sol at off, low, and medium.
- Perfect initial candidates were repeated twice. High was skipped because lower efforts were conclusive.

The evaluator used conservative literal/normalized term matching. One early-history check (`active Pi model` plus `thinking level`) represented an older requirement superseded by the later fixed benchmark-selected summarizer decision, so omission is not necessarily a semantic failure. Results should therefore be read alongside the summaries, not as a universal percentage score.

## Results

| Model | Effort | Runs | 36-check recall | 24 summarized-fact recall | Trap hits | Mean latency | Mean reported cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| Luna | off | 3 | 100%, 100%, 97.2% | 100%, 100%, 95.8% | 0 | 18.4s | $0.00634 |
| Luna | low | 3 | 100%, 100%, 97.2% | 100%, 100%, 95.8% | 0 | 15.7s | $0.00535 |
| Luna | medium | 1 | 97.2% | 95.8% | 0 | 21.9s | $0.00586 |
| Sol | off | 1 | 97.2% | 95.8% | 0 | 20.9s | $0.03600 |
| Sol | low | 3 | 100%, 100%, 94.4% | 100%, 100%, 91.7% | 0 | 18.1s | $0.03082 |
| Sol | medium | 1 | 94.4% | 91.7% | 0 | 16.5s | $0.02853 |

## Selection

`openai-codex/gpt-5.6-luna` at `low` was selected. It tied Luna/off on observed recall and hallucination traps while using fewer output tokens, lower reported cost, and lower mean latency. Sol had no fidelity advantage and cost roughly six times as much on this fixture.

Benchmark-only model/effort controls and the temporary runner were removed from the shipped extension. The selected values are fixed in `summarize.ts`; normal Pi use exposes only `on`, `off`, and `status`.
