FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY sql ./sql

EXPOSE 5000

CMD ["npm", "start"]
