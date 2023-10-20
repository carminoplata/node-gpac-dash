# syntax=docker/dockerfile:1

FROM node:18.15.0 as base

ENV NODE_ENV=development

WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]

FROM base as test
RUN npm ci
COPY . .
RUN npm run test

FROM base as prod
RUN npm ci --production
COPY . .
CMD ["node", "gpac-dash.js"]