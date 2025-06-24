FROM oven/bun:latest
WORKDIR /app
COPY bun.lock package.json ./
RUN bun install --frozen-lockfile
RUN bun prisma db:push
COPY . .
EXPOSE 3000
CMD ["bun", "run", "start"]
