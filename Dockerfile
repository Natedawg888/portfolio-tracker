# Portfolio Tracker — production image (Railway / Fly / Render)
# Serves Vite build + Express API from one process. SQLite on a persistent volume at /app/data.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# Do not copy local .env / data into the image (see .dockerignore)
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
# sql.js WASM + tsx for TypeScript server entry
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx@4.23.15 --no-save
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/data /app/data/backups
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
