# MailTrail

![Node.js](https://img.shields.io/badge/Node.js-20--alpine-green)
![SQLite](https://img.shields.io/badge/SQLite-database-blue)
![Docker](https://img.shields.io/badge/Docker-ready-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

A lightweight, self-hosted Postfix log viewer with real-time search, dashboard analytics, multi-channel alerting, and SMTP health monitoring.

Built for engineers who need visibility into their Postfix mail server without the overhead of a full logging stack.

> **From the makers of [Netra](https://netradns.com)** — enterprise DNS change management with approval workflows, drift detection, and audit trails for Windows DNS, Route 53, Cloud DNS, Azure DNS, and Cloudflare.

## Features

**Dashboard**
- Stat cards: total entries, sent, bounced, bounce rate, deferred, queue depth, avg delay, msgs/hour
- Hourly volume chart (last 24h)
- Status breakdown with bar visualization
- Throughput metrics (1min / 5min / 1hr / 24hr)
- Top senders and top recipients tables
- Recipient domain stats — sent, bounced, deferred, rejected counts per destination domain
- Recent errors feed with copy-to-clipboard
- Postfix SMTP health check with response time and banner
- Send test email directly from the UI (admin only)

**Log Search**
- Correlated message view — one row per message with from, to, status merged from multiple Postfix log lines
- Filter by sender, recipient, domain, status, date range
- Full-text search across queue IDs, addresses, and messages
- Columns: time, QID, from, to, status, relay, delay (with breakdown), TLS cipher, submitting client
- Paginated results with instant SQLite-backed queries
- Export filtered results to CSV (exports exactly what's on screen)
- Copy-to-clipboard button on every row

**Message Tracking**
- Click any Queue ID to see the full message lifecycle
- Every log line for that message shown in chronological order
- See exactly where delivery succeeded, failed, or stalled

**Sender Detail**
- Click any email address to view per-sender stats
- Delivery status breakdown, top recipients, recent messages

**Inline Lookups**
- Click any IP address for geolocation (city, region, country, org, timezone) via server-side proxy
- Click any domain in relay fields for DNS resolution via Cloudflare DoH
- Lookups appear inline without leaving the page
- Works behind HTTPS (no mixed content issues)

**Live Tail**
- Real-time correlated message stream, auto-refreshes every 5 seconds
- Newest messages first
- Clickable QIDs, addresses, and relay domains
- Copy button on every entry

**Alerting**
- Multi-channel: configure Slack, Microsoft Teams, PagerDuty, Discord, Email, and generic webhooks — all at once
- Alerts fire to every configured channel simultaneously
- Configurable triggers: bounce rate threshold, queue depth threshold, Postfix health failure
- Rich formatted notifications: Slack Block Kit, Teams Adaptive Cards, PagerDuty Events v2, Discord Embeds
- Email alerts sent through the local Postfix relay with a configurable sender address
- Per-channel test button to verify each integration
- Configurable cooldown to prevent alert fatigue (default 15 minutes)
- All settings managed from the admin Settings page — no restart needed

**Automatic Storage Management**
- MailTrail actively manages disk usage to prevent the host from running out of space
- Two independent cleanup mechanisms run every hour:
  - **Database retention**: Deletes SQLite entries older than the configured retention period (default 90 days)
  - **Log file cleanup**: When raw Postfix log files exceed the configured limit (default 20 GB), the oldest files are automatically deleted
- Both thresholds are configurable from the admin Settings page — no restart needed
- Old `.log` and `.json` files in the Postfix logs directory will be removed by MailTrail when the size cap is reached. This is expected behavior. If you need to retain raw logs longer, increase the limit or archive them externally

**Security**
- Role-based access: admin (full access) and viewer (read-only)
- CSP, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy headers
- Path traversal protection on static file serving
- SMTP/CRLF injection prevention on test emails and alert emails
- Rate limiting on auth endpoint (10 attempts per 5 minutes per IP)
- Request body size limits (1MB max)
- Webhook URL validation (HTTPS required for external services)
- Alert channel limit (max 10 per instance)
- Two-step confirmation for destructive actions (data purge)

**Infrastructure**
- SQLite backend with WAL mode — indexed search across millions of entries in milliseconds
- Background log ingestion tails files incrementally (no full re-scans)
- Memory-safe ingestion with 10MB read cap per cycle and overlap lock
- Docker memory (512MB) and CPU (1 core) limits
- Healthcheck with 30s start period
- Graceful shutdown with DB close on SIGTERM
- Uncaught exception handler — logs, closes DB, exits cleanly for Docker restart
- Auto-upgrades DB schema when new columns are added

**General**
- Light / Dark / System theme toggle
- Timezone selector with live clock (defaults to server TZ)
- Mobile responsive
- 184-day login session persistence
- Zero build step frontend — vanilla JS, no bundler, no framework

## Screenshots

*Coming soon*

## Requirements

Running both Postfix and MailTrail on the same host:

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 5 GB | 20+ GB (depends on log retention) |
| Docker | 20.10+ | Latest |
| Docker Compose | v2+ | Latest |

MailTrail alone: 1 vCPU / 512 MB RAM. Postfix alone: 1 vCPU / 256 MB RAM.

At 2,000 emails/day with 90-day retention, expect ~500MB of SQLite DB and ~1GB of raw log files.

## Deployment

### 1. Prepare the host

Create the directory structure on the Docker host:

```
Host directory layout:

/docker/
├── postfix/                <- Postfix mail relay
│   ├── config/
│   ├── logs/               <- Shared with MailTrail (read + write)
│   └── dkim/keys/
└── mailtrail/              <- MailTrail
    └── data/               <- SQLite DB, settings, auth (persisted)
```

```bash
# Create all directories
sudo mkdir -p /docker/postfix/config
sudo mkdir -p /docker/postfix/logs
sudo mkdir -p /docker/postfix/dkim/keys
sudo mkdir -p /docker/mailtrail/data

# Set directory permissions
sudo chmod 755 /docker /docker/postfix /docker/postfix/config \
  /docker/postfix/logs /docker/postfix/dkim \
  /docker/mailtrail /docker/mailtrail/data

# Lock DKIM private keys to root only
sudo chmod 700 /docker/postfix/dkim/keys
```

> **Note on the shared logs directory**: `/docker/postfix/logs/` is the only path that lives outside `/docker/mailtrail/`. Postfix writes log files here, and MailTrail reads them for ingestion and deletes old ones for storage management. Both containers mount this same host directory. This is intentional -- the logs belong to Postfix, but MailTrail needs access to do its job.

### 2. Fix Postfix log file permissions

MailTrail runs as a non-root user (`mailtrail`) inside its container. It needs read access to ingest logs and write access to delete old log files when the storage limit is reached.

Postfix's rsyslog creates log files owned by root. After Postfix starts and writes its first log files, make them readable:

```bash
sudo chmod 644 /docker/postfix/logs/*
```

The included `postfix/rsyslog.conf` sets `$FileCreateMode 0644` so new log files are created world-readable automatically. If you use a custom rsyslog config, make sure it does the same -- otherwise you'll need to re-run the chmod after every log rotation.

### 3. Start the services

```bash
docker compose up -d
```

### 4. Verify

```bash
# Check MailTrail logs for successful startup
docker logs mailtrail

# You should see:
# [mailtrail] SQLite database: /data/mailtrail.db
# [mailtrail] Log ingestion every 3000ms from /logs
# [mailtrail] Running on :3000
# [mailtrail] Admin: admin / *****
```

Open `http://localhost:8080` and log in with the default credentials.

### 5. Post-deploy checklist

- [ ] Change the default admin password from the Settings page
- [ ] Change the default viewer password from the Settings page
- [ ] Send a test email from the Dashboard to verify Postfix connectivity
- [ ] Configure alert channels (Slack, Teams, etc.) from the Settings page
- [ ] Send a test alert to verify each channel
- [ ] Adjust retention days and max log size if needed

## Quick Start (without Postfix)

If you already have a Postfix server writing logs somewhere:

```bash
cp docker-compose.example.yml docker-compose.yml
# Edit: set the log path, SMTP_HOST, and credentials
docker compose up -d
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Admin username (full access) |
| `ADMIN_PASS` | `admin` | Admin password |
| `VIEWER_USER` | `viewer` | Viewer username (read-only) |
| `VIEWER_PASS` | `viewer` | Viewer password |
| `LOG_DIR` | `/logs` | Path to Postfix log files (read + write for cleanup) |
| `DATA_DIR` | `/data` | Path for SQLite DB and settings |
| `SMTP_HOST` | `postfix` | Postfix hostname for health checks and test emails |
| `SMTP_PORT` | `25` | Postfix SMTP port |
| `RETENTION_DAYS` | `90` | Days to keep log entries (configurable in UI) |
| `MAX_LOG_SIZE_GB` | `20` | Max raw log file disk usage (configurable in UI) |
| `INGEST_INTERVAL_MS` | `3000` | How often to check for new log lines (ms) |
| `APP_VERSION` | `1.0.0` | Version shown in Settings page |
| `TZ` | `UTC` | Container timezone (also sets default UI timezone) |

All settings except credentials can be overridden from the admin Settings page after deploy. Credential changes from the UI are persisted to `/data/auth.json` and survive container restarts.

## Roles

| Capability | Admin | Viewer |
|---|---|---|
| View dashboard, stats, charts | ✓ | ✓ |
| Search and browse logs | ✓ | ✓ |
| Live tail | ✓ | ✓ |
| Message tracking (QID click) | ✓ | ✓ |
| Sender detail | ✓ | ✓ |
| IP/DNS inline lookups | ✓ | ✓ |
| Export to CSV | ✓ | ✓ |
| Copy log entries | ✓ | ✓ |
| Send test email | ✓ | ✗ |
| Configure alerts | ✓ | ✗ |
| Change settings | ✓ | ✗ |
| Change credentials | ✓ | ✗ |
| Purge all data | ✓ | ✗ |

## Alerting

MailTrail supports multiple alert channels configured simultaneously. When an alert fires, it sends to all configured channels in parallel.

### Supported services

| Service | URL / Config | Rich Format |
|---|---|---|
| Slack | Incoming Webhook URL | Block Kit with colored sidebar |
| Microsoft Teams | Incoming Webhook URL | Adaptive Cards |
| PagerDuty | Integration Key (routing key) | Events API v2 with severity |
| Discord | Webhook URL | Embeds with colored sidebar |
| Email | Recipient email address | Plain text via local Postfix |
| Generic Webhook | Any HTTP(S) endpoint | Structured JSON payload |

### Setup

1. Go to **Settings → Alert Channels**
2. Select a service from the dropdown
3. Enter the webhook URL (or email address for Email)
4. Click **Add Channel** — it appears as a card below
5. Click **Test** on the card to verify the integration
6. Repeat for additional channels
7. Configure alert triggers (bounce rate, queue depth, health check)
8. Click **Save Alert Settings**

### Alert triggers

| Trigger | Default Threshold | Description |
|---|---|---|
| Bounce rate | 5% | Fires when bounce rate exceeds the threshold |
| Queue depth | 50 messages | Fires when estimated queue size exceeds the threshold |
| Postfix health | N/A | Fires when the SMTP health check fails |

Alerts are checked every 60 seconds. The cooldown (default 15 minutes) prevents the same alert from firing repeatedly.

### Email alerts

Email alerts are sent through the local Postfix relay using the sender address configured in the "Email Alert Sender" field. No external SMTP configuration is needed.

Note: If Postfix is down, email alerts for the "Postfix health check fails" trigger won't be delivered. Pair email with a webhook-based channel (Slack, Teams, etc.) for health alerts.

## Log Fields

MailTrail extracts and indexes these fields from Postfix logs:

| Field | Source | Description |
|---|---|---|
| `from` | `from=<addr>` | Envelope sender |
| `to` | `to=<addr>` | Envelope recipient |
| `status` | `status=sent` | Delivery status (sent, bounced, deferred, reject) |
| `relay` | `relay=host[ip]:port` | Destination mail server |
| `delay` | `delay=1.7` | Total delivery time in seconds |
| `delays` | `delays=0.02/0.08/0.62/1` | Breakdown: before_queue / in_queue / conn_setup / transfer |
| `dsn` | `dsn=2.6.0` | Delivery status notification code |
| `size` | `size=487` | Message size in bytes |
| `nrcpt` | `nrcpt=1` | Number of recipients |
| `client` | `client=hostname[ip]` | Submitting client (which app sent the mail) |
| `tls` | TLS connection line | TLS version and cipher used for delivery |

Both standard syslog and ISO 8601 timestamp formats are supported.

## Architecture

```
┌─────────────┐     ┌──────────────┐
│   Postfix    │────▶│  Log Files   │
│  (port 25)  │     │  mail.log    │
└─────────────┘     └──────┬───────┘
                           │ shared volume
                    ┌──────▼───────┐
                    │  MailTrail   │
                    │  (port 3000) │
                    │              │
                    │  ┌────────┐  │
                    │  │ SQLite │  │
                    │  │ (WAL)  │  │
                    │  └────────┘  │
                    └──────────────┘
```

## Project Structure

```
server.js                    → Entry point — wires services, starts HTTP server
src/
  config.js                  → Environment variables and defaults
  db.js                      → SQLite setup, schema, migrations, prepared statements
  settings.js                → Settings read/write with disk-backed cache
  middleware/
    auth.js                  → Credentials, roles, Basic auth
    rateLimit.js             → Per-IP auth attempt throttling
    security.js              → CSP, X-Frame-Options, security headers
  routes/
    api.js                   → All HTTP endpoint handlers
    static.js                → Frontend static file serving
  services/
    alerting.js              → Multi-channel alert engine + formatters
    ingest.js                → Log file tailing, cursor tracking, bulk insert
    parser.js                → Syslog + JSON line parsing for Postfix logs
    queries.js               → Search, dashboard stats, top senders, domain stats
    retention.js             → DB entry purge + log file size management
    smtp.js                  → SMTP health check + test email
frontend/
  index.html                 → Single-page app shell
  style.css                  → Styles (light/dark theme)
  images/                    → Logo and assets
  js/
    utils.js                 → HTML escaping, number formatting, toast, API helper
    theme.js                 → Light/dark/system toggle, timezone, live clock
    auth.js                  → Login, logout, session persistence, role management
    nav.js                   → Sidebar, page switching, topbar
    dashboard.js             → Dashboard rendering, stat cards, charts, health check
    search.js                → Log search, results table, pagination, CSV export
    tail.js                  → Live tail auto-refresh
    settings.js              → Settings panels, alert channels, retention, credentials
    modals.js                → QID tracking, sender detail, IP/DNS inline lookups
```

## Troubleshooting

**"EACCES: permission denied, open '/logs/mail.json'"**
Postfix log files are owned by root. Run `sudo chmod 644 /docker/postfix/logs/*` on the host. See [Deployment step 3](#3-fix-postfix-log-file-permissions).

**"Invalid username or password" after rebuild**
Your browser may be sending a cached auth header from a previous session. Open an incognito window or clear site data for the MailTrail URL.

**Dashboard shows 0 entries after deploy**
Wait 3–5 seconds for the first ingestion cycle. Check `docker logs mailtrail` for "Ingested X log entries". If nothing appears, verify the log files exist in `/docker/postfix/logs/` and are readable.

**Test email sent but not showing in MailTrail**
The ingestion cycle runs every 3 seconds by default. Wait a few seconds and refresh. If it still doesn't appear, check that the log file is being written to (`ls -la /docker/postfix/logs/`).

**Alert test button says "sent" but nothing arrives**
Check `docker logs mailtrail` for alert delivery errors. Common issues: incorrect webhook URL, Slack/Teams app not configured to accept incoming webhooks, or network firewall blocking outbound HTTPS.

## Updating

To update MailTrail after pulling new code:

```bash
cd /docker/mailtrail
docker compose down
docker compose build --no-cache
docker compose up -d
```

The SQLite database and settings are persisted in `/docker/mailtrail/data/` and survive rebuilds. Schema migrations run automatically on startup.

## License

MIT

---

<p align="center">
  <sub>A free tool by the makers of <a href="https://netradns.com">Netra</a> — enterprise DNS change management with approval workflows, drift detection, and audit trails.</sub>
</p>
