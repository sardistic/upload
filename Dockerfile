FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# yt-dlp is the release zipapp, which needs python3; MP3 extraction needs ffmpeg.
# The download is pinned to a release tag and verified by SHA-256 so a rebuild
# cannot silently pull different code. Bump both together when updating.
ARG YTDLP_VERSION=2026.08.19
ARG YTDLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6
RUN apk add --no-cache ffmpeg python3 \
 && wget -q -O /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
 && echo "${YTDLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && /usr/local/bin/yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
