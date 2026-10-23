FROM node:20-alpine
WORKDIR /app
# Install from the root lockfile so the image gets exactly the versions the host build/tests use —
# a bare `npm install` resolved newer semver-compatible releases (e.g. nodemailer shipping its own,
# stricter types) and broke `tsc` only inside Docker. `npm ci` needs every workspace's package.json.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=@worktime3/api
COPY . .
RUN npm run build --workspace=@worktime3/api
RUN npm prune --omit=dev --workspace=@worktime3/api
EXPOSE 8000
CMD ["node", "apps/api/dist/main.js"]
