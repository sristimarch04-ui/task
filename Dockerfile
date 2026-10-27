FROM node:20-slim
WORKDIR /app
COPY . .
RUN cd frontend && npm install && npm run build && cd ../backend && npm install --include=dev && npm run build
ENV PORT=8080
EXPOSE 8080
CMD ["node","backend/dist/server.js"]
