# Sourced by the service.sh scripts: writes a LaunchAgent plist for this checkout, wherever it lives, so no
# file with one machine's paths is kept in the repository.
#   write_plist LABEL DEST WORKDIR STDOUT STDERR THROTTLE_S TZ_OR_EMPTY -- program arguments...
write_plist() {
  local label="$1" dst="$2" workdir="$3" out="$4" err="$5" throttle="$6" tz="$7"
  shift 7
  [ "$1" = "--" ] && shift
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0">'
    echo '<dict>'
    echo "  <key>Label</key><string>$label</string>"
    echo '  <key>ProgramArguments</key>'
    echo '  <array>'
    for a in "$@"; do echo "    <string>$a</string>"; done
    echo '  </array>'
    echo "  <key>WorkingDirectory</key><string>$workdir</string>"
    if [ -n "$tz" ]; then echo "  <key>EnvironmentVariables</key><dict><key>TZ</key><string>$tz</string></dict>"; fi
    echo '  <key>RunAtLoad</key><true/>'
    echo '  <key>KeepAlive</key><true/>'
    echo "  <key>ThrottleInterval</key><integer>$throttle</integer>"
    echo '  <key>Nice</key><integer>5</integer>'
    echo "  <key>StandardOutPath</key><string>$out</string>"
    echo "  <key>StandardErrorPath</key><string>$err</string>"
    echo '</dict>'
    echo '</plist>'
  } > "$dst"
  plutil -lint "$dst" >/dev/null
}
