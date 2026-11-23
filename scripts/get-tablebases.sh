#!/usr/bin/env bash
# Download the Syzygy 3-4-5 piece endgame tablebases (290 files, about 940 MB)
# into data/syzygy, from lichess's mirror over HTTPS, and check every file
# against the published SHA-256 checksums. Safe to run again: finished files are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${TIMUR_DATA_DIR:-$(pwd)/data}/syzygy"
BASE="https://tablebase.lichess.ovh/tables/standard"
mkdir -p "$DEST"

echo "Reading the checksums from $BASE/sha256 ..."
SUMS="$DEST/.sha256"
curl -fsS "$BASE/sha256" -o "$SUMS.part" && mv "$SUMS.part" "$SUMS"

list() { curl -fsS "$BASE/$1/" | grep -oE 'href="[A-Za-z]+\.rtb[wz]"' | sed -e 's/^href="//' -e 's/"$//' | sed "s#^#$1/#"; }
LIST="$( { list 3-4-5-wdl; list 3-4-5-dtz; } | sort -u)"
TOTAL="$(printf '%s\n' "$LIST" | wc -l | tr -d ' ')"
[ "$TOTAL" -ge 290 ] || { echo "Expected 290 files, the server lists $TOTAL. Stopping." >&2; exit 1; }

fetch() {
  local path="$1" dest="$2" base="$3" sums="$4"
  local name="${path##*/}"
  [ -s "$dest/$name" ] && return 0
  curl -fsS --retry 3 -o "$dest/$name.part" "$base/$path" || return 1
  local want got
  want="$(awk -v n="$name" '$2 == n { print $1; exit }' "$sums")"
  got="$(shasum -a 256 "$dest/$name.part" | cut -d' ' -f1)"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "Checksum mismatch for $name, deleted it." >&2
    rm -f "$dest/$name.part"
    return 1
  fi
  mv "$dest/$name.part" "$dest/$name"
}
export -f fetch
echo "Downloading $TOTAL files into $DEST (4 at a time) ..."
printf '%s\n' "$LIST" | xargs -P 4 -I{} bash -c 'fetch "$1" "$2" "$3" "$4"' _ {} "$DEST" "$BASE" "$SUMS" || true

DONE="$(find "$DEST" -name '*.rtb[wz]' | wc -l | tr -d ' ')"
echo "$DONE of $TOTAL files present and checked ($(du -sh "$DEST" | cut -f1))."
[ "$DONE" -ge "$TOTAL" ] || { echo "Some files are missing. Run the script again to finish." >&2; exit 1; }
echo "Done. Timur uses the tables automatically on its next start."
