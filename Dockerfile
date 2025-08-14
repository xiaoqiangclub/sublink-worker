# 使用官方 Node.js 20 Alpine 镜像作为基础镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml 文件
COPY package.json pnpm-lock.yaml ./

# 安装 pnpm 并安装依赖
RUN npm install -g pnpm && pnpm install

# 复制项目源代码
COPY . .

# 暴露应用程序运行的端口
EXPOSE 3000

# 定义容器启动时运行的命令
CMD ["pnpm", "start"]