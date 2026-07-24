#!/usr/bin/env bash
# Testy, commit i wypchnięcie na GitHub Pages.
# Użycie: bash tools/publikuj.sh TWOJA-NAZWA [nazwa-repozytorium]

set -euo pipefail

UZYTKOWNIK="${1:-}"
REPO="${2:-mapa-projektow}"

if [ -z "$UZYTKOWNIK" ]; then
  echo "Użycie: bash tools/publikuj.sh TWOJA-NAZWA [nazwa-repozytorium]"
  exit 1
fi

cd "$(dirname "$0")/.."

if command -v npm >/dev/null 2>&1; then
  echo "→ testy"
  npm install --silent >/dev/null 2>&1 || true
  npm test
else
  echo "→ pomijam testy, brak npm"
fi

echo "→ git"
[ -d .git ] || git init -q
git add -A
git commit -q -m "Mapa projektów: $(date +%Y-%m-%d\ %H:%M)" || echo "  nic nowego do zapisania"
git branch -M main
git remote get-url origin >/dev/null 2>&1 || \
  git remote add origin "https://github.com/$UZYTKOWNIK/$REPO.git"
git push -u origin main

cat <<KONIEC

Gotowe. Zostało jedno kliknięcie:
  https://github.com/$UZYTKOWNIK/$REPO/settings/pages
  Source: Deploy from a branch → main → / (root) → Save

Za kilka minut:
  https://${UZYTKOWNIK,,}.github.io/$REPO/
KONIEC
