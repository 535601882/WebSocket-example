
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

            // 当收到 'join_room' 类型的消息时
            case 'join_room':
                const { roomIdToJoin, username } = parsedMessage.payload;
                const roomToJoin = rooms[roomIdToJoin];

                // 检查房间是否存在且有主播
                if (roomToJoin && roomToJoin.host) {
                    console.log(`用户 ${username} 正在加入房间 ${roomIdToJoin}`);
                    
                    // 将观众的 WebSocket 实例添加到房间的 viewers 集合中
                    roomToJoin.viewers.add(ws);
                    ws.roomId = roomIdToJoin; // 记录该观众所在的房间ID
                    ws.username = username; // 记录该观众的用户名

                    // 告知该观众加入成功
                    ws.send(JSON.stringify({ type: 'join_success', roomId: roomIdToJoin }));

                    // 构建欢迎消息，并广播给房间里的所有人
                    const welcomeMessage = {
                        type: 'system_message',
                        payload: {
                            content: `欢迎 ${username} 进入直播间！`
                        }
                    };
                    const messageString = JSON.stringify(welcomeMessage);

                    // 发送给主播
                    roomToJoin.host.send(messageString);
                    // 发送给所有其他观众
                    roomToJoin.viewers.forEach(viewer => {
                        viewer.send(messageString);
                    });

                } else {
                    // 如果房间不存在，则告知客户端加入失败
                    ws.send(JSON.stringify({ type: 'error', message: '房间不存在或主播已离开' }));
                }
                break;

            // 当收到客户端发送的聊天消息时
            case 'chat_message':
                const senderRoomId = ws.roomId;
                const room = rooms[senderRoomId];

                // 确保发送者在一个有效的房间内
                if (room) {
                    console.log(`[房间 ${senderRoomId}] 用户 ${ws.username} 说: ${parsedMessage.payload.content}`);

                    // 构造要广播给所有人的消息体
                    const chatMessage = {
                        type: 'new_chat_message', // 使用一个新的类型，避免与客户端发送的事件混淆
                        payload: {
                            sender: {
                                username: ws.username,
                                isHost: ws.isHost || false // 附加发送者的身份信息
                            },
                            content: parsedMessage.payload.content
                        }
                    };
                    const messageString = JSON.stringify(chatMessage);

                    // 向房间内的每个人广播这条消息
                    room.host.send(messageString); // 发给主播
                    room.viewers.forEach(viewer => { // 发给所有观众
                        viewer.send(messageString);
                    });
                }
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

// 这是一个简单的 HTTP API 端点，用于获取当前所有活跃的房间列表
app.get('/api/rooms', (req, res) => {
    // 我们需要从 rooms 对象中提取出房间ID，并返回给客户端
    const activeRooms = Object.keys(rooms).map(roomId => ({
        id: roomId,
        // 在真实应用中，这里可能还会包含主播信息、房间标题、观众人数等
        name: `主播的直播间 ${roomId}`
    }));
    res.json(activeRooms);
});

// 设置 Express 为项目根目录提供静态文件服务
app.use(express.static(__dirname));

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器已启动，正在监听 http://localhost:${PORT}`);
});
