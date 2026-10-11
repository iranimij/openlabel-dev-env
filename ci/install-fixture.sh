#!/usr/bin/env bash
# Builds the OpenLabel fixture store on a GitHub Actions runner (the CI twin of bin/setup, without Warden):
# Magento Open Source + sample data from the public Magento mirror, Hyvä from its public OSL repositories on
# GitHub, OpenLabel from the main branches. MariaDB, OpenSearch and Redis run as job services; nginx + PHP-FPM
# serve on :8080 and Varnish on :80, so the shop is http://localhost/ with Varnish in front, CSP enforced.
set -euo pipefail

: "${MAGENTO_ROOT:?}" "${MAGENTO_VERSION:=2.4.9}" "${HYVA_THEME_VERSION:=1.4.2}" "${HYVA_MODULE_VERSION:=1.5.2}"
: "${DB_HOST:=127.0.0.1}" "${DB_NAME:=magento}" "${DB_USER:=magento}" "${DB_PASSWORD:=magento}"
: "${ADMIN_USER:?}" "${ADMIN_PASSWORD:?}"
export MIRROR=https://repo-magento-mirror.fooman.co.nz/
mysql_q() { mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -B -e "$1"; }

echo "::group::Composer project"
if [ -n "${GITHUB_TOKEN:-}" ]; then composer config -g github-oauth.github.com "$GITHUB_TOKEN"; fi
composer create-project --no-interaction --no-progress --no-install --repository-url="$MIRROR" \
  "magento/project-community-edition=$MAGENTO_VERSION" "$MAGENTO_ROOT"
cd "$MAGENTO_ROOT"
# The project template points at repo.magento.com (needs keys); use only the public mirror.
php -r '$f = "composer.json"; $c = json_decode(file_get_contents($f), true);
  $c["repositories"] = ["magento-mirror" => ["type" => "composer", "url" => getenv("MIRROR")]];
  file_put_contents($f, json_encode($c, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");'
grep -q repo.magento.com composer.json && { echo "repo.magento.com still configured"; exit 1; }
for repo in default-theme theme-module base-layout-reset email-module graphql-tokens graphql-view-model \
            order-cancellation-webapi compat-module-fallback mollie-theme-bundle; do
  composer config "repositories.hyva-$repo" vcs "https://github.com/hyva-themes/magento2-$repo"
done
for repo in module-base openlabel openlabel-hyva; do
  composer config "repositories.iranimij-$repo" vcs "https://github.com/iranimij/$repo"
done
composer config minimum-stability dev
composer config prefer-stable true
composer config --no-plugins allow-plugins.magento/composer-dependency-version-audit-plugin false
composer config --no-plugins allow-plugins.magento/* true
composer config --no-plugins allow-plugins.laminas/laminas-dependency-plugin true
composer config --no-plugins allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
composer config --no-plugins allow-plugins.php-http/discovery true
sample=""
for m in bundle catalog-rule catalog cms configurable customer downloadable grouped-product msrp offline-shipping \
         product-links review sales-rule sales swatches tax theme widget wishlist; do
  sample="$sample magento/module-$m-sample-data:100.4.*"
done
# shellcheck disable=SC2086
composer require --no-update --no-interaction $sample "magento/sample-data-media:100.4.*" \
  "hyva-themes/magento2-default-theme:$HYVA_THEME_VERSION" "hyva-themes/magento2-theme-module:$HYVA_MODULE_VERSION" \
  "iranimij/module-base:^1.0" "iranimij/openlabel:dev-main" "iranimij/openlabel-hyva:dev-main"
composer install --no-interaction --no-progress --prefer-dist
echo "::endgroup::"

echo "::group::setup:install"
bin/magento setup:install --no-interaction \
  --base-url=http://localhost/ --backend-frontname=admin \
  --db-host="$DB_HOST" --db-name="$DB_NAME" --db-user="$DB_USER" --db-password="$DB_PASSWORD" \
  --search-engine=opensearch --opensearch-host=127.0.0.1 --opensearch-port=9200 --opensearch-enable-auth=0 \
  --http-cache-hosts=127.0.0.1:80 \
  --session-save=redis --session-save-redis-host=127.0.0.1 --session-save-redis-db=2 \
  --cache-backend=redis --cache-backend-redis-server=127.0.0.1 --cache-backend-redis-db=0 \
  --admin-user="$ADMIN_USER" --admin-password="$ADMIN_PASSWORD" --admin-email=admin@openlabel.test \
  --admin-firstname=Open --admin-lastname=Label \
  --language=en_US --currency=EUR --timezone=Europe/Berlin --use-rewrites=1
# No two-factor auth and no first-login popups (usage data, release notes) over the dashboard (fixture only).
bin/magento module:disable Magento_TwoFactorAuth Magento_AdminAdobeImsTwoFactorAuth Magento_AdminAnalytics \
  Magento_ReleaseNotification
bin/magento setup:upgrade --no-interaction
echo "::endgroup::"

echo "::group::Store configuration"
theme_id="$(mysql_q "SELECT theme_id FROM theme WHERE theme_path = 'Hyva/default'")"
bin/magento config:set design/theme/theme_id "$theme_id"
bin/magento config:set system/full_page_cache/caching_application 2
bin/magento config:set admin/security/use_form_key 0
mysql_q "INSERT INTO core_config_data (scope, scope_id, path, value) VALUES ('default', 0, 'csp/mode/storefront/report_only', '0') ON DUPLICATE KEY UPDATE value = '0'"
bin/magento indexer:reindex
bin/magento openlabel:css:regenerate
bin/magento cache:flush
echo "::endgroup::"

echo "::group::Varnish VCL"
bin/magento varnish:vcl:generate --backend-host=127.0.0.1 --backend-port=8080 --access-list=127.0.0.1 \
  --export-version=6 --output-file=/tmp/default.vcl
# CI: no health probe. The generated probe asks for the page with Host 127.0.0.1, which Magento (base URL
# http://localhost/) answers with a redirect, so Varnish would mark the only backend sick.
perl -0pi -e 's/\n[ \t]*\.probe = \{.*?\n[ \t]*\}//s' /tmp/default.vcl
grep -q 'sub vcl_recv' /tmp/default.vcl
if grep -q '\.probe' /tmp/default.vcl; then echo 'probe still in the VCL'; exit 1; fi
# X-Cache HIT/MISS like the local Warden fixture, for the cache specs.
sed -i 's/^sub vcl_deliver {/sub vcl_deliver {\n    if (obj.hits > 0) { set resp.http.X-Cache = "HIT"; } else { set resp.http.X-Cache = "MISS"; }/' /tmp/default.vcl
echo "::endgroup::"
