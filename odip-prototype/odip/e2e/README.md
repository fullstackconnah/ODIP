# ODIP end-to-end tests

Playwright tests that drive the real frontend against the real API and PostgreSQL.
Own npm project, kept out of `frontend/` so Vitest, ESLint and the production image build never see it.

Run recipes are added with the local stack scripts. Settings come from `E2E_BASE_URL` (default
`http://127.0.0.1:8475`) and `E2E_API_URL` (default `http://127.0.0.1:5000`).
