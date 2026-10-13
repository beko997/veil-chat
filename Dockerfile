FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/veil-chat run build

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/artifacts/veil-chat/dist/public

EXPOSE 3000

CMD ["node", "scripts/start-container.mjs"]
