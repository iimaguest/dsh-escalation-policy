#!/bin/sh
# Link the @deepseek-ai peer dependencies into ./node_modules so the plugin's
# bare imports resolve when dsh loads it from this directory.
#
# A profile may install this plugin with a `link:` dependency. Node resolves
# imports from the REAL path (symlinks are followed), so it never walks
# through the profile's node_modules where the dsh host provides its
# packages. Regular profile plugins resolve peers from
# ~/.dsh/profiles/node_modules/@deepseek-ai/; this script makes the same
# instances visible from this repo by symlinking them in.
#
# node_modules/ is gitignored — re-run this after a fresh clone.

set -e

PEERS_ROOT="${DSH_PROFILE_PEERS:-$HOME/.dsh/profiles/node_modules/@deepseek-ai}"
PEERS="cordis dsh-agent dsh-brand dsh-commands dsh-invariants dsh-llm dsh-scope dsh-session dsh-session-projection dsh-settings dsh-system-prompt schemastery"

for pkg in $PEERS; do
  if [ ! -d "$PEERS_ROOT/$pkg" ]; then
    echo "error: $PEERS_ROOT/$pkg not found — is dsh installed and the profile bootstrapped?" >&2
    exit 1
  fi
done

mkdir -p node_modules/@deepseek-ai
for pkg in $PEERS; do
  if [ "$pkg" = "cordis" ] || [ "$pkg" = "schemastery" ]; then
    ln -sfn "$PEERS_ROOT/$pkg" "node_modules/$pkg"
  else
    ln -sfn "$PEERS_ROOT/$pkg" "node_modules/@deepseek-ai/$pkg"
  fi
  echo "linked $pkg -> $PEERS_ROOT/$pkg"
done

echo "done."
