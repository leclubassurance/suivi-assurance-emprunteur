FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV RAILWAY_ENVIRONMENT=true

# Railway injecte PORT (souvent 8080)
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
