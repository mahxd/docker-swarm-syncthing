FROM node:lts-alpine
WORKDIR /home/node
COPY controller.js .
COPY package.json .
RUN /usr/local/bin/npm install axios
ENTRYPOINT ["/usr/local/bin/node", "controller.js"]
