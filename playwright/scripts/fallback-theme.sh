#!/usr/bin/env bash
# Builds a throw-away child theme of Hyvä default for the custom-theme fallback spec (07 · Build Brief §6):
# the gallery container is renamed (#gallery-custom), so OpenLabel's automatic injection cannot find it and the
# theme renders the label child block itself, exactly as docs/storefront.md tells theme developers to.
# The template is derived from the installed Hyvä copy at run time; nothing from Hyvä is committed here.
set -euo pipefail
root="${MAGENTO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
theme="$root/app/design/frontend/OpenLabelE2e/fallback"
source_gallery="$root/vendor/hyva-themes/magento2-default-theme/Magento_Catalog/templates/product/view/gallery.phtml"
# The fallback is written for the gallery markup of Hyvä 1.3/1.4. Hyvä 1.5 rebuilt the gallery (#gallery-main is a
# scroll track there); exit 3 so the spec reports it as not applicable.
if ! grep -q '<div id="gallery-main" class="relative mb-6"' "$source_gallery"; then
  echo "unsupported gallery markup in $source_gallery (Hyvä 1.5+?)" >&2
  exit 3
fi
mkdir -p "$theme/Magento_Catalog/templates/product/view"
cat > "$theme/registration.php" <<'PHP'
<?php
\Magento\Framework\Component\ComponentRegistrar::register(
    \Magento\Framework\Component\ComponentRegistrar::THEME,
    'frontend/OpenLabelE2e/fallback',
    __DIR__
);
PHP
cat > "$theme/theme.xml" <<'XML'
<?xml version="1.0"?>
<theme xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:Config/etc/theme.xsd">
    <title>OpenLabel e2e fallback (renamed gallery container)</title>
    <parent>Hyva/default</parent>
</theme>
XML
# Rename the container and render the label child right inside it (the documented fallback, one line).
sed -e 's#<div id="gallery-main" class="relative mb-6"\([^>]*\)>#<div id="gallery-custom" class="relative mb-6"\1><?= $block->getChildHtml('"'"'openlabel.product.labels'"'"') ?>#' \
    "$source_gallery" > "$theme/Magento_Catalog/templates/product/view/gallery.phtml"
grep -q 'id="gallery-custom"' "$theme/Magento_Catalog/templates/product/view/gallery.phtml"
grep -q "getChildHtml('openlabel.product.labels')" "$theme/Magento_Catalog/templates/product/view/gallery.phtml"
echo "$theme"
