# AI providers: choose the service and the model, replace expired keys, keep keys safe
Objective: the user chooses the judgment service and the LLM provider, and the model for each. Branch: feat/ai-providers. Delivery: one release (0.2.0) when all tasks are green. Test runner: `make test`.

## Specs
S1. "non voglio legarmi solo ad anthropic, dovrei avere anche modo di selezionare servizio AI tra i più conosciuti come openai, gemini, Qwen,..." — LLM providers: anthropic, openai, gemini, qwen.
S2. "Anche per Jev stessa cosa con Laya ed altri" — judgment services speaking POST /v1/systemone: typesafe (Jev), laya (self-hosted), ollama (local).
S3. "dovrei poter anche scegliere il modello da usare in base al provider selezionato" — the model is chosen per provider from its model list.
S4. "se la chiave è scaduta deve anche darmi possibilità di cambiarla con una nuova e questo vale anche per typesafe Jev" — each key can be replaced; a refused key says so and points to Settings.
S5. "Mi raccomando alla sicurezza delle chiavi API" — keys only in the OS keychain; keys sent only to approved HTTPS hosts or to loopback; never in files, logs or messages.
S6. Assumption: the model list endpoints are GET /v1/models (TypeSafe documented; OpenAI and Anthropic standard; Ollama GET /api/tags). Marked unverified until a live check.

## Tasks
T1 | S5 | endpoint allowlist (job-agent) | inline | done: endpoints.test.ts, 6 pass
T2 | S2 | System One services typesafe, ollama, laya (job-agent) | inline | done: judgment-services.test.ts, 7 pass
T3 | S1 | LLM providers anthropic, openai, gemini, qwen (job-agent) | inline | done: llm-providers.test.ts, planner and intake routed through it; suite 295 pass
T4 | S4,S5 | desktop: keys and Verifica per provider, model list (Rust) | inline | pending
T5 | S1,S3,S4 | Settings UI: provider and model selection, key replace (UI) | inline | pending

## Log
L1 (user, verbatim): see Specs quotes above, from the Italian conversation.
L2 Route: all tasks inline, no delegation; each task is one understood change.
