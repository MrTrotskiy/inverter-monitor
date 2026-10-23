#!/bin/bash
# The admin's PIN, set on the Mac mini itself (Terminal, or ssh to it):
#   admin/pin.sh set      ask for a new PIN twice (not shown on screen) and keep only its hash
#   admin/pin.sh unlock   lift a lock after wrong PINs
#   admin/pin.sh remove   forget the PIN: the admin is view-only until a new one is set
#   admin/pin.sh status
# The PIN goes to node through a pipe: it is never an argument (visible in ps), an environment variable or a file.
set -e
cd "$(dirname "$0")"
NODE=/usr/local/bin/node
[ -x "$NODE" ] || NODE=node
case "$1" in
  set)
    read -r -s -p "Новый PIN (4–12 цифр): " a; echo
    read -r -s -p "Ещё раз: " b; echo
    if [ "$a" != "$b" ]; then echo "PIN не совпали, ничего не изменено."; exit 1; fi
    printf '%s' "$a" | "$NODE" pin.mjs set
    unset a b ;;
  unlock|remove|status) "$NODE" pin.mjs "$1" ;;
  *) echo "usage: $0 set|unlock|remove|status"; exit 1 ;;
esac
