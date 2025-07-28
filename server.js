
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
        let parsedMessage;
        try {
            // 我们约定所有消息都使用 JSON 格式，并进行解析
            parsedMessage = JSON.parse(message);
        } catch (e) {
            console.error('收到了非JSON格式的消息:', message.toString());
            return;
        }

        // 根据消息的 type 字段来判断意图
        switch (parsedMessage.type) {
            // 当收到 'create_room' 类型的消息时
            case 'create_room':
                console.log('收到创建房间的请求');
                
                // 生成一个简单且唯一的房间ID
                const roomId = `room_${Date.now()}`;
                ws.isHost = true; // 给主播的连接实例做一个标记
                ws.roomId = roomId; // 方便后续查找

                // 在 rooms 对象中存储这个新房间的信息
                rooms[roomId] = {
                    host: ws,       // 存储主播的 WebSocket 实例
                    viewers: new Set() // 初始化一个空的观众集合
                };

                // 向主播客户端回传成功消息和房间ID
                const successMessage = {
                    type: 'room_created',
                    roomId: roomId,
                    message: `房间创建成功！ID: ${roomId}`
                };
                ws.send(JSON.stringify(successMessage));
                console.log(`房间 ${roomId} 已创建`);
                break;

            default:
                console.log('收到未知类型的消息:', parsedMessage);
        }
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
