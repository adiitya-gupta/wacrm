# Contributing to Wattomation by OPSIYS

Thank you for your interest in contributing to **Wattomation by OPSIYS**!

## Development Guidelines

1. **Local Setup**:
   ```bash
   git clone https://github.com/adiitya-gupta/wattomation-by-opsiys.git
   cd wattomation-by-opsiys
   npm install
   cp .env.local.example .env.local
   npm run dev
   ```

2. **Quality & Validation Standards**:
   Before submitting changes, ensure all project checks pass:
   - `npm test` — Run the full automated test suite (100% pass rate required).
   - `npx tsc --noEmit` — Typecheck without errors.
   - `npm run build` — Verify production build compiles cleanly.
   - `git diff --check` — Ensure no whitespace or syntax defects.

3. **Security Principles**:
   - **Multi-Tenant Isolation**: All database queries must enforce Supabase Row-Level Security (RLS) and verify tenant account contexts.
   - **Secret Protection**: Never commit credentials, private keys, `.env` files, or service-role keys.
   - **Fail-Closed Architecture**: All authorization, webhook signature verifications, and rate limiters must fail closed when dependencies are missing or unconfigured.

## Reporting Issues

If you encounter a bug or unexpected behavior, please file an issue on [GitHub Issues](https://github.com/adiitya-gupta/wattomation-by-opsiys/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Relevant error logs (with sensitive keys redacted)

## License

By contributing to Wattomation, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
