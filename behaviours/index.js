const sayHelloToEveryone = require('./say-hello-to-everyone');
const replyToPing = require('./reply-to-ping');
const webSend = require('./web-send');
const dailyWakeup = require('./daily-wakeup');

module.exports = function(chat, web, cron) {
    sayHelloToEveryone(chat, web, cron);
    replyToPing(chat, web, cron);
    webSend(chat, web, cron);
    dailyWakeup(chat, web, cron);
}
