#!/bin/sh
set -e

# Fix ownership of data directory at startup
# This runs as root before dropping to the mailtrail user
chown -R mailtrail:mailtrail /data 2>/dev/null || true

# Drop to mailtrail user and run the app
exec su-exec mailtrail node /app/server.js
