FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json ./
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "dist/apps/api/src/server.js"]

FROM node:22-bookworm-slim AS capture
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN ./node_modules/.bin/playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
USER node
CMD ["node", "dist/apps/capture/src/server.js"]

FROM node:22-bookworm-slim AS egress
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/apps/egress/src/server.js"]
