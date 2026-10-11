#!/usr/bin/env bash
# Installs OpenLabel on the fixture store exactly as the README tells a stranger to: the commands between
# <!-- install:start --> and <!-- install:end --> in iranimij/openlabel's README (at OPENLABEL_REF), run from the
# Magento root one by one. The store was built with OPENLABEL_INSTALL=none; nothing else is done here, so a README
# that forgets a step fails this job.
set -euo pipefail

: "${MAGENTO_ROOT:?}" "${OPENLABEL_REF:=main}"
readme="$(mktemp)"
curl -fsSL "https://raw.githubusercontent.com/iranimij/openlabel/${OPENLABEL_REF}/README.md" -o "$readme"
commands="$(awk '/<!-- install:start -->/{on=1; next} /<!-- install:end -->/{on=0} on' "$readme" \
  | sed -n '/^```/,/^```/p' | grep -v '^```' | sed '/^[[:space:]]*$/d')"
if [ -z "$commands" ]; then
  echo "No install commands between <!-- install:start --> and <!-- install:end --> in the README (${OPENLABEL_REF})"
  exit 1
fi
cd "$MAGENTO_ROOT"
while IFS= read -r command; do
  echo "::group::README: $command"
  bash -euo pipefail -c "$command"
  echo "::endgroup::"
done <<< "$commands"
