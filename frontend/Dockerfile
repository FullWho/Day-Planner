FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Копируем только package.json, чтобы Docker кэшировал установку зависимостей.
# package-lock.json намеренно не используется: в учебных/архивных сборках он
# часто создаётся под другую среду и может ломать Docker-сборку.
COPY package.json ./

# node:20-alpine использует более стабильную связку Node/npm для Vite-проекта,
# чем node:22-alpine, где иногда появляется npm error "Exit handler never called".
RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY . .

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
