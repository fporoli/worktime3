FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --prefix apps/web 2>/dev/null || true
COPY . .
# Vite inlines VITE_* env vars into the built JS at build time — without this, the bundle falls
# back to its hardcoded default (localhost:8001), silently pointing every deployment's frontend
# at whatever happens to be running on a dev machine's native API port instead of its own backend.
ARG VITE_API_URL
ARG VITE_KEYCLOAK_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
RUN npm run build --workspace=@worktime3/web || npx --prefix apps/web vite build
FROM nginx:alpine
# --from=build, not a bare path: without it this copies apps/web/dist from the BUILD CONTEXT
# (i.e. whatever's already on the host from a native `npm run build`), silently bypassing the
# `build` stage above entirely and shipping whatever URLs were baked in by a local dev build.
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
