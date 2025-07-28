
// 引入必要的模块
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

// 初始化 Express 应用
const app = express();
// 创建 HTTP 服务器，这将为 WebSocket 和 Express 提供服务
const server = http.createServer(app);
// 在 HTTP 服务器上创建 WebSocket 服务器实例
const wss = new WebSocketServer({ server });

// 端口号
const PORT = 3000;

// 存储所有直播间信息。
// 结构: { roomId: { host: WebSocket, viewers: Set<WebSocket> } }
// 这是我们当前阶段的“数据库”，用一个简单的对象变量代替 Redis
const rooms = {};

// 当有新的 WebSocket 连接建立时，执行此回调函数
wss.on('connection', (ws, req) => {
    // ws 是当前连接的 WebSocket 实例
    // req 是初始的 HTTP 请求对象，我们可以从中获取信息

    console.log('一个新的客户端连接了');

    // 监听来自客户端的消息
    ws.on('message', (message) => {
        console.log('收到消息:', message.toString());
        // 暂时只是打印，后续会在这里处理复杂的逻辑
    });

    // 监听连接关闭事件
    ws.on('close', () => {
        console.log('一个客户端断开连接了');
        // 后续需要在这里处理用户离开房间的逻辑
    });

    // 监听可能发生的错误
    ws.on('error', console.error);
});

// 设置 Express 为项目根目录提供静态文件服务
// 这样 index.html 就可以被访问到了
app.use(express.static(__dirname));

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器已启动，正在监听 http://localhost:${PORT}`);
});
