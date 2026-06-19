FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
ARG VITE_DATABASE_TYPE=postgres
ARG VITE_ENABLE_MOCK_TOOLS=false
ENV VITE_DATABASE_TYPE=$VITE_DATABASE_TYPE
ENV VITE_ENABLE_MOCK_TOOLS=$VITE_ENABLE_MOCK_TOOLS
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.cjs"]
