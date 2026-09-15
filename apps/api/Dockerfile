FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json ./apps/api/
RUN npm install --prefix apps/api 2>/dev/null || npm install --workspace=@worktime3/api || true
COPY . .
RUN npm run build --workspace=@worktime3/api
RUN npm prune --prefix apps/api --omit=dev 2>/dev/null || npm prune --workspace=@worktime3/api --omit=dev || true
EXPOSE 8000
CMD ["node", "apps/api/dist/main.js"]
