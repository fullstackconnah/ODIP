# Build stage
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
# compose.yaml passes this; without the ARG/ENV pair Docker silently discards it and
# Vite bakes in `false`, so the dev-login panel never renders in the built image.
ARG VITE_DEV_AUTH

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_DEV_AUTH=$VITE_DEV_AUTH

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=180000 \
 && test -x node_modules/.bin/tsc \
 || (echo "ERROR: npm ci left an incomplete node_modules (tsc missing)" >&2; exit 1)

COPY frontend/ .
# 4 workers, as the test runner uses: the deploy host also runs test jobs, and an uncapped run starved it (deploy of #244, 2026-10-15).
RUN npm test -- --maxWorkers=4
# The deployed commit, for the platform footer's "Build 1a2b3c4" (src/lib/platformInfo.ts). Declared after the tests on purpose:
# every later RUN sees an ARG, so above `npm ci` a new sha each deploy would throw away the cached install. The ARG/ENV pair is
# needed for the same reason as VITE_DEV_AUTH's above: without the ENV, Vite never sees the value.
ARG VITE_BUILD_SHA
ENV VITE_BUILD_SHA=$VITE_BUILD_SHA
RUN npm run build

# Production stage
FROM nginx:alpine AS final
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
