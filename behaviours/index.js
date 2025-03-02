const sayHelloToEveryone = require('./say-hello-to-everyone');
const replyToPing = require('./reply-to-ping');
const webSend = require('./web-send');

module.exports = function(chat, web, cron) {
    sayHelloToEveryone(chat, web, cron);
    replyToPing(chat, web, cron);
    webSend(chat, web, cron);
}
