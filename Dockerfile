# Container image for MCP hosts (Glama et al.).
#
# Glama builds from a maintainer-authored Dockerfile when one is checked in and
# only infers one otherwise. Checking this in takes control of the build:
# `npm ci` installs from package-lock.json, so the image matches what CI tests
# and the `overrides` block is honoured. The inferred build ran `pnpm install`,
# which re-resolves every range on each rebuild and ignores npm-style overrides.

FROM node:24-slim AS build

WORKDIR /app

# Browsers are fetched lazily by ensureChromiumInstalled() on first use, never
# at install time. Belt-and-braces in case a future playwright adds a download
# hook back into its install scripts.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# `npm ci` runs `prepare` (= `npm run build`), so the sources have to be in
# place before the install rather than after it.
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci


FROM node:24-slim AS runtime

WORKDIR /app

# DDB_NO_SANDBOX: Chromium's sandbox cannot start as an unprivileged container
# user. Harmless when no browser tool is called. See src/browser.ts.
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DDB_NO_SANDBOX=1

COPY package.json package-lock.json ./

# --ignore-scripts is required: `prepare` would run `tsc`, which is a
# devDependency and absent from a production install.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# Session cookies are written to ~/.config/ddb-mcp/session.json by ddb_login;
# owning the home directory keeps that path writable for the unprivileged user.
USER node
ENV HOME=/home/node

# Plain stdio MCP server. Hosts that need HTTP/SSE wrap this themselves
# (Glama runs it behind mcp-proxy).
CMD ["node", "dist/index.js"]
