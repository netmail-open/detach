FROM node:latest

EXPOSE 7001

# Pull src
WORKDIR /root
RUN git clone https://bitbucket.netmail.com/scm/open/detach.git

# Build
WORKDIR /root/detach/api
RUN  npm install -g  typescript
RUN  npm install
RUN  tsc

ENV STORE http://download.netmail.com node
#Do the work
CMD ["node", "."]
