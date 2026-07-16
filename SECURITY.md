# Security

## Secrets

- Do not commit `.env`, `.runtime/`, API keys, account tokens, or exchange credentials.
- The dashboard never returns a plaintext Whale Alert API Key to the browser.
- A replacement Whale Alert key is persisted only after a successful provider validation.
- Local credential files are plaintext local secrets and are not a substitute for an operating-system credential vault.
- Message aggregator configuration accepts only HTTP/HTTPS URLs without embedded credentials.

## Network Scope

- The dashboard binds to `127.0.0.1` only.
- The project is paper-alert-only and does not submit live orders.
- External data providers can fail, throttle, change schemas, or return incomplete data.
- RSS and hot-list content is treated as untrusted input. The monitor strips markup and the dashboard escapes rendered text.
- Configure only aggregator endpoints you control or trust; validation causes the local dashboard to request every configured URL.

## Reporting

For a private repository, report security issues directly to the repository owner. Do not place credentials or sensitive logs in GitHub Issues.
