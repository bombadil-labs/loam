# Loam in a container. The build stage carries a toolchain (better-sqlite3 is a native addon that
# may need to compile if no prebuild matches this arch/libc); the runtime stage is slim and gets
# the ALREADY-COMPILED node_modules copied in, so it needs no compiler of its own. `loam serve`
# self-bootstraps: it mints (or imports via LOAM_SEED) the operator identity on first run, so a
# fresh container serves with nothing but a token.
#
#   docker run -e LOAM_TOKEN=<secret> -v loam-data:/data -p 4321:4321 loam

FROM node:24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime
# The data volume, owned by the runtime user — created and chowned BEFORE the VOLUME line, so the
# ownership survives into the image (a VOLUME declared first would discard later changes to it).
RUN useradd --system --uid 10001 --create-home loam && mkdir -p /data && chown loam /data
VOLUME /data
WORKDIR /app
ENV NODE_ENV=production LOAM_HOME=/data
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER loam

# Supply the token at run time: `docker run -e LOAM_TOKEN=… -p 4321:4321 loam`.
EXPOSE 4321
ENTRYPOINT ["node", "dist/cli/bin.js"]
CMD ["serve", "--http", "--port", "4321"]
