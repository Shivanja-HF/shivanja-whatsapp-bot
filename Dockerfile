FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Kein fixes EXPOSE. Railway nutzt PORT dynamisch.
CMD ["npm", "start"]
