FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4177
ENV CHRONOSCOPE_DB_PATH=/data/chronoscope.sqlite

COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data

EXPOSE 4177

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4177/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
