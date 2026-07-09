# Loam in a container: build the package, run `loam serve --http` as a non-root user. Persistence
# is a mounted volume (a durable sqlite file) or a hosted libSQL URL — the StoreBackend seam makes
# that a driver choice, not an image change.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# The store lives on a volume so it survives the container.
VOLUME /data
ENV LOAM_HOME=/data
RUN useradd --system --uid 10001 loam && chown -R loam /data 2>/dev/null || true
USER loam

# Override the token and port at run time: `docker run -e LOAM_TOKEN=… -p 4321:4321 loam`.
EXPOSE 4321
ENTRYPOINT ["node", "dist/cli/bin.js"]
CMD ["serve", "--http", "--port", "4321"]
