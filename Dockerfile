FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY . .

# SQLite db lives in a mounted volume (see docker-compose.yml) so it
# survives container rebuilds.
VOLUME ["/app/db"]

EXPOSE 3000
CMD ["node", "server.js"]
