# 어둠의 전설 개인 서버 — Docker 이미지
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7777 \
    DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# 관리자 페이지의 직업·스킬트리 탭이 gamedata 의 설계 파일을 고쳐 쓰므로 node 사용자가 쓸 수 있게
COPY --chown=node:node gamedata ./gamedata
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 7777
VOLUME ["/app/data"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
