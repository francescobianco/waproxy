const sayHelloToEveryone = require('./say-hello-to-everyone');
const replyToPing = require('./reply-to-ping');
const webSend = require('./web-send');
const dailyWakeup = require('./daily-wakeup');
const dailyChessPuzzle = require('./daily-chess-puzzle');
const statusMessage = require('./status-message');
const chatInfo = require('./chat-info');
const mutableChat = require('./mutable-chat');
const smartChat = require('./smart-chat');

module.exports = function(chat, web, cron) {
    sayHelloToEveryone(chat, web, cron);
    replyToPing(chat, web, cron);
    webSend(chat, web, cron);
    dailyWakeup(chat, web, cron);
    dailyChessPuzzle(chat, web, cron);
    statusMessage(chat, web, cron);
    chatInfo(chat, web, cron);
    mutableChat(chat, web, cron); // registra il manager prima di smart-chat
    smartChat(chat, web, cron);
}
