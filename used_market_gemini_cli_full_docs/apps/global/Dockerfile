FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN rm -rf dist && npm run build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=8787 \
  LOCAL_BROWSER_BINARY=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web-backend/public ./web-backend/public
RUN mkdir -p /app/merge/result && chown -R node:node /app

USER node
EXPOSE 8787

CMD ["node", "dist/web-backend/logic/index.js"]
