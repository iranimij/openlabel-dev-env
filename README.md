# OpenLabel fixture store

The reproducible store used to develop and test [OpenLabel](https://github.com/iranimij/openlabel): Magento Open Source 2.4.9 with sample data, the Hyvä default theme 1.4.2, Varnish on, storefront CSP in enforce mode, and the Playwright suite.

## Layout

| Path | Purpose |
|---|---|
| `.env`, `.warden/` | Warden environment (`openlabel.test`, PHP 8.3, MariaDB 10.6, OpenSearch, Redis, Varnish 7.5) |
| `bin/setup` | Builds the whole store from scratch (create-project, install, sample data, Hyvä, modules, config) |
| `bin/install-hyva`, `bin/install-modules` | The two steps you repeat most |
| `hyva/` (not committed) | Hyvä OSL packages used as a Composer path repository |
| `modules/` (not committed) | Checkouts of `module-base`, `openlabel`, `openlabel-hyva`, symlinked into `vendor/` |
| `playwright/` | End-to-end tests and the Hyvä hook verification |
| `admin.env` (not committed) | Admin and database credentials; see `admin.env.example` |

## First run

```bash
cp admin.env.example admin.env   # edit the password
warden sign-certificate openlabel.test && warden env up -d
bin/setup
cd playwright && npm ci && npx playwright install chromium && npx playwright test
```

Store: https://app.openlabel.test/ · Admin: https://app.openlabel.test/admin

## Tests

```bash
cd playwright
npx playwright test     # admin (1 worker) → custom-theme fallback → storefront desktop + mobile
npm run lighthouse      # OpenLabel on vs off: CLS, score, one stylesheet, no JS (writes lighthouse-report/)
OL_SCREENSHOTS=1 npx playwright test --project=screenshots-chromium tests/screenshots/readme-gif.spec.ts
                        # the GIF at the top of OpenLabel's README (needs ffmpeg; writes modules/openlabel/docs/assets)
```

Specs reach the database and `bin/magento` through `playwright/tests/fixture.ts`: Warden locally, plain shell in CI (`OL_FIXTURE=shell`).

## CI (`.github/workflows/e2e.yml`)

On `main`, pull requests touching `ci/`, `playwright/` or the workflow, nightly and on demand: `ci/install-fixture.sh` builds Magento 2.4.9 with sample data from the public Magento mirror, Hyvä 1.4.2 from Hyvä's public OSL repositories on GitHub and OpenLabel from the `main` branches; nginx + PHP-FPM behind Varnish, storefront CSP enforced. Then Playwright and the Lighthouse gate; reports are uploaded as artifacts. The CI VCL has no health probe and adds `X-Cache`; no Hyvä Composer keys are needed.

## Notes

- `wardenenv/opensearch:2.12` crashes the JVM on Apple Silicon; `.warden/warden-env.yml` pins `opensearchproject/opensearch:2.5.0`.
- Composer `require`/`install` of dist packages must run with `--no-plugins` inside the container; the Magento Composer plugins make archive extraction fail (`directory does not exist`). The scripts do this.
- Mutagen ignores `pub/media`, `pub/static` and `var/`; logs from background installs live in the container (`/tmp/*.log`).
- Admin two-factor authentication is disabled on this fixture (`Magento_TwoFactorAuth`, `Magento_AdminAdobeImsTwoFactorAuth`) so Playwright and the browser can log in. Never do this on a real store.
- Nothing from any paid extension is ever installed here (clean-room rule of the project).
