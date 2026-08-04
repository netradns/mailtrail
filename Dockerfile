FROM node:20-alpine3.21

# Patch OS-level CVEs + install build tools for better-sqlite3
RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache python3 make g++ su-exec \
    && rm -rf /var/cache/apk/*

RUN addgroup -S mailtrail && adduser -S mailtrail -G mailtrail

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json .
RUN npm install --production \
    && apk del python3 make g++ \
    && rm -rf /root/.npm /tmp/*

COPY server.js .
COPY src/ src/
COPY frontend/ frontend/
COPY entrypoint.sh /entrypoint.sh

# Bake the version from package.json into a .version file so the app
# reports the correct version at runtime without needing an env var.
RUN node -e "process.stdout.write(require('./package.json').version)" > /app/.version

RUN chown -R mailtrail:mailtrail /app \
    && mkdir -p /data && chown -R mailtrail:mailtrail /data \
    && chmod +x /entrypoint.sh

EXPOSE 3000

CMD ["/entrypoint.sh"]
