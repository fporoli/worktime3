FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --prefix apps/web 2>/dev/null || true
COPY . .
RUN npm run build --workspace=@worktime3/web || npx --prefix apps/web vite build
FROM nginx:alpine
COPY apps/web/dist /usr/share/nginx/html
EXPOSE 80
