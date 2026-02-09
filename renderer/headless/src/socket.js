import { io } from 'socket.io-client';
let socket = null;
export const initSocket = (token) => {
    socket = io({
        auth: { token },
    });
    return socket;
};
export const getSocket = () => {
    if (!socket) {
        throw new Error('Socket not initialized');
    }
    return socket;
};
//# sourceMappingURL=socket.js.map