# V0 is a deterministic read-only inventory

The product originally considered semantic analysis and configuration management, but v0 is deliberately limited to deterministic filesystem discovery: it does not read artifact contents, use an LLM, or mutate files. This keeps the first release locally inspectable and safe while preserving web editing and optional LLM assistance as separately designed later versions.
