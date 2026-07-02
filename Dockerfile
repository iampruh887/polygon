FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 may need native build tooling when a prebuilt binary is not
# available for the target platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Vite embeds VITE_* values at build time. Pass this with:
# fly deploy --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_...
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3141

EXPOSE 3141

CMD ["npm", "run", "start"]
