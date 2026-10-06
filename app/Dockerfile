FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Install dependencies first so this layer is cached when only source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
