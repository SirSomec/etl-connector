FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates wget \
  && mkdir -p /usr/local/share/ca-certificates/Yandex \
  && wget -O /usr/local/share/ca-certificates/Yandex/RootCA.crt https://storage.yandexcloud.net/cloud-certs/RootCA.pem \
  && wget -O /usr/local/share/ca-certificates/Yandex/IntermediateCA.crt https://storage.yandexcloud.net/cloud-certs/IntermediateCA.pem \
  && chmod 655 /usr/local/share/ca-certificates/Yandex/RootCA.crt /usr/local/share/ca-certificates/Yandex/IntermediateCA.crt \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY src ./src

USER node

EXPOSE 3000

CMD ["npm", "start"]
