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
// 结构: { roomId: { host: WebSocket, viewers: Set<WebSocket>, typingUsers: Set<string> } }
// 这是我们当前阶段的“数据库”，用一个简单的对象变量代替 Redis
const rooms = {};

// 心跳检测参数
const PING_INTERVAL = 30 * 1000; // 每 30 秒发送一次 Ping
const PING_TIMEOUT = 60 * 1000;  // 60 秒内未收到 Pong 则认为连接死亡

// 辅助函数：向指定房间广播观众数量
const broadcastViewerCount = (room) => {
    if (!room || !room.host || room.host.readyState !== room.host.OPEN) return;
    const count = room.viewers.size;
    const message = JSON.stringify({
        type: 'viewer_count_update',
        payload: { count }
    });

    room.host.send(message);
    room.viewers.forEach(viewer => {
        if (viewer.readyState === viewer.OPEN) {
            viewer.send(message);
        }
    });
};

// 辅助函数：向指定房间广播当前的用户列表
const broadcastUserList = (room) => {
    if (!room || !room.host || room.host.readyState !== room.host.OPEN) return;

    // 获取主播用户名
    const hostUsername = room.host.username;
    // 获取所有观众的用户名
    const viewerUsernames = Array.from(room.viewers).map(viewer => viewer.username);

    const userList = [hostUsername, ...viewerUsernames];

    const message = JSON.stringify({
        type: 'user_list_update',
        payload: { users: userList }
    });

    // 向房间里的每个人发送最新的用户列表
    room.host.send(message);
    room.viewers.forEach(viewer => {
        if (viewer.readyState === viewer.OPEN) {
            viewer.send(message);
        }
    });
};

// 辅助函数：向指定房间广播正在输入的用户列表
const broadcastTypingUsers = (room) => {
    if (!room || !room.host || room.host.readyState !== room.host.OPEN) return;

    const typingUsernames = [];
    // 检查主播是否正在输入
    if (room.host.isTyping) {
        typingUsernames.push(room.host.username);
    }
    // 检查观众们是否正在输入
    room.viewers.forEach(viewer => {
        if (viewer.isTyping) {
            typingUsernames.push(viewer.username);
        }
    });

    const message = JSON.stringify({
        type: 'typing_status_update',
        payload: { typingUsers: typingUsernames }
    });

    // 向房间里的每个人广播
    room.host.send(message);
    room.viewers.forEach(viewer => {
        if (viewer.readyState === viewer.OPEN) {
            viewer.send(message);
        }
    });
};

// 当有新的 WebSocket 连接建立时，执行此回调函数
wss.on('connection', (ws, req) => {
    // ws 是当前连接的 WebSocket 实例
    // req 是初始的 HTTP 请求对象，我们可以从中获取信息

    console.log('一个新的客户端连接了');

    // 为每个新连接初始化心跳状态
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
        console.log(`收到客户端 ${ws.username || '未知'} 的 Pong 回复。`); // 添加日志
    });

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
                ws.username = `host_${Math.random().toString(36).slice(2, 7)}`; // 为主播生成一个用户名

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

                // 房间创建后，立即广播用户列表和观众数量（主播自己也算一个用户）
                broadcastViewerCount(rooms[roomId]);
                broadcastUserList(rooms[roomId]);
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
                    if (roomToJoin.host.readyState === roomToJoin.host.OPEN) {
                        roomToJoin.host.send(messageString);
                    }
                    // 发送给所有其他观众
                    roomToJoin.viewers.forEach(viewer => {
                        if (viewer.readyState === viewer.OPEN) {
                            viewer.send(messageString);
                        }
                    });

                    // 广播最新的观众人数
                    broadcastViewerCount(roomToJoin);
                    // 广播最新的用户列表
                    broadcastUserList(roomToJoin);

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
                    if (room.host.readyState === room.host.OPEN) {
                        room.host.send(messageString); // 发给主播
                    }
                    room.viewers.forEach(viewer => { // 发给所有观众
                        if (viewer.readyState === viewer.OPEN) {
                            viewer.send(messageString);
                        }
                    });
                }
                break;

            // 当主播主动要求关闭房间时
            case 'close_room':
                const hostRoomId = ws.roomId;
                // 验证发起者是主播
                if (ws.isHost && rooms[hostRoomId]) {
                    console.log(`主播 ${ws.username} 主动关闭房间 ${hostRoomId}`);
                    // 主动调用连接关闭处理函数，后面的逻辑会复用
                    ws.close();
                }
                break;

            // 当主播发送公告时
            case 'host_announcement':
                const announcerRoomId = ws.roomId;
                const announcerRoom = rooms[announcerRoomId];

                // 安全检查：只有主播才能发送公告
                if (ws.isHost && announcerRoom) {
                    console.log(`[房间 ${announcerRoomId}] 主播 ${ws.username} 发布公告: ${parsedMessage.payload.content}`);

                    const announcementMessage = {
                        type: 'new_announcement',
                        payload: {
                            content: `📢 ${parsedMessage.payload.content}` // Add an icon for emphasis
                        }
                    };
                    const messageString = JSON.stringify(announcementMessage);

                    // 向房间内的每个人广播
                    if (announcerRoom.host.readyState === announcerRoom.host.OPEN) {
                        announcerRoom.host.send(messageString);
                    }
                    announcerRoom.viewers.forEach(viewer => {
                        if (viewer.readyState === viewer.OPEN) {
                            viewer.send(messageString);
                        }
                    });
                }
                break;

            // 当客户端发送 '开始输入' 状态时
            case 'start_typing':
                if (ws.roomId && rooms[ws.roomId]) {
                    ws.isTyping = true; // 标记该连接正在输入
                    broadcastTypingUsers(rooms[ws.roomId]);
                }
                break;

            // 当客户端发送 '停止输入' 状态时
            case 'stop_typing':
                if (ws.roomId && rooms[ws.roomId]) {
                    ws.isTyping = false; // 标记该连接停止输入
                    broadcastTypingUsers(rooms[ws.roomId]);
                }
                break;

            default:
                console.log('收到未知类型的消息:', parsedMessage);
        }
    });

    // 监听连接关闭事件
    ws.on('close', () => {
        console.log(`客户端 ${ws.username || '未命名'} 断开连接了`);
        const closedRoomId = ws.roomId;
        if (!closedRoomId) return; // 如果这个连接不属于任何房间，则无需处理

        const room = rooms[closedRoomId];
        if (!room) return; // 如果房间已不存在，也无需处理

        // 判断断开的是主播还是观众
        if (ws.isHost) {
            // --- 主播离开了 ---
            console.log(`主播 ${ws.username} 离开了房间 ${closedRoomId}，正在关闭房间...`);
            const closeMessage = JSON.stringify({ type: 'room_closed', payload: { message: '主播已结束直播，房间已关闭。' } });

            // 向所有观众发送房间关闭的消息
            room.viewers.forEach(viewer => {
                if (viewer.readyState === viewer.OPEN) {
                    viewer.send(closeMessage);
                }
            });

            // 从内存中删除整个房间
            delete rooms[closedRoomId];
            console.log(`房间 ${closedRoomId} 已被成功删除。`);

        } else {
            // --- 普通观众离开了 ---
            console.log(`观众 ${ws.username} 离开了房间 ${closedRoomId}`);
            room.viewers.delete(ws); // 从观众集合中移除
            ws.isTyping = false; // 确保离开时清除正在输入状态

            // 广播最新的观众人数
            broadcastViewerCount(room);
            // 广播最新的用户列表
            broadcastUserList(room);
            // 广播最新的正在输入用户列表
            broadcastTypingUsers(room);

            // 广播该观众离开的消息
            const leaveMessage = JSON.stringify({
                type: 'system_message',
                payload: { content: `${ws.username} 离开了直播间。` }
            });

            // 只需要发给主播和其他在线的观众
            if (room.host.readyState === room.host.OPEN) {
                room.host.send(leaveMessage);
            }
            room.viewers.forEach(viewer => {
                if (viewer.readyState === viewer.OPEN) {
                    viewer.send(leaveMessage);
                }
            });
        }
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

  // 启动心跳检测定时器
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        // 如果上次 Ping 后没有收到 Pong，则终止连接
        console.log(`检测到僵尸连接，终止客户端 ${ws.username || '未知'}`);
        return ws.terminate();
      }

      // 标记为未收到 Pong，并发送 Ping
      ws.isAlive = false;
      ws.ping(() => {
        console.log(`向客户端 ${ws.username || '未知'} 发送 Ping。`)// 添加日志
      });
    });
  }, PING_INTERVAL); // 每隔 PING_INTERVAL 发送一次 Ping
});
