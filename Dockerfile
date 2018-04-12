FROM node:carbon

WORKDIR /usr/src/app

# can be cached
COPY package*.json ./
RUN npm install

# copy all the rest
COPY . .

EXPOSE 3000
CMD [ "npm", "run", "serv" ]
