-- The Strategist's model (worker/src/agents/model.ts MODELS.strategist; the AI
-- Gateway's id, which anthropicModelId turns into Anthropic's claude-fable-5-1 on
-- a tenant's own key), at Anthropic's API prices on 2026-10-10: $10 input, $50
-- output, $0.25 cache reads per million tokens; cache writes at 1.25x input.
-- Through our gateway a call is priced at the gateway's reported cost either way;
-- this row prices a tenant's run on its own key, which reports no cost of its own.
-- A data row only: the table's grants are unchanged.
insert into public.model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
values ('anthropic/claude-fable-5.1', 10.00, 50.00, 0.25, 12.50);
