# syntax=docker/dockerfile:1
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json .prettierrc.json .prettierignore ./
COPY scripts/ ./scripts/
COPY src/ ./src/
COPY public/style.css public/lobby.css ./public/
RUN npm run check && npm run build
RUN --mount=type=bind,source=test,target=/app/test \
    --mount=type=bind,source=public,target=/app/public \
    --mount=type=bind,source=LICENSES,target=/app/LICENSES \
    --mount=type=bind,source=docs,target=/app/docs \
    --mount=type=bind,source=README.md,target=/app/README.md npm run format:check && node --test test/*.test.js

FROM build AS runtime-deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
WORKDIR /app
COPY --from=runtime-deps /app/node_modules/ ./node_modules/
COPY --from=build /app/dist ./dist/
COPY package.json ./
COPY src/server/ ./src/server/
COPY src/shared/ ./src/shared/
COPY src/engine/ ./src/engine/
COPY src/content/ ./src/content/
COPY src/network/ ./src/network/
COPY public/index.html public/icons.svg ./public/
COPY public/assets/ ./public/assets/
COPY LICENSES/ ./LICENSES/
ENV NODE_ENV=production PORT=8080
USER 1000:1000
EXPOSE 8080
CMD ["node","src/server/main.ts"]
