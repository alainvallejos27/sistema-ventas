FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.js ./
COPY --chown=node:node routes ./routes
COPY --chown=node:node middleware ./middleware
COPY --chown=node:node public ./public

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3001/api/health', (response) => process.exit(response.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]

CMD ["node", "server.js"]
