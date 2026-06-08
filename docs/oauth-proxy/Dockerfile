# OAuth 代理镜像 —— 构建上下文 = docs/（见 docker-compose 的 context: ..）。
# secret 不进镜像：运行时用 --env-file / -e 注入。
FROM node:20-alpine
WORKDIR /app
COPY oauth-proxy-server.mjs ./
EXPOSE 8787
USER node
CMD ["node", "oauth-proxy-server.mjs"]
