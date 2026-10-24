-- The Strategist's model (worker/src/agents/model.ts MODELS.strategist, the AI Gateway's id
-- anthropic/claude-opus-5.5), at Anthropic's API prices on 2026-10-24: $4 input, $20 output,
-- $0.20 cache reads per million tokens; cache writes at 1.25x input.
-- Through our gateway a call is priced at the gateway's reported cost either way; this row
-- prices a tenant's run on its own key, which reports no cost of its own.
-- A data row only: the table's grants are unchanged. Approved by Ayadi, 2026-10-24
-- (file 20261010000220_model_price_opus_55.sql).
insert into public.model_prices (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
values ('anthropic/claude-opus-5.5', 4.00, 20.00, 0.20, 5.00);
