# Built on the box from the Propaganda checkout Bedrock already keeps
# (/srv/propaganda-supabase/schema), by compose/propaganda-supabase.
FROM node:22.22.0-alpine AS build
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22.22.0-alpine
WORKDIR /worker
ENV NODE_ENV=production
COPY --from=build /worker/package.json ./
COPY --from=build /worker/node_modules ./node_modules
COPY --from=build /worker/dist ./dist
USER node
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1:3010/health || exit 1
CMD ["node", "dist/main.js"]
