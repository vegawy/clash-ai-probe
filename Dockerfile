FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY probe-core.mjs ./
COPY health.mjs ./
COPY scheduler.mjs ./
COPY server.mjs ./
COPY store.mjs ./
COPY clash-ai-probe.mjs ./
COPY public ./public

ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.mjs"]
