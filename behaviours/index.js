const sayHelloToEveryone = require('./say-hello-to-everyone');
const replyToPing = require('./reply-to-ping');
const webSend = require('./web-send');

module.exports = function(chat, web) {
    sayHelloToEveryone(chat, web);
    replyToPing(chat, web);
    webSend(chat, web);
}
