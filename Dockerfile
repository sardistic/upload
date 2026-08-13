FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
