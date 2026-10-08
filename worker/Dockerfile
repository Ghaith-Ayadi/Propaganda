# Built on the box from the Propaganda checkout Bedrock already keeps
# (/srv/propaganda-supabase/schema), by compose/propaganda-supabase, with the
# checkout's root as the context: the worker bundles the model gateway from
# api/_ai (build.mjs). Dockerfile.dockerignore keeps the context to those two.
FROM node:22.22.0-alpine AS build
WORKDIR /src/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/_ai/gateway.ts api/_ai/cost.ts api/_ai/errors.ts /src/api/_ai/
COPY worker/tsconfig.json worker/build.mjs ./
COPY worker/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.22.0-alpine
WORKDIR /worker
ENV NODE_ENV=production
COPY --from=build /src/worker/package.json ./
COPY --from=build /src/worker/node_modules ./node_modules
COPY --from=build /src/worker/dist ./dist
USER node
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1:3010/health || exit 1
CMD ["node", "dist/main.js"]
