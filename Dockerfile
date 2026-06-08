# Usar a imagem oficial slim do Node.js
FROM node:20-slim

# Instalar FFmpeg e FFprobe no container Linux
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Definir diretório de trabalho no container
WORKDIR /app

# Copiar os arquivos de dependência e instalar
COPY package*.json ./
RUN npm install --production

# Copiar todo o resto do projeto para dentro do container
COPY . .

# Expõe a porta dinâmica
EXPOSE 3001

# Comando para iniciar o servidor Node.js
CMD ["node", "server.js"]
